//! Visualizations from `@vis` comment tags.
//!
//! A statement is visualized by the `@vis` tags among its description comments:
//!
//! ```sql
//! /* @vis vegalite {"mark": "bar", "encoding": {"x": {"field": "region"}}}
//!    @vis card width=6 height=3 */
//! select region, revenue from sales;
//! ```
//!
//! A tag starts with its kind. `vegalite` takes a Vega-Lite spec as JSON object without `data`,
//! `markdown` takes a row template, `table` takes nothing, and `card` takes the dashboard placement as
//! `key=value` args. A statement has at most one renderer (`vegalite`, `markdown` or `table`) and at
//! most one card, the first one wins. Problems are warnings with a span inside the comment.

use super::state::AnalysisState;
use super::types::*;
use super::AnalyzedScript;
use crate::vis_text::{JsonScanner, JsonSlot, TagText};
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::{CommentBlockType, StatementType};
use dashql_parser::comment_blocks::CommentBlock;
use dashql_parser::span::TextSpan;
use serde_json::{Map, Value};
use std::collections::HashSet;

/// The tag of visualizations
const VIS_TAG: &str = "vis";
/// The dashboard grid has 12 columns
const GRID_COLUMNS: i64 = 12;
/// The output columns listed in the message of an unknown field
const LISTED_COLUMNS: usize = 8;

/// Split at the first whitespace, the rest starts at the next non-whitespace byte
fn split_word(text: &str, from: usize) -> (usize, usize, usize) {
    let bytes = text.as_bytes();
    let mut begin = from;
    while begin < bytes.len() && bytes[begin].is_ascii_whitespace() {
        begin += 1;
    }
    let mut end = begin;
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() {
        end += 1;
    }
    let mut rest = end;
    while rest < bytes.len() && bytes[rest].is_ascii_whitespace() {
        rest += 1;
    }
    (begin, end, rest)
}

fn warn(state: &mut AnalysisState, span: TextSpan, message: String) {
    state.out.errors.push(AnalyzerError {
        error_type: AnalyzerErrorType::INVALID_VIS_TAG,
        severity: AnalyzerErrorSeverity::WARNING,
        ast_node_id: None,
        symbol_span: None,
        text_span: Some(span),
        message,
    });
}

fn warn_layout(state: &mut AnalysisState, span: TextSpan, message: &str) {
    state.out.errors.push(AnalyzerError {
        error_type: AnalyzerErrorType::INVALID_DASHBOARD_LAYOUT,
        severity: AnalyzerErrorSeverity::WARNING,
        ast_node_id: None,
        symbol_span: None,
        text_span: Some(span),
        message: message.to_string(),
    });
}

/// The names of the output columns of a statement, None if they are not fully known
fn statement_columns(state: &AnalysisState, root: u32) -> Option<HashSet<String>> {
    let mut scope = &state.out.name_scopes[*state.out.name_scopes_by_root_node.get(&root)? as usize];
    // Set operations expose the columns of their left input
    if scope.output_columns.is_empty() && !scope.child_scopes.is_empty() {
        scope = &state.out.name_scopes[scope.child_scopes[0] as usize];
    }
    // A star over a relation with an unknown schema hides columns
    if scope.result_targets.iter().any(|rt| rt.is_star) {
        let unknown = scope.sources.iter().any(|s| match &s.table {
            ReferencedTable::Table(loc) => state.table(*loc).is_none(),
            ReferencedTable::Unresolved(_) => true,
            _ => false,
        });
        if unknown || scope.output_columns.is_empty() {
            return None;
        }
    }
    Some(scope.output_columns.iter().map(|c| c.column_name.text.to_string()).collect())
}

/// Collect the `field` references and the names that the spec defines itself (`as`)
fn collect_fields<'v>(value: &'v Value, fields: &mut Vec<&'v str>, defined: &mut HashSet<&'v str>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                match (key.as_str(), value) {
                    ("field", Value::String(field)) => fields.push(field),
                    ("as", Value::String(name)) => {
                        defined.insert(name);
                    }
                    ("as", Value::Array(names)) => defined.extend(names.iter().filter_map(Value::as_str)),
                    _ => collect_fields(value, fields, defined),
                }
            }
        }
        Value::Array(values) => values.iter().for_each(|v| collect_fields(v, fields, defined)),
        _ => {}
    }
}

/// The location of a `field` value in the JSON text
fn find_field(json: &str, field: &str) -> Option<(usize, usize)> {
    let text = json.as_bytes();
    JsonScanner::new(text)
        .find(|t| matches!(&t.slot, Some(JsonSlot::Value(key)) if key == "field") && t.string(text).as_deref() == Some(field))
        .map(|t| (t.begin, t.end))
}

/// The parsed `@vis` tags of a statement
#[derive(Default)]
struct StatementTags {
    /// The renderer and the tag that named it
    renderer: Option<(&'static str, TextSpan)>,
    /// The Vega-Lite spec
    vegalite: Option<Map<String, Value>>,
    /// The Markdown row template
    markdown: Option<String>,
    /// The dashboard placement and the tag that set it
    card: Option<(DashboardSpec, TextSpan)>,
}

impl StatementTags {
    fn set_renderer(&mut self, state: &mut AnalysisState, renderer: &'static str, span: TextSpan) -> bool {
        if let Some((first, _)) = self.renderer {
            warn(state, span, format!("the statement is already visualized by @vis {first}, this tag is ignored"));
            return false;
        }
        self.renderer = Some((renderer, span));
        true
    }

    fn read_vegalite(&mut self, state: &mut AnalysisState, tag: &TagText, body: usize, kind: TextSpan, columns: Option<&HashSet<String>>) {
        let json = &tag.text[body..];
        if json.trim().is_empty() {
            warn(state, kind, "@vis vegalite needs a Vega-Lite spec as JSON object".into());
            return;
        }
        let mut spec = match serde_json::from_str::<Value>(json) {
            Ok(Value::Object(spec)) => spec,
            Ok(_) => {
                warn(state, tag.span(body, tag.text.len().min(body + 1)), "the Vega-Lite spec must be a JSON object".into());
                return;
            }
            Err(e) => {
                // serde_json counts lines and columns from 1, the columns in bytes
                let line_begin = json.split('\n').take(e.line().saturating_sub(1)).map(|l| l.len() + 1).sum::<usize>();
                let at = (body + line_begin + e.column().saturating_sub(1)).min(tag.text.len());
                let line_end = tag.text[at..].find('\n').map_or(tag.text.len(), |n| at + n);
                warn(state, tag.span(at, line_end.max(at)), format!("invalid Vega-Lite JSON: {e}"));
                return;
            }
        };
        if spec.remove("data").is_some() {
            let span = find_key(json, "data").map_or(kind, |(b, e)| tag.span(body + b, body + e));
            warn(state, span, "data is ignored, the statement is the data of the chart".into());
        }
        if let Some(columns) = columns {
            let value = Value::Object(spec);
            let (mut fields, mut defined) = (Vec::new(), HashSet::new());
            collect_fields(&value, &mut fields, &mut defined);
            for field in fields {
                // Nested fields refer to a column by their first part
                let column = field.split(['.', '[']).next().unwrap_or(field);
                if columns.contains(field) || columns.contains(column) || defined.contains(field) {
                    continue;
                }
                let span = find_field(json, field).map_or(kind, |(b, e)| tag.span(body + b, body + e));
                let mut listed: Vec<&str> = columns.iter().map(String::as_str).collect();
                listed.sort_unstable();
                let more = listed.len().saturating_sub(LISTED_COLUMNS);
                listed.truncate(LISTED_COLUMNS);
                let mut message = format!("unknown field \"{field}\", the statement has the columns {}", listed.join(", "));
                if more > 0 {
                    message.push_str(&format!(" and {more} more"));
                }
                warn(state, span, message);
            }
            let Value::Object(object) = value else { unreachable!() };
            spec = object;
        }
        self.vegalite = Some(spec);
    }

    fn read_card(&mut self, state: &mut AnalysisState, tag: &TagText, args: usize, kind: TextSpan) {
        if self.card.is_some() {
            warn(state, kind, "the statement already has a @vis card, this tag is ignored".into());
            return;
        }
        let (mut row, mut column, mut width, mut height) = (None, None, None, None);
        let mut at = args;
        while at < tag.text.len() {
            let (begin, end, next) = split_word(&tag.text, at);
            if begin == end {
                break;
            }
            at = next;
            let arg = &tag.text[begin..end];
            let span = tag.span(begin, end);
            let Some((key, value)) = arg.split_once('=') else {
                warn(state, span, format!("@vis card takes key=value args, not \"{arg}\""));
                continue;
            };
            let slot = match key {
                "row" => &mut row,
                "column" => &mut column,
                "width" => &mut width,
                "height" => &mut height,
                _ => {
                    warn(state, span, format!("unknown @vis card arg \"{key}\", expected row, column, width or height"));
                    continue;
                }
            };
            match value.parse::<i64>() {
                Ok(value) => *slot = Some((value, span)),
                Err(_) => warn(state, span, format!("@vis card {key} must be an integer")),
            }
        }
        self.card = Some((normalize_card(state, row, column, width, height), kind));
    }
}

/// The location of a key of the top-level JSON object
fn find_key(json: &str, key: &str) -> Option<(usize, usize)> {
    let text = json.as_bytes();
    JsonScanner::new(text)
        .find(|t| t.depth == 1 && t.slot == Some(JsonSlot::Key) && t.string(text).as_deref() == Some(key))
        .map(|t| (t.begin, t.end))
}

/// Normalize the dashboard placement: coordinates are non-negative, the width is 1 to 12, the height at
/// least 1, and a card is moved left to fit the grid
fn normalize_card(
    state: &mut AnalysisState,
    row: Option<(i64, TextSpan)>,
    column: Option<(i64, TextSpan)>,
    width: Option<(i64, TextSpan)>,
    height: Option<(i64, TextSpan)>,
) -> DashboardSpec {
    let mut spec = DashboardSpec::default();
    let mut column_was_clamped = false;
    if let Some((value, span)) = row {
        if value < 0 {
            warn_layout(state, span, "dashboard row must be non-negative and was removed");
        } else {
            spec.row = Some(value as i32);
        }
    }
    if let Some((value, span)) = column {
        if value < 0 {
            warn_layout(state, span, "dashboard column must be non-negative and was removed");
        } else {
            spec.column = Some(value.min(GRID_COLUMNS - 1) as i32);
            if value > GRID_COLUMNS - 1 {
                column_was_clamped = true;
                warn_layout(state, span, "dashboard column was clamped to 11");
            }
        }
    }
    if let Some((value, span)) = width {
        spec.width = value.clamp(1, GRID_COLUMNS) as i32;
        if !(1..=GRID_COLUMNS).contains(&value) {
            warn_layout(state, span, "dashboard width was clamped to the range 1..12");
        }
    }
    if let Some((value, span)) = height {
        spec.height = value.max(1).min(i32::MAX as i64) as i32;
        if value < 1 {
            warn_layout(state, span, "dashboard height was clamped to 1");
        }
    }
    if let (Some(c), Some((_, span))) = (spec.column, column) {
        if c + spec.width > GRID_COLUMNS as i32 {
            spec.column = Some(GRID_COLUMNS as i32 - spec.width);
            if !column_was_clamped {
                warn_layout(state, span, "dashboard column was moved so column + width does not exceed 12");
            }
        }
    }
    spec
}

/// Does a statement produce rows to visualize?
fn is_query(statement_type: StatementType) -> bool {
    matches!(statement_type, StatementType::SELECT)
}

/// The `@vis` tags among the description comments of a statement
fn statement_vis_tags<'p>(
    parsed: &'p dashql_parser::parser::ParsedScript,
    description: &dashql_parser::parser::StatementDescription,
) -> impl Iterator<Item = &'p CommentBlock> {
    let script = parsed.scanned.text.as_str();
    let begin = description.description_blocks_begin as usize;
    parsed.comment_blocks.blocks[begin..begin + description.description_blocks_count as usize]
        .iter()
        .filter(move |b| {
            b.block_type == CommentBlockType::DASHQL_TAG && &script[b.tag_span.offset as usize..b.tag_span.end() as usize] == VIS_TAG
        })
}

/// Does a statement have `@vis` tags? The compiler visualizes such a query.
pub fn has_vis_tags(parsed: &dashql_parser::parser::ParsedScript, statement_id: usize) -> bool {
    let descriptions = parsed.associate_descriptions();
    descriptions.get(statement_id).is_some_and(|d| statement_vis_tags(parsed, d).next().is_some())
}

/// The output column names of an analyzed statement, for the completion of fields
pub fn statement_output_columns(analyzed: &AnalyzedScript, statement_id: usize) -> Vec<std::sync::Arc<str>> {
    let Some(statement) = analyzed.parsed.statements.get(statement_id) else { return Vec::new() };
    let Some(&scope) = analyzed.name_scopes_by_root_node.get(&statement.root) else { return Vec::new() };
    let mut scope = &analyzed.name_scopes[scope as usize];
    // Set operations expose the columns of their left input
    if scope.output_columns.is_empty() && !scope.child_scopes.is_empty() {
        scope = &analyzed.name_scopes[scope.child_scopes[0] as usize];
    }
    let mut columns: Vec<std::sync::Arc<str>> = Vec::new();
    for column in &scope.output_columns {
        if !column.column_name.text.is_empty() && !columns.contains(&column.column_name.text) {
            columns.push(column.column_name.text.clone());
        }
    }
    columns
}

/// The first renderer tag (`vegalite`, `markdown` or `table`) of a statement, the one that wins
pub fn vis_renderer_tag(parsed: &dashql_parser::parser::ParsedScript, statement_id: usize) -> Option<CommentBlock> {
    let script = parsed.scanned.text.as_str();
    let descriptions = parsed.associate_descriptions();
    statement_vis_tags(parsed, descriptions.get(statement_id)?)
        .find(|block| {
            let lines = &parsed.comment_blocks.lines[block.lines_begin as usize..][..block.lines_count as usize];
            let Some(line) = lines.first() else { return false };
            let text = &script[line.offset as usize..line.end() as usize];
            let (begin, end, _) = split_word(text, 0);
            matches!(&text[begin..end], "vegalite" | "markdown" | "table")
        })
        .copied()
}

/// Build the visualization specs of the statements with `@vis` tags
pub(super) fn analyze(state: &mut AnalysisState) {
    let parsed = state.parsed;
    let script = parsed.scanned.text.as_str();
    let blocks = &parsed.comment_blocks;
    let descriptions = parsed.associate_descriptions();
    for (statement_id, statement) in parsed.statements.iter().enumerate() {
        let Some(description) = descriptions.get(statement_id) else { continue };
        let tags: Vec<&CommentBlock> = statement_vis_tags(parsed, description).collect();
        if tags.is_empty() {
            continue;
        }
        if !is_query(statement.statement_type) {
            for block in tags {
                warn(state, block.tag_span, "@vis visualizes a query, this statement returns no rows".into());
            }
            continue;
        }
        let columns = statement_columns(state, statement.root);
        let mut out = StatementTags::default();
        for block in tags {
            let lines = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
            let tag = TagText::new(script, lines, block.text_span);
            let (kind_begin, kind_end, rest) = split_word(&tag.text, 0);
            let kind = &tag.text[kind_begin..kind_end];
            let kind_span = if kind.is_empty() { block.tag_span } else { tag.span(kind_begin, kind_end) };
            let body = tag.text[rest..].trim();
            match kind {
                "vegalite" => {
                    if out.set_renderer(state, "vegalite", kind_span) {
                        out.read_vegalite(state, &tag, rest, kind_span, columns.as_ref());
                    }
                }
                "markdown" => {
                    if out.set_renderer(state, "markdown", kind_span) {
                        if body.is_empty() {
                            warn(state, kind_span, "@vis markdown needs a row template".into());
                        }
                        out.markdown = Some(tag.text[rest..].to_string());
                    }
                }
                "table" => {
                    if out.set_renderer(state, "table", kind_span) && !body.is_empty() {
                        warn(state, tag.span(rest, tag.text.len()), "@vis table takes no args, they are ignored".into());
                    }
                }
                "card" => out.read_card(state, &tag, rest, kind_span),
                "" => warn(state, block.tag_span, "@vis needs a kind: vegalite, markdown, table or card".into()),
                _ => warn(state, kind_span, format!("unknown @vis kind \"{kind}\", expected vegalite, markdown, table or card")),
            }
        }
        let Some((renderer, _)) = out.renderer else {
            if let Some((_, span)) = out.card {
                warn(state, span, "@vis card places a visualization, the statement needs @vis vegalite, markdown or table".into());
            }
            continue;
        };
        // A renderer without a valid body was a warning, the statement stays a plain query
        let markdown_is_empty = out.markdown.as_deref().is_none_or(|m| m.trim().is_empty());
        if (renderer == "vegalite" && out.vegalite.is_none()) || (renderer == "markdown" && markdown_is_empty) {
            continue;
        }
        state.out.visualization_specs.push(VisualizationSpec {
            ast_node_id: statement.root,
            ast_statement_id: Some(statement_id as u32),
            renderer: Some(renderer.to_string()),
            dashboard: out.card.map(|(card, _)| card).unwrap_or_default(),
            markdown: out.markdown.map(|row_template| MarkdownSpec { row_template }),
            vegalite: out.vegalite,
        });
    }
}
