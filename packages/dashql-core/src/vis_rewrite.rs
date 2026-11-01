//! Rewrite the visualization tags of a query: set, replace or remove its renderer (`@vis`) and its board
//! placement (`@board`), and the flow position of a script (`@flow`).
//!
//! The tags are edited in the annotation of the query (see `annotation`), so an edit leaves the annotation
//! consolidated in one comment. The edited tag is printed anew, the other tags keep their content. A new
//! renderer goes before the other `@vis` tags, a new board placement after the renderer. The tags of older
//! scripts, `@vis board`, `@vis card` and `@vis flow`, are replaced by `@board` and `@flow`. `/*` and `*/` in
//! the strings of a Vega-Lite spec are escaped, they would nest or end the comment.

use crate::annotation::{Annotation, AnnotationTag};
use crate::error::{Error, Result};
use dashql_buffers::parser::StatementType;
use dashql_buffers::status::StatusCode;
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;
use serde_json::{Map, Value};

/// The tag of visualizations
const VIS_TAG: &str = "vis";
/// The tag of the dashboard placement of a visualization
const BOARD_TAG: &str = "board";
/// The tag of the position of a script on the dataflow canvas
const FLOW_TAG: &str = "flow";
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
pub struct VisBoard {
    /// The grid row, None for automatic placement
    pub row: Option<i32>,
    /// The grid column, None for automatic placement
    pub column: Option<i32>,
    /// The width in grid columns
    pub width: i32,
    /// The height in grid rows
    pub height: i32,
}

impl VisBoard {
    /// The `@board` tag. Negative rows are dropped, the width is limited to the grid, the column to the
    /// free space.
    pub fn tag(&self) -> AnnotationTag {
        let width = self.width.clamp(1, GRID_COLUMNS);
        let mut args = Vec::new();
        if let Some(row) = self.row.filter(|&r| r >= 0) {
            args.push(format!("row={row}"));
        }
        if let Some(column) = self.column {
            args.push(format!("column={}", column.clamp(0, GRID_COLUMNS - width)));
        }
        args.push(format!("width={width} height={}", self.height.max(1)));
        AnnotationTag::new(BOARD_TAG, vec![args.join(" ")])
    }
}

/// The position of a script on the dataflow canvas
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VisFlow {
    /// The x coordinate of the left edge
    pub x: i32,
    /// The y coordinate of the top edge
    pub y: i32,
}

impl VisFlow {
    /// The `@flow` tag
    pub fn tag(&self) -> AnnotationTag {
        AnnotationTag::new(FLOW_TAG, vec![format!("x={} y={}", self.x, self.y)])
    }
}

/// Is a tag a `@vis` tag?
fn is_vis(tag: &AnnotationTag) -> bool {
    tag.name == VIS_TAG
}

/// Is a tag a tag of the visualization: `@vis`, `@board` or `@flow`?
pub(crate) fn is_vis_family(tag: &AnnotationTag) -> bool {
    matches!(tag.name.as_str(), VIS_TAG | BOARD_TAG | FLOW_TAG)
}

/// Is a tag the renderer of a visualization?
fn is_renderer(tag: &AnnotationTag) -> bool {
    is_vis(tag) && matches!(tag.kind(), "vegalite" | "markdown" | "table")
}

/// Is a tag the dashboard placement of a visualization, `@board` or the `@vis board` of older scripts?
fn is_board(tag: &AnnotationTag) -> bool {
    tag.name == BOARD_TAG || (is_vis(tag) && matches!(tag.kind(), "board" | "card"))
}

/// Is a tag the flow position of a script, `@flow` or the `@vis flow` of older scripts?
fn is_flow(tag: &AnnotationTag) -> bool {
    tag.name == FLOW_TAG || (is_vis(tag) && tag.kind() == "flow")
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
                let i = tags.iter().position(is_vis_family).unwrap_or(tags.len());
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

/// Set or remove the board placement of a query, a query needs a renderer to be placed
pub fn rewrite_vis_board(text: &str, parsed: &ParsedScript, statement_id: usize, board: Option<&VisBoard>) -> Result<String> {
    let (text, _) = rewrite_query(text, parsed, statement_id, |annotation| {
        let tags = &mut annotation.tags;
        Ok(match (board, tags.iter().position(is_board)) {
            (Some(board), Some(i)) => {
                tags[i] = board.tag();
                Some(i)
            }
            (Some(board), None) => {
                let renderer = tags.iter().position(is_renderer).ok_or_else(|| Error::invalid_argument("the query has no @vis renderer"))?;
                tags.insert(renderer + 1, board.tag());
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

/// Set or remove the flow position of a script. The position is a tag of any statement: the first `@flow` tag in
/// statement order is replaced where it is, the others are removed, and a new one goes after the visualization tags of
/// the terminal statement. Removing the position removes every `@flow` tag.
pub fn rewrite_vis_flow(text: &str, parsed: &ParsedScript, flow: Option<&VisFlow>) -> Result<String> {
    let insert_at = |tags: &[AnnotationTag]| tags.iter().rposition(is_vis_family).map_or(tags.len(), |i| i + 1);
    crate::annotation::rewrite_script_tag(text, parsed, is_flow, flow.map(VisFlow::tag), None, insert_at)
}
