//! The state shared between the analysis passes.

use super::types::*;
use super::AnalyzedScript;
use crate::catalog::*;
use crate::hash::HashMap;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType, NameTag};
use dashql_buffers::parser::{Node, NodeType, SymbolSpan};
use dashql_parser::names::NameId;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;
use dashql_parser::scanner::ScannedScript;
use dashql_parser::span::TextSpan;
use std::sync::Arc;

/// The state shared between the analysis passes of a script
pub(super) struct AnalysisState<'a> {
    /// The parsed script
    pub parsed: &'a ParsedScript,
    /// The AST
    pub ast: &'a [Node],
    /// The catalog
    pub catalog: &'a Catalog,
    /// The catalog entry id of the script
    pub entry_id: CatalogEntryId,
    /// The texts of the names
    pub name_texts: Vec<Arc<str>>,
    /// The output
    pub out: AnalyzedScript,
    /// The expression of every AST node, if it was translated
    pub expression_index: Vec<Option<ExprId>>,
    /// How often each qualified name was declared by a table so far
    table_name_occurrences: HashMap<QualifiedKey, u32>,
    /// How often each qualified name was declared by a function so far
    function_name_occurrences: HashMap<QualifiedKey, u32>,
}

impl<'a> AnalysisState<'a> {
    pub fn new(parsed: &'a Arc<ParsedScript>, catalog: &'a Catalog) -> Self {
        let scanned = parsed.scanned.clone();
        let entry_id = scanned.external_id;
        let mut names = scanned.names.clone();
        let empty_name = names.register("", TextSpan::default());
        let mut name_tags = vec![NameTag::NONE; names.len()];
        if let Some(tags) = name_tags.get_mut(empty_name as usize) {
            *tags = NameTag(NameTag::DATABASE_NAME.0 | NameTag::SCHEMA_NAME.0);
        }
        let name_texts = names.iter().map(|n| Arc::<str>::from(n.text.as_str())).collect();
        let node_count = parsed.nodes.len();
        let out = AnalyzedScript {
            parsed: parsed.clone(),
            snapshot: catalog.snapshot().clone(),
            entry: Arc::new(CatalogEntryData::new(entry_id, catalog.version())),
            names,
            name_tags,
            name_objects: Vec::new(),
            empty_name,
            errors: Vec::new(),
            table_references: Vec::new(),
            insert_statements: Vec::new(),
            expressions: Vec::new(),
            function_arguments: Vec::new(),
            name_scopes: Vec::new(),
            name_scopes_by_root_node: Default::default(),
            constant_expressions: Vec::new(),
            parameters: Vec::new(),
            client_function_calls: Vec::new(),
            visualization_specs: Vec::new(),
            board: None,
            flow: None,
            param_values: Vec::new(),
            manual: false,
            transactions: Vec::new(),
            inference_constraints: Vec::new(),
            inferred_table_schemas: Vec::new(),
            inferred_table_schemas_by_name: Default::default(),
            name_search_index: Default::default(),
            table_parameters: None,
        };
        Self {
            parsed,
            ast: &parsed.nodes,
            catalog,
            entry_id,
            name_texts,
            out,
            expression_index: vec![None; node_count],
            table_name_occurrences: HashMap::default(),
            function_name_occurrences: HashMap::default(),
        }
    }

    /// Reserve the id of the next table that the script declares, keyed by its name and the
    /// occurrence of the name among the tables of the script
    pub fn reserve_table_id(&mut self, name: &QualifiedTableName) -> CatalogTableId {
        let key = name.key();
        let occurrence = self.table_name_occurrences.entry(key.clone()).or_insert(0);
        let id = self.catalog.reserve_table_id(self.entry_id, &key, *occurrence);
        *occurrence += 1;
        id
    }

    /// Reserve the id of the next function that the script declares, like `reserve_table_id`
    pub fn reserve_function_id(&mut self, name: &QualifiedFunctionName) -> CatalogFunctionId {
        let key = name.key();
        let occurrence = self.function_name_occurrences.entry(key.clone()).or_insert(0);
        let id = self.catalog.reserve_function_id(self.entry_id, &key, *occurrence);
        *occurrence += 1;
        id
    }

    /// Reserve the ids of the columns of a table, keyed by their names and their occurrences
    pub fn reserve_column_ids<'n>(&self, table: CatalogTableId, names: impl Iterator<Item = &'n Arc<str>>) -> Vec<u32> {
        let mut occurrences: HashMap<&Arc<str>, u32> = HashMap::default();
        names
            .map(|name| {
                let occurrence = occurrences.entry(name).or_insert(0);
                let id = self.catalog.reserve_column_id(table, name, *occurrence);
                *occurrence += 1;
                id
            })
            .collect()
    }

    /// Finish the analysis: collect the names of the script for completion
    pub fn into_script(mut self) -> AnalyzedScript {
        let out = &mut self.out;
        let entry_id = out.entry.catalog_entry_id;
        let mut names: Vec<IndexedName> = out
            .names
            .iter()
            .map(|n| IndexedName {
                text: self.name_texts.get(n.name_id as usize).cloned().unwrap_or_default(),
                occurrences: n.occurrences,
                location: n.location,
                tags: out.name_tags.get(n.name_id as usize).copied().unwrap_or(NameTag::NONE),
                objects: Vec::new(),
            })
            .collect();
        for &(entry, name, object) in &out.name_objects {
            if entry != entry_id {
                continue;
            }
            if let Some(indexed) = names.get_mut(name as usize) {
                indexed.objects.push(object);
            }
        }
        out.name_search_index = Arc::new(NameSearchIndex::new(names));
        self.out
    }

    /// The declarations of the script, unshared while the analysis runs
    pub fn entry_mut(&mut self) -> &mut CatalogEntryData {
        Arc::make_mut(&mut self.out.entry)
    }

    pub fn scanned(&self) -> &ScannedScript {
        &self.parsed.scanned
    }

    /// The children of a node, empty when they lie outside of the AST
    pub fn children(&self, node: &Node) -> &'a [Node] {
        let count = node.children_count() as usize;
        if count == 0 {
            return &[];
        }
        let begin = node.children_begin_or_value() as usize;
        self.ast.get(begin..begin + count).unwrap_or_default()
    }

    /// A node of the AST
    pub fn node(&self, id: u32) -> Option<&'a Node> {
        self.ast.get(id as usize)
    }

    /// The id of a node of the AST
    pub fn node_id(&self, node: &Node) -> u32 {
        self.parsed.node_id(node)
    }

    /// A name of the script, with an empty text for an id that the script doesn't hold
    pub fn name(&self, id: NameId) -> Name {
        Name { entry: self.entry_id, id, text: self.name_texts.get(id as usize).cloned().unwrap_or_default() }
    }

    /// The location of an object of this script
    pub fn loc(&self, index: usize) -> ObjectLoc {
        ObjectLoc { entry: self.entry_id, index: index as u32 }
    }

    /// The empty name
    pub fn empty_name(&self) -> Name {
        self.name(self.out.empty_name)
    }

    /// The name of a NAME node
    pub fn node_name(&self, node: &Node) -> Name {
        self.name(node.children_begin_or_value())
    }

    /// Add analyzer tags to a name of the script
    pub fn tag(&mut self, name: &Name, tag: NameTag) {
        if name.entry != self.entry_id {
            return;
        }
        if let Some(tags) = self.out.name_tags.get_mut(name.id as usize) {
            *tags = NameTag(tags.0 | tag.0);
        }
    }

    /// Remember an object a name resolves to
    pub fn resolve_name(&mut self, name: &Name, object: CatalogObjectRef) {
        self.out.name_objects.push((name.entry, name.id, object));
    }

    /// Resolve a symbol span to a text span
    pub fn text_span(&self, span: SymbolSpan) -> TextSpan {
        let scanned = self.scanned();
        resolve_text_span(&scanned.text, &scanned.symbols, span)
    }

    /// The text at a symbol span
    pub fn text_at(&self, span: SymbolSpan) -> &str {
        let text = &self.parsed.scanned.text;
        let ts = self.text_span(span);
        let begin = (ts.offset as usize).min(text.len());
        let end = (begin + ts.length as usize).min(text.len());
        text.get(begin..end).unwrap_or("")
    }

    /// Add an expression
    pub fn add_expression(&mut self, node_id: u32, location: SymbolSpan, inner: ExpressionInner) -> ExprId {
        let id = self.out.expressions.len() as ExprId;
        self.out.expressions.push(Expression {
            expression_id: id,
            ast_node_id: node_id,
            location: Some(location),
            ast_statement_id: None,
            inner,
            is_constant_expression: false,
        });
        id
    }

    /// The expression of a node
    pub fn expression_of(&self, node_id: u32) -> Option<ExprId> {
        self.expression_index.get(node_id as usize).copied().flatten()
    }

    /// Set the expression of a node
    pub fn set_expression_of(&mut self, node_id: u32, expr: ExprId) {
        if let Some(index) = self.expression_index.get_mut(node_id as usize) {
            *index = Some(expr);
        }
    }

    /// Add an error at an AST node, without a location for a node that the AST doesn't hold
    pub fn add_error(
        &mut self,
        error_type: AnalyzerErrorType,
        severity: AnalyzerErrorSeverity,
        node_id: u32,
        message: String,
    ) {
        let span = self.node(node_id).map(|n| *n.symbol_span());
        let text_span = span.map(|s| self.text_span(s));
        self.out.errors.push(AnalyzerError {
            error_type,
            severity,
            ast_node_id: Some(node_id),
            symbol_span: span,
            text_span,
            message,
        });
    }

    /// Add a warning at a span of the text, e.g. of a comment tag that has no AST node
    pub fn warn_at(&mut self, error_type: AnalyzerErrorType, span: TextSpan, message: String) {
        self.out.errors.push(AnalyzerError {
            error_type,
            severity: AnalyzerErrorSeverity::WARNING,
            ast_node_id: None,
            symbol_span: None,
            text_span: Some(span),
            message,
        });
    }

    /// Read a name path
    pub fn read_name_path(&self, node: &Node) -> Vec<NameId> {
        let mut path = Vec::new();
        if node.node_type() != NodeType::ARRAY {
            return path;
        }
        for child in self.children(node) {
            match child.node_type() {
                // Skip over trailing dots
                NodeType::OBJECT_EXT_TRAILING_DOT => continue,
                NodeType::NAME => path.push(child.children_begin_or_value()),
                // Not a plain name path
                _ => {
                    path.clear();
                    break;
                }
            }
        }
        path
    }

    /// Read a name qualified by an optional database and schema, tagging the last name with `tag`. Returns the node
    /// id, the database, the schema and the last name.
    fn read_qualified_name(&mut self, node: Option<&Node>, tag: NameTag) -> Option<(Option<u32>, Name, Name, Name)> {
        let node = node?;
        let path = self.read_name_path(node);
        let ast_node_id = Some(self.node_id(node));
        let (db, schema, name) = match *path.as_slice() {
            [db, schema, name] => (self.name(db), self.name(schema), self.name(name)),
            [schema, name] => (self.empty_name(), self.name(schema), self.name(name)),
            [name] => (self.empty_name(), self.empty_name(), self.name(name)),
            _ => return None,
        };
        if path.len() == 3 {
            self.tag(&db, NameTag::DATABASE_NAME);
        }
        if path.len() >= 2 {
            self.tag(&schema, NameTag::SCHEMA_NAME);
        }
        self.tag(&name, tag);
        Some((ast_node_id, db, schema, name))
    }

    /// Read a qualified table name
    pub fn read_qualified_table_name(&mut self, node: Option<&Node>) -> Option<QualifiedTableName> {
        let (ast_node_id, database_name, schema_name, table_name) =
            self.read_qualified_name(node, NameTag::TABLE_NAME)?;
        Some(QualifiedTableName { ast_node_id, database_name, schema_name, table_name })
    }

    /// The qualified column name of the names of a column ref path, its first two names. More names qualify the column
    /// with the schema of its table, or access fields of a row-typed column.
    pub fn qualified_column_name(&mut self, node: &Node, path: &[Name]) -> Option<QualifiedColumnName> {
        let ast_node_id = Some(self.node_id(node));
        match path {
            [] => None,
            [column] => {
                self.tag(column, NameTag::COLUMN_NAME);
                Some(QualifiedColumnName { ast_node_id, table_alias: None, column_name: column.clone() })
            }
            [alias, column, ..] => {
                self.tag(alias, NameTag::TABLE_ALIAS);
                self.tag(column, NameTag::COLUMN_NAME);
                Some(QualifiedColumnName { ast_node_id, table_alias: Some(alias.clone()), column_name: column.clone() })
            }
        }
    }

    /// Read a qualified function name
    pub fn read_qualified_function_name(&mut self, node: Option<&Node>) -> Option<QualifiedFunctionName> {
        let (ast_node_id, database_name, schema_name, function_name) =
            self.read_qualified_name(node, NameTag::FUNCTION_NAME)?;
        Some(QualifiedFunctionName { ast_node_id, database_name, schema_name, function_name })
    }

    /// A table of this script, of the results it reads or of the catalog
    pub fn table(&self, loc: TableLoc) -> Option<&TableDeclaration> {
        self.out.table(loc)
    }

    /// Resolve a function: the declarations of the script first, then the catalog in resolution order
    pub fn resolve_function(&self, name: &QualifiedFunctionName) -> Vec<ObjectLoc> {
        let mut out = Vec::new();
        self.out.entry.resolve_function(name, &mut out);
        if out.is_empty() {
            self.catalog.resolve_function(name, self.entry_id, &mut out);
        }
        out
    }

    /// A function of this script or of the catalog
    pub fn function(&self, loc: ObjectLoc) -> Option<&FunctionDeclaration> {
        if loc.entry == self.entry_id {
            self.out.entry.function_declarations.get(loc.index as usize)
        } else {
            self.catalog.function(loc)
        }
    }

    /// The statement that contains an AST node, None outside of statements
    pub fn find_statement_id(&self, ast_node_id: u32) -> Option<u32> {
        let mut root = ast_node_id;
        // Statement roots are their own parents
        for _ in 0..self.ast.len() {
            let Some(node) = self.node(root) else { break };
            let parent = node.parent();
            if parent as usize >= self.ast.len() || parent == root {
                break;
            }
            root = parent;
        }
        let statements = &self.parsed.statements;
        if let Some(i) = statements.iter().position(|s| s.root == root) {
            return Some(i as u32);
        }
        statements
            .iter()
            .position(|s| ast_node_id >= s.nodes_begin && ast_node_id < s.nodes_begin + s.node_count)
            .map(|i| i as u32)
    }
}

/// The literal type of a literal node type
pub(super) fn literal_type(node_type: NodeType) -> dashql_buffers::algebra::LiteralType {
    dashql_buffers::algebra::LiteralType((node_type.0 - 5) as u8)
}

pub(super) use crate::utils::quote_identifier;
