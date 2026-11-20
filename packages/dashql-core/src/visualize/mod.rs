//! The renderer specs of the visualizations of `@vis` tags.
//!
//! - `vegalite_generator`: the Vega-Lite JSON of an analyzed visualization
//! - `markdown`: the Markdown row template compiled into a document tree, parsed with
//!   pulldown-cmark
//!
//! The functions are pure, callers cache the results.

mod markdown;
mod vegalite_generator;

pub use markdown::{compile_markdown_spec, compile_markdown_template, MarkdownDocument, MarkdownNode};
pub use vegalite_generator::generate_vegalite_spec;

use crate::analyzer::{AnalyzedScript, VisualizationSpec};
use dashql_parser::parser::context::resolve_text_span;

/// The text of a node (`input.substr(span.offset(), span.length())`)
fn node_text(script: &AnalyzedScript, node_id: u32) -> &[u8] {
    let scanned = &script.parsed.scanned;
    let Some(node) = script.parsed.nodes.get(node_id as usize) else { return &[] };
    let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
    let text = scanned.text.as_bytes();
    let begin = (span.offset as usize).min(text.len());
    let end = (span.offset as usize + span.length as usize).min(text.len());
    text.get(begin..end).unwrap_or_default()
}

/// The renderer-specific packing of a visualization (the vegalite and markdown branches of
/// `AnalyzedScript::Pack`)
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
