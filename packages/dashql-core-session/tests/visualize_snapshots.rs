//! The visualize snapshots (snapshots/visualize/*.yaml).
//!
//! Renderers other than `markdown`, including `table`, compare the Vega-Lite JSON.

use dashql_core_session::visualize::{compile_markdown_spec, generate_vegalite_spec};
use dashql_snapshots::encode::analyzer::{analyze_case, compare_script};
use dashql_snapshots::encode::visualize::{analyze_scripts, encode_dashboard_spec, encode_markdown_spec};
use dashql_snapshots::{compare, load_category, run, Arguments, Failed, Trial, Yaml};

/// Trim spaces and line breaks at both ends
fn trim(input: &str) -> String {
    input.trim_matches([' ', '\n']).to_string()
}

/// A block literal without trailing line breaks
fn expected_text(node: &Yaml) -> String {
    node.as_str().unwrap_or_default().trim_end_matches('\n').to_string()
}

fn run_case(node: &Yaml) -> Result<(), String> {
    let catalog_input = node["catalog"]["script"]["input"].as_str().map(trim);
    let script_input = node["script"]["input"].as_str().map(trim).unwrap_or_default();
    // The snapshot shows the analysis of the catalog script, like the analyzer snapshots
    if let (Some(catalog_yaml), _) = analyze_case(catalog_input.as_deref(), &script_input)? {
        compare_script(&node["catalog"]["script"], &catalog_yaml).map_err(|e| format!("catalog: {e}"))?;
    }
    let analyzed = analyze_scripts(catalog_input.as_deref(), &script_input)?;
    let spec = analyzed.visualization_specs.first().ok_or("no visualization spec")?;
    let renderer = spec.renderer.as_deref();

    if !matches!(node["dashboard"], Yaml::BadValue) {
        compare(&node["dashboard"], &encode_dashboard_spec(&spec.dashboard).to_yaml())
            .map_err(|e| format!("dashboard: {e}"))?;
    }

    if renderer == Some("markdown") {
        // The snapshotter always writes the spec of the renderer, a missing one is a stale snapshot
        let markdown = compile_markdown_spec(spec).ok_or("no markdown spec")?;
        compare(&node["markdown"], &encode_markdown_spec(&markdown).to_yaml()).map_err(|e| format!("markdown: {e}"))?;
        return Ok(());
    }

    let vegalite = generate_vegalite_spec(spec, &analyzed);
    if matches!(node["vegalite"], Yaml::BadValue) {
        return Err("vegalite: missing in the snapshot".to_string());
    }
    let expected = expected_text(&node["vegalite"]);
    if vegalite != expected {
        return Err(format!("vegalite differs\nexpected:\n{expected}\nactual:\n{vegalite}"));
    }
    Ok(())
}

fn main() {
    let args = Arguments::from_args();
    let mut trials = Vec::new();
    for case in load_category("visualize").expect("cannot load visualize snapshots") {
        trials.push(Trial::test(case.trial_name(), move || run_case(&case.node).map_err(Failed::from)));
    }
    run(&args, trials).exit();
}
