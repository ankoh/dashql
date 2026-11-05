//! Tests of the script compiler: the terminal statement of a script, its SQL and the compiled
//! visualization of a terminal VISUALIZE statement, and the output of statements.

use dashql_buffers::execution::{ScriptCompilationErrorCode as ErrorCode, ScriptCompilationResultT, ScriptCompilationStatementKind as StatementKind};
use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::catalog::{Catalog, PROTO_NULL_U32};
use dashql_core::analyzer::{MarkdownSpec, VisualizationSpec};
use dashql_core_session::compiler::{
    compile, compile_visualization, produces_output, read_executable_text, read_executable_text_with, CompilationOptions,
};
use dashql_core::script::Script;
use dashql_parser::span::TextSpan;

fn config() -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.mode = FormattingMode::INLINE;
    config.dialect = FormattingDialect::HYPER;
    config
}

fn compile_with(text: &str, options: CompilationOptions) -> ScriptCompilationResultT {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text(text);
    compile(&mut script, &catalog, &config(), options)
}

fn compile_text(text: &str) -> ScriptCompilationResultT {
    compile_with(text, CompilationOptions::default())
}

fn error_codes(result: &ScriptCompilationResultT) -> Vec<ErrorCode> {
    result.errors.as_ref().unwrap().iter().map(|e| e.code).collect()
}

/// Does every statement of a script produce output?
fn outputs(text: &str) -> Vec<bool> {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text(text);
    script.parse();
    let parsed = script.parsed.as_ref().unwrap();
    assert!(parsed.errors.is_empty(), "{text}");
    parsed.statements.iter().map(|statement| produces_output(parsed, statement)).collect()
}

#[test]
fn default_options_allow_extensions_and_parse() {
    let options = CompilationOptions::default();
    assert!(options.allow_extensions);
    assert!(options.parse_if_outdated);
}

#[test]
fn empty_script_is_an_error() {
    let result = compile_text("");
    assert_eq!(error_codes(&result), vec![ErrorCode::EMPTY_SCRIPT]);
    assert_eq!(result.terminal_statement_id, PROTO_NULL_U32);
    assert_eq!(result.sql.as_deref(), Some(""));
}

#[test]
fn unparsed_script_without_parse_is_an_error() {
    let result = compile_with("select 1", CompilationOptions { allow_extensions: true, parse_if_outdated: false });
    assert_eq!(error_codes(&result), vec![ErrorCode::EMPTY_SCRIPT]);
    assert_eq!(result.errors.as_ref().unwrap()[0].message.as_deref(), Some("script is not parsed"));
}

#[test]
fn outdated_parse_is_refreshed() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select 1");
    script.parse();
    script.replace_text("select 2");
    let result = compile(&mut script, &catalog, &config(), CompilationOptions::default());
    assert!(result.errors.as_ref().unwrap().is_empty());
    assert_eq!(result.sql.as_deref(), Some("select 2"));
}

#[test]
fn single_query() {
    let result = compile_text("select 1");
    assert!(result.errors.as_ref().unwrap().is_empty());
    assert_eq!(result.kind, StatementKind::QUERY);
    assert_eq!(result.terminal_statement_id, 0);
    assert_eq!(result.sql.as_deref(), Some("select 1"));
}

#[test]
fn commands_precede_the_terminal_query() {
    let result = compile_text("create table t (a int); insert into t values (1); select a from t;");
    assert!(result.errors.as_ref().unwrap().is_empty());
    assert_eq!(result.terminal_statement_id, 2);
    assert_eq!(result.sql.as_deref(), Some("select a from t"));
}

#[test]
fn outputs_before_the_terminal_statement_are_no_error() {
    // A run returns the last output, the terminal statement is the last statement
    let result = compile_text("select 1; create table t (a int);");
    assert!(result.errors.as_ref().unwrap().is_empty());
    assert_eq!(result.terminal_statement_id, 1);
    assert_eq!(result.sql.as_deref(), Some("create table t (a int)"));
}

#[test]
fn queries_and_returning_statements_produce_output() {
    assert_eq!(outputs("select 1; explain select 1"), vec![true, true]);
    assert_eq!(outputs("create table t (a int); insert into t values (1) returning a; delete from t where a = 1 returning a"), vec![false, true, true]);
    // Without RETURNING they are commands
    assert_eq!(outputs("create table t (a int); insert into t values (1); delete from t"), vec![false; 3]);
    // The table of a SELECT INTO can be read by a later statement
    assert_eq!(outputs("select 1 as a into t; select a from t"), vec![false, true]);
}

#[test]
fn parser_errors_keep_the_original_text() {
    let result = compile_text("select 1 +;");
    assert_eq!(error_codes(&result), vec![ErrorCode::PARSER_ERROR]);
    assert!(result.errors.as_ref().unwrap()[0].text_span.is_some());
    assert_eq!(result.sql.as_deref(), Some("select 1 +;"));
    assert_eq!(result.terminal_statement_id, 0);
}

#[test]
fn scanner_errors_are_reported() {
    let result = compile_text("select 'unterminated");
    assert!(error_codes(&result).contains(&ErrorCode::SCANNER_ERROR));
    assert_eq!(result.sql.as_deref(), Some("select 'unterminated"));
}

#[test]
fn blank_text_with_errors_has_no_statement() {
    // Whitespace-only text has no error, an unterminated comment has one but nothing to execute
    let result = compile_text("   ");
    assert_eq!(error_codes(&result), vec![ErrorCode::EMPTY_SCRIPT]);
}

#[test]
fn vis_tag_table() {
    let result = compile_text("/* @vis table\n   @board row=2 column=3 width=4 height=5 */\nselect 1 as a");
    assert!(result.errors.as_ref().unwrap().is_empty(), "{:?}", result.errors);
    assert_eq!(result.kind, StatementKind::VISUALIZE);
    assert_eq!(result.sql.as_deref(), Some("select 1 as a"));
    let visualization = result.visualization.as_ref().unwrap();
    assert_eq!(visualization.renderer.as_deref(), Some("table"));
    let dashboard = visualization.dashboard.as_ref().unwrap();
    assert_eq!((dashboard.row, dashboard.column, dashboard.width, dashboard.height), (Some(2), Some(3), 4, 5));
}

#[test]
fn vis_tag_vegalite() {
    let text = "/* @vis vegalite {\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}} */\nselect 1 as a, 2 as b";
    let result = compile_text(text);
    assert!(result.errors.as_ref().unwrap().is_empty(), "{:?}", result.errors);
    let visualization = result.visualization.as_ref().unwrap();
    assert_eq!(visualization.renderer.as_deref(), Some("vegalite"));
    let spec: serde_json::Value = serde_json::from_str(visualization.vegalite_spec.as_deref().unwrap()).unwrap();
    // The spec is passed through, the statement is its data
    assert_eq!(spec["data"]["$sql"], "select 1 as a, 2 as b");
    assert_eq!(spec["mark"], "bar");
    assert_eq!(spec["encoding"]["x"]["field"], "a");
}

#[test]
fn vis_tag_markdown() {
    let result = compile_text("-- @vis markdown by {{author}}\n-- @end\nselect 'Ada' as author");
    assert!(result.errors.as_ref().unwrap().is_empty(), "{:?}", result.errors);
    let visualization = result.visualization.as_ref().unwrap();
    assert_eq!(visualization.renderer.as_deref(), Some("markdown"));
    assert!(visualization.markdown_spec.is_some());
}

#[test]
fn invalid_vis_tags_run_the_query() {
    for text in ["/* @vis vegalite {\"mark\": */ select 1", "/* @board width=6 */ select 1", "/* @vis chart */ select 1"] {
        let result = compile_text(text);
        assert!(result.errors.as_ref().unwrap().is_empty(), "{text}: {:?}", result.errors);
        assert_eq!(result.kind, StatementKind::QUERY, "{text}");
        assert_eq!(result.sql.as_deref(), Some("select 1"), "{text}");
        assert!(result.visualization.is_none(), "{text}");
    }
}

#[test]
fn a_flow_position_is_no_visualization() {
    // The query keeps its text as written, it is not formatted like a visualized query
    let result = compile_text("/* @flow x=1 y=2 */\nSELECT   1");
    assert!(result.errors.as_ref().unwrap().is_empty(), "{:?}", result.errors);
    assert_eq!(result.kind, StatementKind::QUERY);
    assert_eq!(result.sql.as_deref(), Some("SELECT   1"));
    assert!(result.visualization.is_none());
    // With a renderer, the flow position does not change the visualization
    let result = compile_text("/* @vis table\n   @flow x=1 y=2 */\nselect 1 as a");
    assert_eq!(result.kind, StatementKind::VISUALIZE);
    assert_eq!(result.visualization.as_ref().unwrap().renderer.as_deref(), Some("table"));
}

#[test]
fn vis_tags_are_plain_comments_in_the_shell() {
    let text = "/* @vis table */ select 1";
    let result = compile_with(text, CompilationOptions { allow_extensions: false, parse_if_outdated: true });
    assert!(result.errors.as_ref().unwrap().is_empty(), "{:?}", result.errors);
    assert_eq!(result.kind, StatementKind::QUERY);
    assert!(result.visualization.is_none());
}

#[test]
fn executable_text_replaces_obfuscated_literals() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select /*String(C5FA)*/, /*Integer(FCD0)*/");
    script.scan();
    let scanned = script.scanned.as_ref().unwrap();
    let text = read_executable_text(scanned, TextSpan::new(0, scanned.text.len() as u32));
    assert!(!text.contains("/*"), "{text}");
    assert!(text.starts_with("select "));
    // A span that ends within a marker leaves it untouched
    let partial = read_executable_text(scanned, TextSpan::new(0, 10));
    assert_eq!(partial, "select /*S");
}

#[test]
fn executable_text_drops_edits_within_obfuscated_literals() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select /*Integer(FCD0)*/ from t");
    script.scan();
    let scanned = script.scanned.as_ref().unwrap();
    let literal = scanned.obfuscated_literals[0].location;
    let all = TextSpan::new(0, scanned.text.len() as u32);
    let plain = read_executable_text(scanned, all);
    // An edit within the literal is dropped, the literal is replaced
    let inner = TextSpan::new(literal.offset + 2, 3);
    assert_eq!(read_executable_text_with(scanned, all, &[(inner, "x".into())]), plain);
    // An edit after the literal applies, an insertion at the end too
    let table = TextSpan::new(scanned.text.len() as u32 - 1, 1);
    let end = TextSpan::new(scanned.text.len() as u32, 0);
    let edited = read_executable_text_with(scanned, all, &[(table, "u".into()), (end, " limit 1".into())]);
    assert_eq!(edited, format!("{}u limit 1", plain.strip_suffix('t').unwrap()));
    // Edits outside of the span are ignored
    assert_eq!(read_executable_text_with(scanned, TextSpan::new(0, 6), &[(table, "u".into())]), "select");
}

#[test]
fn visualizations_need_a_known_renderer() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select 1 as a");
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let spec = |renderer: Option<&str>| VisualizationSpec { renderer: renderer.map(str::to_string), ..Default::default() };

    assert_eq!(compile_visualization(&spec(None), &analyzed).unwrap_err(), "could not resolve visualization renderer");
    assert_eq!(compile_visualization(&spec(Some("chart")), &analyzed).unwrap_err(), "unsupported visualization renderer: chart");
    // A Markdown visualization needs its row template
    assert_eq!(compile_visualization(&spec(Some("markdown")), &analyzed).unwrap_err(), "could not compile Markdown visualization spec");
    let markdown = VisualizationSpec { markdown: Some(MarkdownSpec { row_template: "*{{a}}*".into() }), ..spec(Some("Markdown")) };
    let compiled = compile_visualization(&markdown, &analyzed).unwrap();
    // Renderer names are case insensitive
    assert_eq!(compiled.renderer.as_deref(), Some("markdown"));
    assert!(compiled.markdown_spec.unwrap().document.is_some());
    // The strings are always written
    assert_eq!(compiled.vegalite_spec.as_deref(), Some(""));
}
