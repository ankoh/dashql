//! The analyzer.
//!
//! The analysis runs three left-to-right passes over the post-order AST, interleaved per morsel of
//! 1024 nodes: name resolution, function calls and constant propagation. The interleaving determines
//! the expression ids. The visualizations of the `@vis` comment tags are built at the end.
//!
//! The scanned script is not modified. The analyzed script owns a copy of the names with the
//! analyzer tags and the objects they resolve to.

mod constants;
mod function_calls;
mod name_resolution;
mod state;
pub mod types;
mod vis_tags;

pub use types::*;
pub use vis_tags::{has_vis_tags, statement_output_columns, vis_card_line};

use crate::catalog::*;
use crate::error::Result;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType, NameTag, SemanticNodeMarkerType};
use dashql_parser::names::{NameId, NameRegistry};
use dashql_parser::parser::ParsedScript;
use crate::hash::HashMap;
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
    /// The visualization specs
    pub visualization_specs: Vec<VisualizationSpec>,
    /// The schema-inference constraints
    pub inference_constraints: Vec<InferenceConstraint>,
    /// The inferred schemas of tables that are not in the catalog
    pub inferred_table_schemas: Vec<InferredTableSchema>,
    /// The inferred schemas by (database, schema, table)
    pub inferred_table_schemas_by_name: HashMap<QualifiedKey, usize>,
    /// The names of the script for completion, shared with the catalog when the script is published
    pub(crate) name_search_index: Arc<NameSearchIndex>,
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
        self.snapshot.table(loc)
    }
}

/// Analyze a parsed script against a catalog
pub fn analyze(parsed: Arc<ParsedScript>, catalog: &Catalog) -> Result<AnalyzedScript> {
    let mut state = state::AnalysisState::new(&parsed, catalog);
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
        begin = end;
    }
    name_resolution.finish(&mut state);
    constants.finish(&mut state);
    vis_tags::analyze(&mut state);

    let mut out = state.into_script();
    // Malformed comment tags fall back to ordinary comments, warn so that they don't go unnoticed
    for (span, message) in &parsed.comment_blocks.warnings {
        out.errors.push(AnalyzerError {
            error_type: AnalyzerErrorType::MALFORMED_COMMENT_TAG,
            severity: AnalyzerErrorSeverity::WARNING,
            ast_node_id: None,
            symbol_span: None,
            text_span: Some(*span),
            message: message.clone(),
        });
    }
    Ok(out)
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
