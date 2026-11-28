//! The analyzer snapshot encoder.

use super::{encode_location_text, object_id_text, Map};
use crate::ryml::Node;
use dashql_buffers::algebra::LiteralType;
use dashql_buffers::parser::{Node as AstNode, SymbolSpan};
use dashql_buffers::visualization::KpiChart;
use dashql_core::analyzer::*;
use dashql_core::catalog::{Catalog, ColumnLoc, QualifiedCatalogObjectId, TableDeclaration};
use dashql_core::touched_relations::touched_relations_of_statement;
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

    /// The statement of an item, left out in scripts with a single statement
    fn statement_id(&self, map: &mut Map, statement: u32) {
        if self.script.parsed.statements.len() > 1 {
            map.int("statement-id", statement as i64);
        }
    }

    fn location(&self, map: &mut Map, node_id: u32, key: &str) {
        let span = self.resolve(*self.node(node_id).symbol_span());
        encode_location_text(map, self.text, span.offset, span.length, key);
    }
}

/// `db.schema.origin:table`
fn table_catalog_id(schema: QualifiedCatalogObjectId, table: QualifiedCatalogObjectId) -> String {
    let (db, schema) = schema.unpack_schema_id();
    format!("{db}.{schema}.{}", object_id_text(table.unpack_table_id()))
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
                    c.into_flow_node()
                })
                .collect();
            m.insert("columns", Node::seq(columns));
            m.into_node()
        })
        .collect();
    Node::seq(items)
}

/// The relations that the statements create or drop, named as written
fn encode_touched_relations(script: &AnalyzedScript) -> Option<Node> {
    let items: Vec<Node> = (0..script.parsed.statements.len())
        .flat_map(|statement_id| {
            touched_relations_of_statement(&script.parsed, statement_id).into_iter().map(move |relation| {
                let name: Vec<&str> = [&relation.database_name, &relation.schema_name, &relation.table_name]
                    .into_iter()
                    .flatten()
                    .map(String::as_str)
                    .collect();
                let mut m = Map::new();
                m.int("statement-id", statement_id as i64);
                m.plain("name", &name.join("."));
                m.into_flow_node()
            })
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
        if value > 0.0 {
            ".inf".into()
        } else {
            "-.inf".into()
        }
    } else {
        format!("{value:?}")
    }
}

/// Encode the catalog script of a case, only its errors.
/// Its declarations show in the cases that analyze the DDL as their main script, and the main script shows what
/// resolves into them.
pub fn encode_catalog_script(script: &AnalyzedScript) -> Node {
    let e = Encoder { script, text: &script.parsed.scanned.text };
    let mut out = Map::new();
    out.insert("errors", encode_errors(&e));
    out.into_node()
}

fn encode_errors(e: &Encoder) -> Node {
    let errors = e
        .script
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
            m.into_flow_node()
        })
        .collect();
    Node::seq(errors)
}

/// Encode the main script of a case
pub fn encode_script(script: &AnalyzedScript, scope_catalog: ScopeCatalog) -> Node {
    let e = Encoder { script, text: &script.parsed.scanned.text };
    let entry_id = script.catalog_entry_id();
    let mut out = Map::new();
    out.int("catalog-id", entry_id as i64);

    // Local declarations
    if !script.entry.table_declarations.is_empty() {
        out.insert("tables", encode_tables(&e, &script.entry.table_declarations));
    }
    if let Some(relations) = encode_touched_relations(script) {
        out.insert("touched-relations", relations);
    }
    out.insert("errors", encode_errors(&e));

    // The transactions, by the statements that begin and end them
    if !script.transactions.is_empty() {
        let blocks = script
            .transactions
            .iter()
            .map(|block| {
                let mut m = Map::new();
                m.int("begin", block.begin as i64);
                if let Some(end) = block.end {
                    m.int("end", end as i64);
                }
                m.into_flow_node()
            })
            .collect();
        out.insert("transactions", Node::seq(blocks));
    }

    // Table references
    if !script.table_references.is_empty() {
        let items = script
            .table_references
            .iter()
            .map(|table_ref| {
                let mut m = Map::new();
                if let Some(relation) = &table_ref.inner {
                    match &relation.resolved_table {
                        None if relation.resolved_cte.is_some() => {
                            m.plain("type", "name/cte");
                        }
                        None => {
                            m.plain("type", "name/unresolved");
                        }
                        Some(resolved) => {
                            let table_id = resolved.catalog_table_id.unpack_table_id();
                            let internal = table_id.origin == entry_id;
                            m.plain("type", if internal { "name/internal" } else { "name/catalog" });
                            m.quoted(
                                "catalog-id",
                                &table_catalog_id(resolved.catalog_schema_id, resolved.catalog_table_id),
                            );
                        }
                    }
                }
                if let Some(statement) = table_ref.ast_statement_id {
                    e.statement_id(&mut m, statement);
                }
                if table_ref.role == TableRole::Write {
                    m.plain("role", "write");
                }
                e.location(&mut m, table_ref.ast_node_id, "text");
                m.into_flow_node()
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
                    e.statement_id(&mut m, statement);
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
                            c.into_flow_node()
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
                m.int("id", i as i64);
                match &expr.inner {
                    ExpressionInner::None => {}
                    ExpressionInner::ColumnRef(column_ref) => {
                        if !column_ref.resolved.is_resolved() {
                            m.plain("type", "colref/unresolved");
                        } else {
                            match &column_ref.resolved_ids {
                                // The whole row of the FROM item
                                None if column_ref.resolved == ColumnResolution::WholeRow => {
                                    m.plain("type", "colref/row");
                                }
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
                                    let internal = table_id.origin == entry_id;
                                    m.plain("type", if internal { "colref/internal" } else { "colref/catalog" });
                                    m.quoted(
                                        "catalog",
                                        &format!("{db}.{schema}.{}.{column}", object_id_text(table_id)),
                                    );
                                }
                            }
                            // The FROM item that the column ref reads, none for an output column of the own scope
                            if let Some(source) = column_ref.resolved_source {
                                e.location(&mut m, source, "source");
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
                    ExpressionInner::UnaryExpression(unary) => {
                        m.plain("type", "unary");
                        m.plain("op", unary.func.variant_name().unwrap_or(""));
                        m.int("arg", unary.input_expression_id as i64);
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
                    e.statement_id(&mut m, statement);
                }
                e.location(&mut m, expr.ast_node_id, "text");
                m.into_flow_node()
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
                m.into_flow_node()
            })
            .collect();
        out.insert("constants", Node::seq(items));
    }

    // Parameters, scalar values and tables
    if !script.parameters.is_empty() {
        let items = script
            .parameters
            .iter()
            .map(|parameter| {
                let mut m = Map::new();
                m.plain(
                    "kind",
                    match parameter.kind {
                        ParameterKind::Scalar => "scalar",
                        ParameterKind::Table => "table",
                    },
                );
                if let Some(name) = &parameter.name {
                    m.plain("name", name);
                }
                if let Some(statement) = parameter.ast_statement_id {
                    e.statement_id(&mut m, statement);
                }
                if let Some(cast) = &parameter.cast_type {
                    m.quoted("cast", &cast.to_string());
                }
                e.location(&mut m, parameter.ast_node_id, "text");
                m.into_flow_node()
            })
            .collect();
        out.insert("parameters", Node::seq(items));
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

    // Parameter values
    if !script.param_values.is_empty() {
        let items = script
            .param_values
            .iter()
            .map(|input| {
                let mut m = Map::new();
                m.plain("name", &input.name);
                if let Some(literal) = &input.literal {
                    m.quoted("value", &literal.to_hyper());
                }
                m.int("statement-id", input.statement_id as i64);
                m.into_flow_node()
            })
            .collect();
        out.insert("param-values", Node::seq(items));
    }

    // Board placement
    if let Some(board) = &script.board {
        let mut m = Map::new();
        m.int("statement-id", board.statement_id as i64);
        if let Some(row) = board.dashboard.row {
            m.int("row", row as i64);
        }
        if let Some(column) = board.dashboard.column {
            m.int("column", column as i64);
        }
        m.int("width", board.dashboard.width as i64);
        m.int("height", board.dashboard.height as i64);
        out.insert("board", m.into_node());
    }

    // Flow position
    if let Some(flow) = &script.flow {
        let mut m = Map::new();
        m.int("statement-id", flow.statement_id as i64);
        if let Some((x, y)) = flow.position {
            m.int("x", x as i64);
            m.int("y", y as i64);
        }
        if let Some(width) = flow.width {
            m.int("width", width as i64);
        }
        if let Some(height) = flow.height {
            m.int("height", height as i64);
        }
        out.insert("flow", m.into_node());
    }

    // Runs only on request
    if script.manual {
        out.boolean("manual", true);
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
                        c.into_flow_node()
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

/// `db.schema.origin:table.column` of a table column
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
    // The FROM items of the parent that the scope sees, its kind restricted by the clause of the parent around it
    let parent = scope.parent_scope.and_then(|p| e.script.scope(p));
    let visibility = parent.map_or(scope.parent_visibility, |p| p.child_visibility(&e.script.parsed.nodes, scope));
    if let Some(visibility) = visibility_name(visibility) {
        m.plain("parent-sources", visibility);
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
                        if let Some(child) = cte.and_then(|c| c.child_scope) {
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
                s.into_flow_node()
            })
            .collect();
        m.insert("sources", Node::seq(sources));
    }
    if !scope.joins.is_empty() {
        let joins = scope
            .joins
            .iter()
            .map(|join| {
                let mut j = Map::new();
                j.plain("name", &join.name);
                let columns = join.columns.iter().map(|c| encode_scope_column(e, catalog, &c.column)).collect();
                j.insert("columns", Node::seq(columns));
                e.location(&mut j, join.ast_node_id, "text");
                j.into_node()
            })
            .collect();
        m.insert("joins", Node::seq(joins));
    }
    if !scope.clauses.is_empty() {
        let clauses = scope
            .clauses
            .iter()
            .map(|clause| {
                let mut c = Map::new();
                c.plain("sources", visibility_name(clause.visibility).unwrap_or("all"));
                e.location(&mut c, clause.ast_node_id, "text");
                c.into_flow_node()
            })
            .collect();
        m.insert("clauses", Node::seq(clauses));
    }
    if !scope.output_columns.is_empty() {
        let columns = scope.output_columns.iter().map(|column| encode_scope_column(e, catalog, column)).collect();
        m.insert("columns", Node::seq(columns));
    }
    e.location(&mut m, scope.ast_node_id, "text");
    Some(m.into_node())
}

/// The name of a restricted visibility of FROM items, None if all are visible
fn visibility_name(visibility: SourceVisibility) -> Option<&'static str> {
    match visibility {
        SourceVisibility::All => None,
        SourceVisibility::Before(_) => Some("before"),
        SourceVisibility::None => Some("none"),
        SourceVisibility::Only(_) => Some("only"),
        SourceVisibility::Except(_) => Some("except"),
        SourceVisibility::BeforeExcept(..) => Some("before-except"),
        SourceVisibility::Within(_) => Some("within"),
    }
}

/// Encode a column of a scope or of a join
fn encode_scope_column(e: &Encoder, catalog: &Catalog, column: &ScopeColumn) -> Node {
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
    c.into_flow_node()
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
    if let Some(kpi) = &spec.kpi {
        let mut out = Map::new();
        if let Some(value) = &kpi.value {
            out.plain("value", value);
        }
        if let Some(x) = &kpi.x {
            out.plain("x", x);
        }
        out.plain("delta", &kpi.delta.variant_name().unwrap_or("?").to_ascii_lowercase());
        // The chart is a line unless the tag names another one
        if kpi.chart != KpiChart::LINE {
            out.plain("chart", &kpi.chart.variant_name().unwrap_or("?").to_ascii_lowercase());
        }
        m.insert("kpi", out.into_node());
    }
    m.into_node()
}

/// The keys the analyzer snapshot test compares
pub const COMPARED_KEYS: [&str; 12] = [
    "errors",
    "transactions",
    "tables",
    "catalog-changes",
    "table-refs",
    "inserts",
    "expressions",
    "constants",
    "parameters",
    "param-values",
    "name-scopes",
    "inferred-tables",
];

/// Analyze the scripts of an analyzer snapshot case: the catalog script is analyzed and loaded into the connection layer, then the main script is analyzed.
/// Returns the encoded catalog script (if any) and the encoded main script.
pub fn analyze_case(
    capabilities: Option<dashql_core::capabilities::Capabilities>,
    catalog_input: Option<&str>,
    functions_complete: bool,
    main_input: &str,
) -> Result<(Option<Yaml>, Yaml), String> {
    use dashql_core::catalog::Catalog;
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;
    use std::sync::Arc;

    let mut catalog = Catalog::new();
    if let Some(capabilities) = capabilities {
        catalog.set_capabilities(capabilities);
    }
    let analyze_text = |catalog: &Catalog, text: &str| -> Result<AnalyzedScript, String> {
        let entry_id = catalog.allocate_entry_id();
        let parsed = Arc::new(parse(Arc::new(scan(text, 0, entry_id))));
        dashql_core::analyzer::analyze(parsed, catalog).map_err(|e| e.message)
    };
    let mut catalog_yaml = None;
    if let Some(input) = catalog_input {
        let analyzed = analyze_text(&catalog, input)?;
        catalog_yaml = Some(encode_catalog_script(&analyzed).to_yaml());
        crate::publish_catalog_script(&mut catalog, analyzed, functions_complete)?;
    }
    let analyzed = analyze_text(&catalog, main_input)?;
    Ok((catalog_yaml, encode_script(&analyzed, Some(&catalog)).to_yaml()))
}

/// Compare the keys that the analyzer snapshot test compares.
/// The encoder leaves out empty keys, so a key is missing on both sides or present on both sides.
pub fn compare_script(expected: &Yaml, actual: &Yaml) -> Result<(), String> {
    for key in COMPARED_KEYS {
        let (want, have) = (&expected[key], &actual[key]);
        match (matches!(want, Yaml::BadValue), matches!(have, Yaml::BadValue)) {
            (true, true) => {}
            // A stale snapshot, the analysis has output that the snapshot does not show
            (true, false) => return Err(format!("{key}: missing in the snapshot, the analysis has {have:?}")),
            _ => crate::compare(want, have).map_err(|e| format!("{key}: {e}"))?,
        }
    }
    Ok(())
}
