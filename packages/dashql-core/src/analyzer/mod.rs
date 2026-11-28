//! The analyzer.
//!
//! The analysis runs three left-to-right passes over the post-order AST, interleaved per morsel of
//! 1024 nodes: name resolution, function calls and constant propagation. The interleaving determines
//! the expression ids. The visualizations of the `@vis` comment tags are built at the end. The extensions of SQL that
//! the catalog doesn't offer are flagged and skipped (`capabilities`).
//!
//! The scanned script is not modified. The analyzed script owns a copy of the names with the
//! analyzer tags and the objects they resolve to.

mod capabilities;
pub mod clfn_calls;
mod constants;
mod function_calls;
mod function_checks;
pub mod manual_tag;
mod name_resolution;
pub mod param_tags;
mod parameters;
pub mod sql_types;
mod state;
pub mod transactions;
pub mod types;
mod vis_tags;

pub use clfn_calls::ClientFunctionCall;
pub use sql_types::{SqlType, SqlTypeKind};
pub use transactions::TransactionBlock;
pub use types::*;
pub use vis_tags::{has_vis_tags, kpi_names, statement_output_columns, RENDERERS};

use crate::catalog::*;
use crate::error::Result;
use crate::hash::HashMap;
use crate::table_parameters::{TableParameters, TABLE_PARAMETERS_ENTRY_ID};
use dashql_buffers::analyzer::{AnalyzerErrorType, NameTag, SemanticNodeMarkerType};
use dashql_buffers::parser::Node;
use dashql_parser::names::{NameId, NameRegistry};
use dashql_parser::parser::ParsedScript;
use std::fmt;
use std::sync::Arc;

/// An analyzed script
pub struct AnalyzedScript {
    /// The parsed script
    pub parsed: Arc<ParsedScript>,
    /// The catalog snapshot the script was analyzed against. Its locations into other entries refer
    /// to the declarations of this snapshot, however the catalog changed since. The snapshot holds
    /// declarations and names, never analyses, so it keeps no earlier analysis alive.
    pub snapshot: Arc<CatalogSnapshot>,
    /// The catalog declarations of the script, shared with the catalog when the script is published
    pub entry: Arc<CatalogEntryData>,
    /// The names of the scanned script, plus the empty name registered by the analyzer
    pub names: NameRegistry,
    /// The analyzer tags of the names
    pub name_tags: Vec<NameTag>,
    /// The objects of this script that names of this or other entries resolve to, in registration order
    pub name_objects: Vec<(CatalogEntryId, NameId, CatalogObjectRef)>,
    /// The empty name
    pub empty_name: NameId,
    /// The analyzer errors
    pub errors: Vec<AnalyzerError>,
    /// The semantic node markers
    pub node_markers: Vec<SemanticNodeMarkerType>,
    /// The table references
    pub table_references: Vec<TableReference>,
    /// The INSERT statements
    pub insert_statements: Vec<InsertStatement>,
    /// The expressions
    pub expressions: Vec<Expression>,
    /// The function arguments, referenced by function calls
    pub function_arguments: Vec<FunctionArgument>,
    /// The name scopes
    pub name_scopes: Vec<NameScope>,
    /// The name scopes by scope root
    pub name_scopes_by_root_node: HashMap<u32, ScopeId>,
    /// The constant expression roots
    pub constant_expressions: Vec<ConstantExpression>,
    /// The parameters, in the order of the script
    pub parameters: Vec<Parameter>,
    /// The calls in a namespace with client functions
    pub client_function_calls: Vec<ClientFunctionCall>,
    /// The visualization specs
    pub visualization_specs: Vec<VisualizationSpec>,
    /// The dashboard placement of the script, the `@board` tag of its last statement
    pub board: Option<BoardSpec>,
    /// The flow position of the script, the first `@flow` tag in statement order
    pub flow: Option<FlowSpec>,
    /// The values of the parameters of the script, the first `@param` tag of every name in statement order
    pub param_values: Vec<ParamTag>,
    /// Does the script run only on request? A `@manual` tag on any statement
    pub manual: bool,
    /// The transactions of the script in statement order, see `transactions`
    pub transactions: Vec<TransactionBlock>,
    /// The schema-inference constraints
    pub inference_constraints: Vec<InferenceConstraint>,
    /// The inferred schemas of tables that are not in the catalog
    pub inferred_table_schemas: Vec<InferredTableSchema>,
    /// The inferred schemas by (database, schema, table)
    pub inferred_table_schemas_by_name: HashMap<QualifiedKey, usize>,
    /// The names of the script for completion, shared with the catalog when the script is published
    pub(crate) name_search_index: Arc<NameSearchIndex>,
    /// The results of the scripts of the session that table parameters read, the analysis is current with them only
    pub table_parameters: Option<Arc<TableParameters>>,
}

impl fmt::Debug for AnalyzedScript {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AnalyzedScript")
            .field("catalog_entry_id", &self.entry.catalog_entry_id)
            .field("errors", &self.errors.len())
            .field("expressions", &self.expressions.len())
            .finish_non_exhaustive()
    }
}

impl AnalyzedScript {
    pub fn catalog_entry_id(&self) -> CatalogEntryId {
        self.entry.catalog_entry_id
    }

    /// The text of a name of this script
    pub fn name_text(&self, id: NameId) -> &str {
        &self.names.get(id).text
    }

    // The checked lookups of the arenas below take ids that the same analysis handed out. They miss only when an
    // invariant of the analysis breaks, the callers then skip the object or return None or an error.

    /// A node of the AST
    pub fn node(&self, id: u32) -> Option<&Node> {
        self.parsed.nodes.get(id as usize)
    }

    /// The children of a node, empty when they lie outside of the AST
    pub fn children(&self, node: &Node) -> &[Node] {
        self.parsed.children(node)
    }

    /// An expression
    pub fn expression(&self, id: ExprId) -> Option<&Expression> {
        self.expressions.get(id as usize)
    }

    /// An expression, mutable
    pub fn expression_mut(&mut self, id: ExprId) -> Option<&mut Expression> {
        self.expressions.get_mut(id as usize)
    }

    /// A name scope
    pub fn scope(&self, id: ScopeId) -> Option<&NameScope> {
        self.name_scopes.get(id as usize)
    }

    /// A name scope, mutable
    pub fn scope_mut(&mut self, id: ScopeId) -> Option<&mut NameScope> {
        self.name_scopes.get_mut(id as usize)
    }

    /// A table reference
    pub fn table_ref(&self, id: TableRefId) -> Option<&TableReference> {
        self.table_references.get(id as usize)
    }

    /// A table reference, mutable
    pub fn table_ref_mut(&mut self, id: TableRefId) -> Option<&mut TableReference> {
        self.table_references.get_mut(id as usize)
    }

    /// The name search index
    pub fn name_search_index(&self) -> &NameSearchIndex {
        &self.name_search_index
    }

    /// The part of the analysis that the catalog publishes
    pub fn publication(&self) -> PublishedScript {
        PublishedScript {
            catalog_id: self.snapshot.id(),
            entry: self.entry.clone(),
            names: self.name_search_index.clone(),
        }
    }

    /// A table declared by this script or by an entry of its snapshot
    pub fn table(&self, loc: TableLoc) -> Option<&TableDeclaration> {
        if loc.entry == self.entry.catalog_entry_id {
            return self.entry.table_declarations.get(loc.index as usize);
        }
        if loc.entry == TABLE_PARAMETERS_ENTRY_ID {
            return self.table_parameters.as_ref()?.table(loc);
        }
        self.snapshot.table(loc)
    }
}

/// Analyze a parsed script against a catalog
pub fn analyze(parsed: Arc<ParsedScript>, catalog: &Catalog) -> Result<AnalyzedScript> {
    analyze_with(parsed, catalog, None)
}

/// Analyze a parsed script against a catalog and the results of the scripts of its session, which its table
/// parameters read
pub fn analyze_with(
    parsed: Arc<ParsedScript>,
    catalog: &Catalog,
    table_parameters: Option<&Arc<TableParameters>>,
) -> Result<AnalyzedScript> {
    let mut state = state::AnalysisState::new(&parsed, catalog);
    state.out.table_parameters = table_parameters.cloned();
    let mut name_resolution = name_resolution::NameResolutionPass::new(&state);
    let mut constants = constants::ConstantPropagationPass::default();

    // Scan all nodes in morsels, interleaving the passes
    const MORSEL_SIZE: usize = 1024;
    let node_count = state.ast.len();
    let mut begin = 0;
    while begin != node_count {
        let end = (begin + MORSEL_SIZE).min(node_count);
        name_resolution.visit(&mut state, begin..end);
        function_calls::visit(&mut state, begin..end)?;
        constants.visit(&mut state, begin..end);
        parameters::visit(&mut state, begin..end);
        begin = end;
    }
    name_resolution.finish(&mut state);
    constants.finish(&mut state);
    // The AST is in post-order with sorted attributes, sort the parameters by their position in the text
    state.out.parameters.sort_by_key(|p| p.location.offset());
    capabilities::analyze_parameters(&mut state);
    vis_tags::analyze(&mut state);
    param_tags::analyze(&mut state);
    manual_tag::analyze(&mut state);
    clfn_calls::analyze(&mut state);
    function_checks::analyze(&mut state);
    transactions::analyze(&mut state);
    // Malformed comment tags fall back to ordinary comments, warn so that they don't go unnoticed
    for (span, message) in &parsed.comment_blocks.warnings {
        state.warn_at(AnalyzerErrorType::MALFORMED_COMMENT_TAG, *span, message.clone());
    }
    Ok(state.into_script())
}

impl From<Arc<AnalyzedScript>> for PublishedScript {
    fn from(script: Arc<AnalyzedScript>) -> Self {
        script.publication()
    }
}

impl From<&Arc<AnalyzedScript>> for PublishedScript {
    fn from(script: &Arc<AnalyzedScript>) -> Self {
        script.publication()
    }
}
