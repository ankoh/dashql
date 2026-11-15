//! The Vega-Lite JSON of a `@vis vegalite` tag: the spec of the tag with the query as data.

use dashql_core::analyzer::{AnalyzedScript, VisualizationSpec};
use serde_json::{Map, Value};

/// Generate the pretty-printed Vega-Lite spec of a visualization
pub fn generate_vegalite_spec(spec: &VisualizationSpec, script: &AnalyzedScript) -> String {
    let mut root = Map::new();
    root.insert("$schema".to_string(), Value::from("https://vega.github.io/schema/vega-lite/v5.json"));
    let mut data = Map::new();
    data.insert("$sql".to_string(), Value::from(String::from_utf8_lossy(super::node_text(script, spec.ast_node_id))));
    root.insert("data".to_string(), Value::Object(data));
    if let Some(vegalite) = &spec.vegalite {
        root.extend(vegalite.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    serde_json::to_string_pretty(&root).expect("a JSON value always serializes")
}
