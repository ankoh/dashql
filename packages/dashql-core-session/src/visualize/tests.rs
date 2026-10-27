//! Unit tests of the renderer specs of `@vis` tags.

use super::*;
use dashql_core::analyzer::analyze;
use dashql_core::catalog::Catalog;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use std::sync::Arc;

fn parse_text(catalog: &Catalog, text: &str) -> Arc<ParsedScript> {
    Arc::new(parse(Arc::new(scan(text, 0, catalog.allocate_entry_id()))))
}

fn analyze_text(text: &str) -> AnalyzedScript {
    let catalog = Catalog::new();
    analyze(parse_text(&catalog, text), &catalog).unwrap()
}

#[test]
fn select_source() {
    let analyzed = analyze_text("\n/* @vis vegalite {\"mark\": \"bar\"} */\nSELECT * FROM sales WHERE revenue > 0\n");
    assert!(!analyzed.visualization_specs.is_empty());
    let json = generate_vegalite_spec(&analyzed.visualization_specs[0], &analyzed);
    assert!(json.contains("\"$sql\": \"SELECT * FROM sales WHERE revenue > 0\""));
    assert!(!json.contains("@vis"));
}

#[test]
fn normalizes_dashboard_layout_with_warnings() {
    let analyzed = analyze_text("/* @vis table\n   @vis card row=-1 column=15 width=20 height=0 */\nSELECT 1 AS value");
    assert!(!analyzed.visualization_specs.is_empty());
    let dashboard = &analyzed.visualization_specs[0].dashboard;
    assert_eq!(dashboard.row, None);
    assert_eq!(dashboard.column, Some(0));
    assert_eq!(dashboard.width, 12);
    assert_eq!(dashboard.height, 1);
    assert_eq!(analyzed.errors.len(), 4);
    for warning in &analyzed.errors {
        assert_eq!(warning.error_type, AnalyzerErrorType::INVALID_DASHBOARD_LAYOUT);
        assert_eq!(warning.severity, AnalyzerErrorSeverity::WARNING);
    }
}

#[test]
fn accepts_a_card_for_every_renderer() {
    for renderer in ["vegalite {\"mark\": \"bar\"}", "markdown {{value}}", "table"] {
        let analyzed = analyze_text(&format!("/* @vis {renderer}\n   @vis card width=7 */\nSELECT 1 AS value"));
        assert!(!analyzed.visualization_specs.is_empty(), "{renderer}");
        assert_eq!(analyzed.visualization_specs[0].dashboard.width, 7, "{renderer}");
    }
}

#[test]
fn compiles_renderer_specs() {
    let analyzed = analyze_text("/* @vis table */ SELECT 1 AS value");
    assert!(compile_markdown_spec(&analyzed.visualization_specs[0]).is_none());

    let analyzed = analyze_text("/* @vis markdown ## {{product}} */ SELECT 'item' AS product");
    let spec = &analyzed.visualization_specs[0];
    let markdown = compile_markdown_spec(spec).unwrap();
    assert_eq!(markdown.template, "## {{product}}");
    assert_eq!(markdown.fields, vec!["product"]);
    assert_eq!(markdown.document.children.len(), 1);
}
