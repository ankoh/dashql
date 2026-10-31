//! Rewrite the `@vis` tags of a query: set, replace or remove its renderer and its card.
//!
//! The tags are edited in the annotation of the query (see `annotation`), so an edit leaves the annotation
//! consolidated in one comment. The edited tag is printed anew, the other tags keep their content. A new
//! renderer goes before the other `@vis` tags, a new card after the renderer. `/*` and `*/` in the strings
//! of a Vega-Lite spec are escaped, they would nest or end the comment.

use crate::annotation::{Annotation, AnnotationTag};
use crate::error::{Error, Result};
use dashql_buffers::parser::StatementType;
use dashql_buffers::status::StatusCode;
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;
use serde_json::{Map, Value};

/// The tag of visualizations
const VIS_TAG: &str = "vis";
/// The width of the JSON in `@vis vegalite` tags: 80 columns behind a comment prefix of 3 characters
pub(crate) const VIS_JSON_WIDTH: usize = 77;
/// The dashboard grid has 12 columns
const GRID_COLUMNS: i32 = 12;

/// The renderer of a visualization
#[derive(Clone, Debug, PartialEq)]
pub enum VisRenderer {
    /// A Vega-Lite spec without `data`
    VegaLite(Map<String, Value>),
    /// A Markdown row template
    Markdown(String),
    /// The result table
    Table,
}

impl VisRenderer {
    /// Read a renderer from its kind and its body, the body of `vegalite` is a JSON object
    pub fn from_parts(kind: &str, body: &str) -> Result<Self> {
        match kind {
            "vegalite" => match serde_json::from_str(body) {
                Ok(Value::Object(spec)) => Ok(VisRenderer::VegaLite(spec)),
                Ok(_) => Err(Error::invalid_argument("the Vega-Lite spec must be a JSON object")),
                Err(e) => Err(Error::invalid_argument(format!("invalid Vega-Lite JSON: {e}"))),
            },
            "markdown" if body.trim().is_empty() => Err(Error::invalid_argument("a Markdown template must not be empty")),
            "markdown" => Ok(VisRenderer::Markdown(body.to_string())),
            "table" => Ok(VisRenderer::Table),
            _ => Err(Error::invalid_argument(format!("unknown @vis renderer \"{kind}\""))),
        }
    }

    /// The `@vis` tag of the renderer
    pub fn tag(&self) -> AnnotationTag {
        let lines = match self {
            VisRenderer::VegaLite(spec) => {
                let json = crate::compact_json::to_string_compact(&Value::Object(spec.clone()), VIS_JSON_WIDTH);
                // `/*` and `*/` can only be part of JSON strings, escapes split them without changing the
                // value: `/*` would nest and `*/` would end a block comment
                let json = json.replace("/*", "/\\u002a").replace("*/", "*\\/");
                std::iter::once("vegalite".to_string()).chain(json.lines().map(str::to_string)).collect()
            }
            VisRenderer::Markdown(template) => {
                std::iter::once("markdown".to_string()).chain(template.trim_end().lines().map(str::to_string)).collect()
            }
            VisRenderer::Table => vec!["table".to_string()],
        };
        AnnotationTag::new(VIS_TAG, lines)
    }
}

/// The dashboard placement of a visualization
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VisCard {
    /// The grid row, None for automatic placement
    pub row: Option<i32>,
    /// The grid column, None for automatic placement
    pub column: Option<i32>,
    /// The width in grid columns
    pub width: i32,
    /// The height in grid rows
    pub height: i32,
}

impl VisCard {
    /// The `@vis card` tag. Negative rows are dropped, the width is limited to the grid, the column to the
    /// free space.
    pub fn tag(&self) -> AnnotationTag {
        let width = self.width.clamp(1, GRID_COLUMNS);
        let mut line = String::from("card");
        if let Some(row) = self.row.filter(|&r| r >= 0) {
            line.push_str(&format!(" row={row}"));
        }
        if let Some(column) = self.column {
            line.push_str(&format!(" column={}", column.clamp(0, GRID_COLUMNS - width)));
        }
        line.push_str(&format!(" width={width} height={}", self.height.max(1)));
        AnnotationTag::new(VIS_TAG, vec![line])
    }
}


/// Is a tag a `@vis` tag?
fn is_vis(tag: &AnnotationTag) -> bool {
    tag.name == VIS_TAG
}

/// Is a tag the renderer of a visualization?
fn is_renderer(tag: &AnnotationTag) -> bool {
    is_vis(tag) && matches!(tag.kind(), "vegalite" | "markdown" | "table")
}

/// Is a tag the dashboard placement of a visualization?
fn is_card(tag: &AnnotationTag) -> bool {
    is_vis(tag) && tag.kind() == "card"
}

/// Rewrite the annotation of a query
fn rewrite_query(
    text: &str,
    parsed: &ParsedScript,
    statement_id: usize,
    edit: impl FnOnce(&mut Annotation) -> Result<Option<usize>>,
) -> Result<(String, Option<TextSpan>)> {
    if !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    let statement = parsed.statements.get(statement_id).ok_or_else(|| Error::invalid_argument("unknown statement"))?;
    if statement.statement_type != StatementType::SELECT {
        return Err(Error::invalid_argument("@vis visualizes a query"));
    }
    crate::annotation::rewrite(text, parsed, statement_id, edit)
}

/// Set or remove the renderer of a query. Returns the new text and the span of the written tag.
pub(crate) fn rewrite_vis_renderer_tag(
    text: &str,
    parsed: &ParsedScript,
    statement_id: usize,
    renderer: Option<&VisRenderer>,
) -> Result<(String, Option<TextSpan>)> {
    rewrite_query(text, parsed, statement_id, |annotation| {
        let tags = &mut annotation.tags;
        Ok(match (renderer, tags.iter().position(is_renderer)) {
            (Some(renderer), Some(i)) => {
                tags[i] = renderer.tag();
                Some(i)
            }
            (Some(renderer), None) => {
                let i = tags.iter().position(is_vis).unwrap_or(tags.len());
                tags.insert(i, renderer.tag());
                Some(i)
            }
            (None, Some(i)) => {
                tags.remove(i);
                None
            }
            (None, None) => None,
        })
    })
}

/// Set or remove the renderer of a query
pub fn rewrite_vis_renderer(text: &str, parsed: &ParsedScript, statement_id: usize, renderer: Option<&VisRenderer>) -> Result<String> {
    Ok(rewrite_vis_renderer_tag(text, parsed, statement_id, renderer)?.0)
}

/// Set or remove the card of a query, a query needs a renderer for a card
pub fn rewrite_vis_card(text: &str, parsed: &ParsedScript, statement_id: usize, card: Option<&VisCard>) -> Result<String> {
    let (text, _) = rewrite_query(text, parsed, statement_id, |annotation| {
        let tags = &mut annotation.tags;
        Ok(match (card, tags.iter().position(is_card)) {
            (Some(card), Some(i)) => {
                tags[i] = card.tag();
                Some(i)
            }
            (Some(card), None) => {
                let renderer = tags.iter().position(is_renderer).ok_or_else(|| Error::invalid_argument("the query has no @vis renderer"))?;
                tags.insert(renderer + 1, card.tag());
                Some(renderer + 1)
            }
            (None, Some(i)) => {
                tags.remove(i);
                None
            }
            (None, None) => None,
        })
    })?;
    Ok(text)
}
