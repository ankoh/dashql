//! The analyzer snapshot encoder.

use super::{encode_location_text, Map};
use crate::ryml::Node;
use dashql_buffers::algebra::LiteralType;
use dashql_core::catalog::changes::CatalogChangeKind;
use dashql_buffers::parser::{Node as AstNode, SymbolSpan};
use dashql_core::analyzer::*;
use dashql_core_session::catalog_changes::{derive_catalog_change, CatalogChangeOptions};
use dashql_core::catalog::{Catalog, CatalogLayer, ColumnLoc, QualifiedCatalogObjectId, TableDeclaration};
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::span::TextSpan;
use yaml_rust2::Yaml;

/// Encodes an analyzed script into a snapshot node
struct Encoder<'a> {
    /// The analyzed script
    script: &'a AnalyzedScript,
    /// The script text
    text: &'a str,
}

/// The catalog of a script, the name scopes are encoded if it is given
pub type ScopeCatalog<'a> = Option<&'a Catalog>;

impl Encoder<'_> {
    fn resolve(&self, span: SymbolSpan) -> TextSpan {
        let scanned = &self.script.parsed.scanned;
        resolve_text_span(&scanned.text, &scanned.symbols, span)
    }

    fn node(&self, node_id: u32) -> &AstNode {
        &self.script.parsed.nodes[node_id as usize]
    }

    fn location(&self, map: &mut Map, node_id: u32, key: &str) {
        let span = self.resolve(*self.node(node_id).symbol_span());
        encode_location_text(map, self.text, span.offset, span.length, key);
    }
}

/// `db.schema.packed_table_id`
fn table_catalog_id(schema: QualifiedCatalogObjectId, table: QualifiedCatalogObjectId) -> String {
    let (db, schema) = schema.unpack_schema_id();
    format!("{db}.{schema}.{}", table.unpack_table_id().pack())
}

fn encode_tables(e: &Encoder, tables: &[TableDeclaration]) -> Node {
    let items = tables
        .iter()
        .map(|table| {
            let id = table_catalog_id(table.catalog_schema_id, table.object_id);
            let mut m = Map::new();
            m.quoted("catalog-id", &id);
            m.plain("name", &table.table_name.table_name.text);
            e.location(&mut m, table.ast_node_id.unwrap_or(0), "text");
            let columns = table
                .table_columns
                .iter()
                .map(|column| {
                    let mut c = Map::new();
                    c.quoted("catalog-id", &format!("{id}.{}", column.column_id()));
                    let name = &column.column_name.text;
                    c.plain("name", if name.is_empty() { "?" } else { name });
                    if let Some(node_id) = column.ast_node_id {
                        e.location(&mut c, node_id, "text");
                    }
                    c.into_node()
                })
                .collect();
            m.insert("columns", Node::seq(columns));
            m.into_node()
        })
        .collect();
    Node::seq(items)
}

/// The catalog changes of the statements, derived without defaults so names appear as written
fn encode_catalog_changes(script: &AnalyzedScript) -> Option<Node> {
    let options = CatalogChangeOptions::default();
    let items: Vec<Node> = (0..script.parsed.statements.len())
        .filter_map(|statement_id| {
            let change = derive_catalog_change(script, statement_id, &options)?;
            let mut m = Map::new();
            m.int("statement-id", statement_id as i64);
            let change_type = match change.kind {
                CatalogChangeKind::CreateRelation if change.if_not_exists => "create-if-not-exists",
                CatalogChangeKind::CreateRelation => "create",
                CatalogChangeKind::DropRelation => "drop",
            };
            m.plain("type", change_type);
            let name: Vec<&str> = [&change.database_name, &change.schema_name, &change.relation_name]
                .into_iter()
                .filter(|part| !part.is_empty())
                .map(String::as_str)
                .collect();
            m.plain("name", &name.join("."));
            if change.kind == CatalogChangeKind::CreateRelation {
                let columns = change.column_names.into_iter().map(Node::auto).collect();
                m.insert("columns", Node::flow_seq(columns));
            }
            Some(m.into_node())
        })
        .collect();
    (!items.is_empty()).then(|| Node::seq(items))
}

fn boolean(value: bool) -> Node {
    Node::boolean(value)
}

/// Format a double as a YAML scalar
pub fn format_double(value: f64) -> String {
    if value.is_nan() {
        ".nan".into()
    } else if value.is_infinite() {
        if value > 0.0 { ".inf".into() } else { "-.inf".into() }
    } else {
        format!("{value:?}")
    }
}

/// Encode an analyzed script
pub fn encode_script(script: &AnalyzedScript, is_main: bool, scope_catalog: ScopeCatalog) -> Node {
    let e = Encoder { script, text: &script.parsed.scanned.text };
    let entry_id = script.catalog_entry_id();
    let mut out = Map::new();
    out.int("catalog-id", entry_id as i64);

    // Local declarations
    if !script.entry.table_declarations.is_empty() {
        out.insert("tables", encode_tables(&e, &script.entry.table_declarations));
    }
    if let Some(changes) = encode_catalog_changes(script) {
        out.insert("catalog-changes", changes);
    }

    // Errors
    let errors = script
        .errors
        .iter()
        .map(|error| {
            let mut m = Map::new();
            m.plain("type", error.error_type.variant_name().unwrap_or(""));
            // Only non-default (WARNING) severities are dumped
            if error.severity != dashql_buffers::analyzer::AnalyzerErrorSeverity::ERROR {
                m.plain("severity", error.severity.variant_name().unwrap_or(""));
            }
            m.plain("message", &error.message);
            let span = match error.symbol_span {
                Some(span) => e.resolve(span),
                None => error.text_span.unwrap_or_default(),
            };
            encode_location_text(&mut m, e.text, span.offset, span.length, "text");
            m.into_node()
        })
        .collect();
    out.insert("errors", Node::seq(errors));

    // Table references
    if !script.table_references.is_empty() {
        let items = script
            .table_references
            .iter()
            .map(|table_ref| {
                let mut m = Map::new();
                if let Some(relation) = &table_ref.inner {
                    match &relation.resolved_table {
                        None => {
                            m.plain("type", "name/unresolved");
                        }
                        Some(resolved) => {
                            let table_id = resolved.catalog_table_id.unpack_table_id();
                            let internal = is_main && table_id.origin == entry_id;
                            m.plain("type", if internal { "name/internal" } else { "name/catalog" });
                            m.quoted(
                                "catalog-id",
                                &table_catalog_id(resolved.catalog_schema_id, resolved.catalog_table_id),
                            );
                        }
                    }
                }
                if let Some(statement) = table_ref.ast_statement_id {
                    m.int("statement-id", statement as i64);
                }
                if table_ref.role == TableRole::Write {
                    m.plain("role", "write");
                }
                e.location(&mut m, table_ref.ast_node_id, "text");
                m.into_node()
            })
            .collect();
        out.insert("table-refs", Node::seq(items));
    }

    // INSERT statements
    if !script.insert_statements.is_empty() {
        let items = script
            .insert_statements
            .iter()
            .map(|insert| {
                let mut m = Map::new();
                if let Some(statement) = insert.ast_statement_id {
                    m.int("statement-id", statement as i64);
                }
                let target = &script.table_references[insert.target as usize];
                m.int("target-ref", target.table_reference_id.object as i64);
                if let Some(source) = insert.source_ast_node_id {
                    e.location(&mut m, source, "source");
                }
                if insert.default_values {
                    m.insert("default-values", boolean(true));
                }
                if insert.returning {
                    m.insert("returning", boolean(true));
                }
                if !insert.target_columns.is_empty() {
                    let columns = insert
                        .target_columns
                        .iter()
                        .map(|column| {
                            let mut c = Map::new();
                            c.plain("name", &column.column_name.text);
                            c.insert("resolved", boolean(column.resolved.is_some()));
                            c.into_node()
                        })
                        .collect();
                    m.insert("columns", Node::seq(columns));
                }
                m.into_node()
            })
            .collect();
        out.insert("inserts", Node::seq(items));
    }

    // Expressions
    if !script.expressions.is_empty() {
        let items = script
            .expressions
            .iter()
            .enumerate()
            .map(|(i, expr)| {
                let mut m = Map::new();
                m.int("expression-idx", i as i64);
                match &expr.inner {
                    ExpressionInner::None => {}
                    ExpressionInner::ColumnRef(column_ref) => {
                        if !column_ref.resolved.is_resolved() {
                            m.plain("type", "colref/unresolved");
                        } else {
                            match &column_ref.resolved_ids {
                                None => {
                                    m.plain("type", "colref/local");
                                    // A local column is an output column of a scope without a catalog column behind it
                                    if let ColumnResolution::ScopeColumn { scope, column } = column_ref.resolved {
                                        m.int("scope", scope as i64);
                                        m.int("column", column as i64);
                                    }
                                }
                                Some(ids) => {
                                    let (db, schema) = ids.catalog_schema_id.unpack_schema_id();
                                    let (table_id, column) = ids.catalog_table_column_id.unpack_table_column_id();
                                    let internal = is_main && table_id.origin == entry_id;
                                    m.plain("type", if internal { "colref/internal" } else { "colref/catalog" });
                                    m.quoted("catalog", &format!("{db}.{schema}.{}.{column}", table_id.pack()));
                                }
                            }
                        }
                    }
                    ExpressionInner::Literal(literal) => {
                        let name = match literal.literal_type {
                            LiteralType::NULL_ => "null",
                            LiteralType::INTERVAL => "interval",
                            LiteralType::INTEGER => "integer",
                            LiteralType::FLOAT => "float",
                            LiteralType::STRING => "string",
                            _ => "",
                        };
                        m.plain("type", &format!("literal/{name}"));
                    }
                    ExpressionInner::Comparison(cmp) => {
                        m.plain("type", "comparison");
                        m.plain("op", cmp.func.variant_name().unwrap_or(""));
                        m.int("arg-left", cmp.left_expression_id as i64);
                        m.int("arg-right", cmp.right_expression_id as i64);
                    }
                    ExpressionInner::BinaryExpression(binary) => {
                        m.plain("type", "binary");
                        m.plain("op", binary.func.variant_name().unwrap_or(""));
                        m.int("arg-left", binary.left_expression_id as i64);
                        m.int("arg-right", binary.right_expression_id as i64);
                    }
                    ExpressionInner::FunctionCall(call) => {
                        m.plain("type", "function");
                        match &call.function_name {
                            FunctionName::Known(known) => {
                                m.plain("known-function", known.variant_name().unwrap_or(""));
                            }
                            FunctionName::Qualified(name) => {
                                m.plain("name", &name.debug_string());
                            }
                        }
                    }
                    ExpressionInner::ConstIntervalCast(_) => {
                        m.plain("type", "constcast/interval");
                    }
                }
                if expr.is_constant_expression {
                    m.insert("is-const", boolean(true));
                }
                if let Some(statement) = expr.ast_statement_id {
                    m.int("statement-id", statement as i64);
                }
                e.location(&mut m, expr.ast_node_id, "text");
                m.into_node()
            })
            .collect();
        out.insert("expressions", Node::seq(items));
    }

    // Constant expressions
    if !script.constant_expressions.is_empty() {
        let items = script
            .constant_expressions
            .iter()
            .map(|constant| {
                let root = &script.expressions[constant.root as usize];
                let mut m = Map::new();
                m.int("expression", root.expression_id as i64);
                e.location(&mut m, root.ast_node_id, "text");
                m.into_node()
            })
            .collect();
        out.insert("constants", Node::seq(items));
    }

    // Name scopes, the FROM items and output columns that column refs resolve against
    if let Some(catalog) = scope_catalog {
        let items: Vec<Node> =
            script.name_scopes.iter().filter_map(|scope| encode_name_scope(&e, catalog, scope)).collect();
        if !items.is_empty() {
            out.insert("name-scopes", Node::seq(items));
        }
    }

    // Visualization specs
    if !script.visualization_specs.is_empty() {
        let items = script.visualization_specs.iter().map(|spec| encode_visualization(&e, spec)).collect();
        out.insert("visualizations", Node::seq(items));
    }

    // Inferred table schemas
    if !script.inferred_table_schemas.is_empty() {
        let confidence = |c: InferenceConfidence| match c {
            InferenceConfidence::Confident => "confident",
            InferenceConfidence::Candidate => "candidate",
            InferenceConfidence::None => "none",
        };
        let items = script
            .inferred_table_schemas
            .iter()
            .map(|schema| {
                let mut m = Map::new();
                m.plain("name", &schema.table_name.debug_string());
                m.plain("confidence", confidence(schema.confidence));
                let columns = schema
                    .columns
                    .iter()
                    .map(|column| {
                        let mut c = Map::new();
                        c.plain("name", &column.column_name.text);
                        c.plain("confidence", confidence(column.confidence));
                        if !column.candidate_table_names.is_empty() {
                            let candidates =
                                column.candidate_table_names.iter().map(|n| super::plain(&n.debug_string())).collect();
                            c.insert("candidates", Node::seq(candidates));
                        }
                        c.into_node()
                    })
                    .collect();
                m.insert("columns", Node::seq(columns));
                m.into_node()
            })
            .collect();
        out.insert("inferred-tables", Node::seq(items));
    }
    out.into_node()
}

/// `db.schema.packed_table_id.column` of a table column
fn column_catalog_id(e: &Encoder, catalog: &Catalog, loc: ColumnLoc) -> String {
    let table = if loc.table.entry == e.script.catalog_entry_id() {
        e.script.entry.table_declarations.get(loc.table.index as usize)
    } else {
        catalog.table(loc.table)
    };
    match table {
        Some(table) => format!("{}.{}", table_catalog_id(table.catalog_schema_id, table.object_id), loc.column),
        None => "?".into(),
    }
}

/// Encode a name scope, scopes without FROM items and output columns are skipped
fn encode_name_scope(e: &Encoder, catalog: &Catalog, scope: &NameScope) -> Option<Node> {
    if scope.sources.is_empty() && scope.output_columns.is_empty() {
        return None;
    }
    let mut m = Map::new();
    m.int("scope-id", scope.name_scope_id as i64);
    if let Some(parent) = scope.parent_scope {
        m.int("parent", parent as i64);
    }
    match scope.parent_visibility {
        SourceVisibility::All => {}
        SourceVisibility::Before(_) => {
            m.plain("parent-sources", "before");
        }
        SourceVisibility::None => {
            m.plain("parent-sources", "none");
        }
    }
    if scope.column_correlation_barrier {
        m.insert("correlation-barrier", boolean(true));
    }
    if !scope.sources.is_empty() {
        let sources = scope
            .sources
            .iter()
            .map(|source| {
                let mut s = Map::new();
                match &source.table {
                    ReferencedTable::Table(_) => s.plain("type", "table"),
                    ReferencedTable::Cte(_) => s.plain("type", "cte"),
                    ReferencedTable::Subquery(_) => s.plain("type", "subquery"),
                    ReferencedTable::Unresolved(_) => s.plain("type", "unresolved"),
                };
                if let Some(name) = &source.name {
                    s.plain("name", name);
                }
                match &source.table {
                    ReferencedTable::Cte(loc) => {
                        let cte = e.script.name_scopes[loc.scope as usize].cte_definitions.at(loc.index as usize);
                        if let Some(child) = cte.child_scope {
                            s.int("scope", child as i64);
                        }
                    }
                    ReferencedTable::Subquery(child) => {
                        s.int("scope", *child as i64);
                    }
                    ReferencedTable::Table(_) | ReferencedTable::Unresolved(_) => {}
                }
                if !source.column_aliases.is_empty() {
                    let aliases = source.column_aliases.iter().map(|a| super::plain(&a.text)).collect();
                    s.insert("column-aliases", Node::seq(aliases));
                }
                e.location(&mut s, source.ast_node_id, "text");
                s.into_node()
            })
            .collect();
        m.insert("sources", Node::seq(sources));
    }
    if !scope.output_columns.is_empty() {
        let columns = scope
            .output_columns
            .iter()
            .map(|column| {
                let mut c = Map::new();
                let name = &column.column_name.text;
                c.plain("name", if name.is_empty() { "?" } else { name });
                match column.source {
                    ScopeColumnSource::Expression(expr) => {
                        c.int("expression", expr as i64);
                    }
                    ScopeColumnSource::TableColumn(loc) => {
                        c.quoted("table-column", &column_catalog_id(e, catalog, loc));
                    }
                    ScopeColumnSource::Computed => {
                        c.insert("computed", boolean(true));
                    }
                }
                c.into_node()
            })
            .collect();
        m.insert("columns", Node::seq(columns));
    }
    e.location(&mut m, scope.ast_node_id, "text");
    Some(m.into_node())
}

fn encode_visualization(e: &Encoder, spec: &VisualizationSpec) -> Node {
    let mut m = Map::new();
    if let Some(statement) = spec.ast_statement_id {
        m.int("statement-id", statement as i64);
    }
    e.location(&mut m, spec.ast_node_id, "source");
    if let Some(renderer) = &spec.renderer {
        m.plain("renderer", renderer);
    }
    let mut dashboard = Map::new();
    if let Some(row) = spec.dashboard.row {
        dashboard.int("row", row as i64);
    }
    if let Some(column) = spec.dashboard.column {
        dashboard.int("column", column as i64);
    }
    dashboard.int("width", spec.dashboard.width as i64);
    dashboard.int("height", spec.dashboard.height as i64);
    m.insert("dashboard", dashboard.into_node());
    if let Some(vegalite) = &spec.vegalite {
        m.insert("vegalite", Node::dquo(serde_json::Value::Object(vegalite.clone()).to_string()));
    }
    if let Some(markdown) = &spec.markdown {
        m.insert("markdown", Node::dquo(markdown.row_template.clone()));
    }
    m.into_node()
}


/// The keys the analyzer snapshot test compares
pub const COMPARED_KEYS: [&str; 9] = [
    "errors",
    "tables",
    "catalog-changes",
    "table-refs",
    "inserts",
    "expressions",
    "constants",
    "name-scopes",
    "inferred-tables",
];

/// Analyze the scripts of an analyzer snapshot case: the catalog script is analyzed and loaded into the connection layer, then the main script is analyzed.
/// Returns the encoded catalog script (if any) and the encoded main script.
pub fn analyze_case(catalog_input: Option<&str>, main_input: &str) -> Result<(Option<Yaml>, Yaml), String> {
    use dashql_core::catalog::Catalog;
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;
    use std::sync::Arc;

    let mut catalog = Catalog::new();
    let analyze_text = |catalog: &Catalog, text: &str| -> Result<AnalyzedScript, String> {
        let entry_id = catalog.allocate_entry_id();
        let parsed = Arc::new(parse(Arc::new(scan(text, 0, entry_id))));
        dashql_core::analyzer::analyze(parsed, catalog).map_err(|e| e.message)
    };
    let mut catalog_yaml = None;
    if let Some(input) = catalog_input {
        let analyzed = analyze_text(&catalog, input)?;
        catalog_yaml = Some(encode_script(&analyzed, false, None).to_yaml());
        catalog.load_script(Arc::new(analyzed), CatalogLayer::CONNECTION).map_err(|e| e.message)?;
    }
    let analyzed = analyze_text(&catalog, main_input)?;
    Ok((catalog_yaml, encode_script(&analyzed, true, Some(&catalog)).to_yaml()))
}

/// Compare the keys that the analyzer snapshot test compares
pub fn compare_script(expected: &Yaml, actual: &Yaml) -> Result<(), String> {
    for key in COMPARED_KEYS {
        let want = &expected[key];
        if matches!(want, Yaml::BadValue) {
            continue;
        }
        crate::compare(want, &actual[key]).map_err(|e| format!("{key}: {e}"))?;
    }
    Ok(())
}
