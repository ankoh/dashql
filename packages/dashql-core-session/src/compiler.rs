//! The script compiler: the terminal statement of a script, its SQL and the compiled visualization of a
//! terminal query with `@vis` tags. Runs execute the plan of the planner, the compilation describes the
//! terminal statement for the editor.

use dashql_core::analyzer::{AnalyzedScript, VisualizationSpec};
use dashql_core::catalog::{Catalog, PROTO_NULL_U32};
use dashql_core::formatter::Formatter;
use dashql_core::script::Script;
use crate::visualize;
use dashql_buffers::execution::{
    CompiledVisualizationT, ScriptCompilationErrorCode as ErrorCode, ScriptCompilationErrorT, ScriptCompilationResultT,
    ScriptCompilationStatementKind as StatementKind,
};
use dashql_buffers::formatting::FormattingConfigT;
use dashql_buffers::parser::{AttributeKey, NodeType, StatementType, TextSpanT};
use dashql_buffers::visualization::{DashboardSpecT, MarkdownSpec, TableSpecT};
use dashql_parser::attrs;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::{ParsedScript, Statement};
use dashql_parser::scanner::ScannedScript;
use dashql_parser::span::TextSpan;

/// Options of the compilation
#[derive(Clone, Copy, Debug)]
pub struct CompilationOptions {
    /// Allow the DashQL extensions (the visualizations of `@vis` tags)
    pub allow_extensions: bool,
    /// Parse the script if the text changed
    pub parse_if_outdated: bool,
}

impl Default for CompilationOptions {
    fn default() -> Self {
        Self {
            allow_extensions: true,
            parse_if_outdated: true,
        }
    }
}

fn error(code: ErrorCode, message: &str, statement_id: u32, ast_node_id: u32, text_span: Option<TextSpan>) -> ScriptCompilationErrorT {
    let mut e = ScriptCompilationErrorT::default();
    e.code = code;
    e.statement_id = statement_id;
    e.ast_node_id = ast_node_id;
    e.text_span = text_span.map(|s| {
        let mut t = TextSpanT::default();
        t.offset = s.offset;
        t.length = s.length;
        t
    });
    e.message = Some(message.to_string());
    e
}

/// The text of a span with the obfuscated literals replaced, so that it can be executed
pub fn read_executable_text(scanned: &ScannedScript, span: TextSpan) -> String {
    read_executable_text_with(scanned, span, &[])
}

/// The text of a span with the obfuscated literals replaced and with edits: ascending, disjoint text spans and
/// their replacements, an empty span inserts its text. Edits within obfuscated literals are dropped.
pub fn read_executable_text_with(scanned: &ScannedScript, span: TextSpan, edits: &[(TextSpan, String)]) -> String {
    let text = scanned.text.as_bytes();
    let clamp = |offset: usize| offset.min(text.len());
    let begin = clamp(span.offset as usize);
    let end = clamp((span.offset + span.length) as usize);
    // The replacements of the obfuscated literals and the edits, ordered by offset with insertions first
    let first = scanned.obfuscated_literals.partition_point(|l| (l.location.offset as usize) < begin);
    let mut replacements: Vec<(usize, usize, &str)> = scanned.obfuscated_literals[first..]
        .iter()
        .take_while(|l| (l.location.offset + l.location.length) as usize <= end)
        .map(|l| (l.location.offset as usize, (l.location.offset + l.location.length) as usize, l.replacement.as_str()))
        .collect();
    replacements.extend(
        edits
            .iter()
            .filter(|(s, _)| s.offset as usize >= begin && s.end() as usize <= end)
            .map(|(s, t)| (s.offset as usize, s.end() as usize, t.as_str())),
    );
    replacements.sort_by_key(|&(b, e, _)| (b, e));
    let mut out = Vec::with_capacity(end - begin);
    let mut at = begin;
    for (b, e, replacement) in replacements {
        if b < at {
            continue;
        }
        out.extend_from_slice(&text[at..clamp(b)]);
        out.extend_from_slice(replacement.as_bytes());
        at = clamp(e);
    }
    out.extend_from_slice(&text[at.min(end)..end]);
    String::from_utf8_lossy(&out).into_owned()
}

fn has_returning(parsed: &ParsedScript, statement: &Statement) -> bool {
    let root = &parsed.nodes[statement.root as usize];
    let begin = root.children_begin_or_value() as usize;
    let children = &parsed.nodes[begin..begin + root.children_count() as usize];
    let [insert_returning, delete_returning] = attrs!(children, [AttributeKey::SQL_INSERT_RETURNING, AttributeKey::SQL_DELETE_RETURNING]);
    let returning = if statement.statement_type == StatementType::DELETE { delete_returning } else { insert_returning };
    returning.is_some_and(|r| r.node_type() != NodeType::NONE)
}

/// Does a statement produce output?
pub fn produces_output(parsed: &ParsedScript, statement: &Statement) -> bool {
    match statement.statement_type {
        // SELECT INTO creates a table and returns no rows
        StatementType::SELECT | StatementType::EXPLAIN | StatementType::CALL => true,
        StatementType::INSERT | StatementType::DELETE => has_returning(parsed, statement),
        _ => false,
    }
}

/// Compile the visualization metadata
pub fn compile_visualization(spec: &VisualizationSpec, script: &AnalyzedScript) -> Result<CompiledVisualizationT, String> {
    let renderer = spec.renderer.as_ref().ok_or("could not resolve visualization renderer")?.to_ascii_lowercase();
    let mut out = CompiledVisualizationT::default();
    // The compiled visualization always writes its strings
    out.vegalite_spec = Some(String::new());
    let mut dashboard = DashboardSpecT::default();
    dashboard.row = spec.dashboard.row;
    dashboard.column = spec.dashboard.column;
    dashboard.width = spec.dashboard.width;
    dashboard.height = spec.dashboard.height;
    out.dashboard = Some(Box::new(dashboard));
    match renderer.as_str() {
        "vegalite" => out.vegalite_spec = Some(visualize::generate_vegalite_spec(spec, script)),
        "markdown" => {
            let doc = visualize::compile_markdown_spec(spec).ok_or("could not compile Markdown visualization spec")?;
            let mut builder = flatbuffers::FlatBufferBuilder::new();
            let packed = visualize::pack_markdown_spec(&mut builder, &doc);
            builder.finish(packed, None);
            out.markdown_spec = Some(Box::new(flatbuffers::root::<MarkdownSpec>(builder.finished_data()).unwrap().unpack()));
        }
        "table" => out.table_spec = Some(Box::new(TableSpecT::default())),
        _ => return Err(format!("unsupported visualization renderer: {renderer}")),
    }
    out.renderer = Some(renderer);
    Ok(out)
}

/// Is a byte C `isspace`?
fn is_c_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r')
}

/// Compile a script
pub fn compile(script: &mut Script, catalog: &Catalog, config: &FormattingConfigT, options: CompilationOptions) -> ScriptCompilationResultT {
    let mut result = ScriptCompilationResultT::default();
    result.kind = StatementKind::QUERY;
    result.terminal_statement_id = PROTO_NULL_U32;
    // The result always writes its strings
    result.sql = Some(String::new());
    let mut errors = Vec::new();
    let finish = |mut result: ScriptCompilationResultT, errors| {
        result.errors = Some(errors);
        result
    };
    if options.parse_if_outdated && script.parsed.as_ref().is_none_or(|p| p.scanned.text_version != script.text_version()) {
        script.parse();
    }
    let Some(parsed) = script.parsed.clone() else {
        errors.push(error(ErrorCode::EMPTY_SCRIPT, "script is not parsed", PROTO_NULL_U32, PROTO_NULL_U32, None));
        return finish(result, errors);
    };
    let scanned = &parsed.scanned;
    for e in &scanned.errors {
        errors.push(error(ErrorCode::SCANNER_ERROR, &e.message, PROTO_NULL_U32, PROTO_NULL_U32, Some(e.location)));
    }
    for e in &parsed.errors {
        let span = resolve_text_span(&scanned.text, &scanned.symbols, e.location);
        errors.push(error(ErrorCode::PARSER_ERROR, &e.message, PROTO_NULL_U32, PROTO_NULL_U32, Some(span)));
    }
    if !errors.is_empty() {
        // Without a reliable AST, the original text is the one statement
        let sql = read_executable_text(scanned, TextSpan::new(0, scanned.text.len() as u32));
        if sql.bytes().any(|c| !is_c_space(c)) {
            result.sql = Some(sql);
            result.terminal_statement_id = 0;
        }
        return finish(result, errors);
    }
    if parsed.statements.is_empty() {
        errors.push(error(ErrorCode::EMPTY_SCRIPT, "script has no executable statement", PROTO_NULL_U32, PROTO_NULL_U32, None));
        return finish(result, errors);
    }
    let terminal_statement_id = parsed.statements.len() - 1;
    result.terminal_statement_id = terminal_statement_id as u32;
    // A query with `@vis` tags is a visualization, the shell runs it as a plain query
    let vis_tags = options.allow_extensions
        && parsed.statements[terminal_statement_id].statement_type == StatementType::SELECT
        && dashql_core::analyzer::has_vis_tags(&parsed, terminal_statement_id);
    let descriptions = parsed.associate_descriptions();
    let terminal_sql = read_executable_text(scanned, descriptions[terminal_statement_id].statement_span);
    if !vis_tags {
        result.sql = Some(terminal_sql);
        return finish(result, errors);
    }

    result.kind = StatementKind::VISUALIZE;
    let terminal_root = parsed.statements[terminal_statement_id].root;
    let current = script.analyzed.as_ref().is_some_and(|a| std::sync::Arc::ptr_eq(&a.parsed, &parsed));
    if !current {
        // A failed analysis leaves the visualization without metadata
        if let Err(e) = script.analyze(catalog, false) {
            errors.push(error(ErrorCode::VISUALIZATION_METADATA_UNAVAILABLE, &e.message, terminal_statement_id as u32, terminal_root, None));
            return finish(result, errors);
        }
    }

    let mut formatter = Formatter::new(&parsed);
    formatter.replace_obfuscated_literals();
    let formatted = formatter.format_node_at(terminal_root as usize, config);
    // A placeholder of a node that the formatter does not know would change the query, the source text is used instead
    let sql = if formatter.is_fully_formatted() { formatted } else { terminal_sql };
    if sql.is_empty() {
        errors.push(error(
            ErrorCode::FORMAT_ERROR,
            "could not format the executable query",
            terminal_statement_id as u32,
            terminal_root,
            None,
        ));
        return finish(result, errors);
    }
    result.sql = Some(sql);

    let analyzed = script.analyzed.clone().unwrap();
    let visualization = analyzed
        .visualization_specs
        .iter()
        .find(|s| s.ast_statement_id == Some(terminal_statement_id as u32))
        .filter(|s| s.renderer.is_some());
    // Invalid `@vis` tags are analyzer warnings, the query still runs
    let Some(visualization) = visualization else {
        result.kind = StatementKind::QUERY;
        return finish(result, errors);
    };
    match compile_visualization(visualization, &analyzed) {
        Ok(compiled) => result.visualization = Some(Box::new(compiled)),
        Err(message) => {
            result.sql = Some(String::new());
            errors.push(error(
                ErrorCode::VISUALIZATION_METADATA_UNAVAILABLE,
                &message,
                terminal_statement_id as u32,
                terminal_root,
                None,
            ));
        }
    }
    finish(result, errors)
}
