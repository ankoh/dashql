//! The renderer specs of the visualizations of `@vis` tags.
//!
//! - `vegalite_generator`: the Vega-Lite JSON of an analyzed visualization
//! - `markdown`: the Markdown row template compiled into a document tree, parsed with
//!   pulldown-cmark
//! - `pack_kpi_spec`: the columns, the delta and the chart of a KPI card
//!
//! The functions are pure, callers cache the results.

mod markdown;
mod vegalite_generator;

pub(crate) use markdown::markdown_placeholders;
pub use markdown::{
    compile_markdown_spec, compile_markdown_template, compile_markdown_text, MarkdownDocument, MarkdownNode,
};
pub use vegalite_generator::generate_vegalite_spec;

use crate::analyzer::{AnalyzedScript, KpiSpec, VisualizationSpec};
use dashql_buffers::visualization::KpiSpecT;

/// The KPI card of a `@vis kpi` tag
pub fn pack_kpi_spec(spec: &KpiSpec) -> KpiSpecT {
    let mut out = KpiSpecT::default();
    out.value_column = spec.value.clone();
    out.x_column = spec.x.clone();
    out.delta = spec.delta;
    out.chart = spec.chart;
    out
}

/// The renderer-specific packing of a visualization: the Vega-Lite JSON of `vegalite` and the document of `markdown`
#[allow(clippy::type_complexity)]
pub(crate) fn pack_visualization(
    script: &AnalyzedScript,
    spec: &VisualizationSpec,
) -> (Option<String>, Option<Box<dashql_buffers::visualization::MarkdownSpecT>>) {
    let renderer = spec.renderer.as_deref();
    let vegalite =
        (renderer == Some("vegalite")).then(|| generate_vegalite_spec(spec, script)).filter(|json| !json.is_empty());
    let markdown = (renderer == Some("markdown"))
        .then(|| compile_markdown_spec(spec))
        .flatten()
        .map(|doc| Box::new(doc.to_object()));
    (vegalite, markdown)
}

#[cfg(test)]
mod tests;
