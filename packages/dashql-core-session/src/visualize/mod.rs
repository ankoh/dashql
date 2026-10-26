//! The renderer specs of VISUALIZE statements.
//!
//! - `vegalite_generator`: the Vega-Lite JSON of an analyzed visualization
//! - `vegalite_parser`: a VISUALIZE statement from Vega-Lite JSON
//! - `markdown`: the Markdown row template compiled into a document tree, parsed with
//!   pulldown-cmark
//!
//! The functions are pure, callers cache the results.

mod markdown;
mod vegalite_generator;
mod vegalite_parser;

pub use markdown::{
    compile_markdown_spec, compile_markdown_template, pack_markdown_spec, MarkdownDocument, MarkdownNode,
};
pub use vegalite_generator::generate_vegalite_spec;
pub use vegalite_parser::parse_vegalite_to_visualize;

use dashql_core::analyzer::{AnalyzedScript, VisualizationSpec};
use dashql_parser::parser::context::resolve_text_span;

/// The text of a node (`input.substr(span.offset(), span.length())`)
fn node_text(script: &AnalyzedScript, node_id: u32) -> &[u8] {
    let scanned = &script.parsed.scanned;
    let span = resolve_text_span(&scanned.text, &scanned.symbols, *script.parsed.nodes[node_id as usize].symbol_span());
    let text = scanned.text.as_bytes();
    let begin = (span.offset as usize).min(text.len());
    let end = (span.offset as usize + span.length as usize).min(text.len());
    &text[begin..end]
}

/// Strip enclosing single quotes
fn strip_single_quotes(text: &[u8]) -> &[u8] {
    if text.len() >= 2 && text[0] == b'\'' && text[text.len() - 1] == b'\'' {
        &text[1..text.len() - 1]
    } else {
        text
    }
}

/// A string from bytes that are UTF-8 unless the input was not
fn into_string(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

/// The renderer-specific packing of a visualization (the vegalite and markdown branches of
/// `AnalyzedScript::Pack`)
#[allow(clippy::type_complexity)]
pub fn pack_visualization(
    script: &AnalyzedScript,
    spec: &VisualizationSpec,
) -> (
    Option<String>,
    Option<Box<dashql_buffers::visualization::MarkdownSpecT>>,
) {
    use dashql_buffers::visualization::MarkdownSpec;
    let renderer = spec.renderer.as_deref();
    let vegalite = (renderer == Some("vegalite"))
        .then(|| generate_vegalite_spec(spec, script))
        .filter(|json| !json.is_empty());
    let markdown =
        (renderer == Some("markdown")).then(|| compile_markdown_spec(spec)).flatten().map(|doc| {
            let mut builder = flatbuffers::FlatBufferBuilder::new();
            let packed = pack_markdown_spec(&mut builder, &doc);
            builder.finish(packed, None);
            Box::new(flatbuffers::root::<MarkdownSpec>(builder.finished_data()).unwrap().unpack())
        });
    (vegalite, markdown)
}

#[cfg(test)]
mod tests;
