//! Rewrite the `@vis` tags of a query: set, replace or remove its renderer and its card.
//!
//! An edit touches only the tag it changes, other tags, prose and the layout of the comment stay as
//! written. A replaced tag keeps its place, a new tag goes next to the other `@vis` tags of the query,
//! and a query without tags gets a new block comment in front of it. The tags are printed like the
//! formatter prints them, continuation lines take the prefix of the tag line (`-- `, ` * ` or the
//! indentation). Removing the last tag of a comment removes the comment.
//!
//! The spans of the parsed script are applied to the given text, which may be newer than the parse
//! (see docs/design/core_quirks.md).

use crate::error::{Error, Result};
use dashql_buffers::parser::{CommentBlockType, StatementType};
use dashql_buffers::status::StatusCode;
use dashql_parser::comment_blocks::CommentBlock;
use dashql_parser::parser::ParsedScript;
use serde_json::{Map, Value};

/// The tag of visualizations
const VIS_TAG: &[u8] = b"vis";
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

    /// The lines of the tag
    fn lines(&self) -> Vec<String> {
        match self {
            VisRenderer::VegaLite(spec) => {
                let json = serde_json::to_string_pretty(&Value::Object(spec.clone())).expect("a JSON value always serializes");
                // `/*` and `*/` can only be part of JSON strings, escapes split them without changing the
                // value: `/*` would nest and `*/` would end a block comment
                let json = json.replace("/*", "/\\u002a").replace("*/", "*\\/");
                std::iter::once("@vis vegalite".to_string()).chain(json.lines().map(str::to_string)).collect()
            }
            VisRenderer::Markdown(template) => {
                std::iter::once("@vis markdown".to_string()).chain(template.trim_end().lines().map(str::to_string)).collect()
            }
            VisRenderer::Table => vec!["@vis table".to_string()],
        }
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
    /// The line of the tag. Negative rows are dropped, the width is limited to the grid, the column to
    /// the free space.
    fn lines(&self) -> Vec<String> {
        let width = self.width.clamp(1, GRID_COLUMNS);
        let mut line = String::from("@vis card");
        if let Some(row) = self.row.filter(|&r| r >= 0) {
            line.push_str(&format!(" row={row}"));
        }
        if let Some(column) = self.column {
            line.push_str(&format!(" column={}", column.clamp(0, GRID_COLUMNS - width)));
        }
        line.push_str(&format!(" width={width} height={}", self.height.max(1)));
        vec![line]
    }
}

/// A `@vis` tag of the query
#[derive(Clone, Copy)]
struct Tag<'a> {
    block: &'a CommentBlock,
    /// The `@` of the tag
    at: usize,
    /// The end of the last content line
    end: usize,
    /// The first word of the content
    kind: &'a str,
}

impl Tag<'_> {
    fn is_renderer(&self) -> bool {
        matches!(self.kind, "vegalite" | "markdown" | "table")
    }
}

/// An edit of the script text
struct Rewrite<'a> {
    parsed: &'a ParsedScript,
    text: String,
}

impl<'a> Rewrite<'a> {
    fn script(&self) -> &'a [u8] {
        self.parsed.scanned.text.as_bytes()
    }

    /// The `@vis` tags among the description comments of a statement
    fn tags(&self, statement_id: usize) -> Vec<Tag<'a>> {
        let parsed = self.parsed;
        let script = self.script();
        let blocks = &parsed.comment_blocks;
        let Some(description) = parsed.associate_descriptions().get(statement_id).copied() else { return Vec::new() };
        let begin = description.description_blocks_begin as usize;
        blocks.blocks[begin..begin + description.description_blocks_count as usize]
            .iter()
            .filter(|b| {
                b.block_type == CommentBlockType::DASHQL_TAG
                    && &script[b.tag_span.offset as usize..b.tag_span.end() as usize] == VIS_TAG
            })
            .map(|block| {
                let lines = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
                let end = lines.last().map_or(block.tag_span.end() as usize, |l| l.end() as usize);
                let kind = lines.first().map_or("", |first| {
                    let line = &parsed.scanned.text[first.offset as usize..first.end() as usize];
                    line.split_whitespace().next().unwrap_or("")
                });
                Tag { block, at: block.tag_span.offset as usize - 1, end, kind }
            })
            .collect()
    }

    fn line_begin(&self, offset: usize) -> usize {
        self.text.as_bytes()[..offset].iter().rposition(|&c| c == b'\n').map_or(0, |n| n + 1)
    }

    fn line_end(&self, offset: usize) -> usize {
        self.text.as_bytes()[offset..].iter().position(|&c| c == b'\n').map_or(self.text.len(), |n| offset + n)
    }

    /// Is the tag in a block comment?
    fn in_block_comment(&self, tag: &Tag) -> bool {
        let comment = self.parsed.scanned.comments[tag.block.comments_begin as usize];
        self.script()[comment.offset as usize..].starts_with(b"/*")
    }

    /// The prefix of continuation lines: the text before the tag on its line, the comment start becomes
    /// spaces
    fn prefix(&self, tag: &Tag) -> String {
        let raw = &self.text[self.line_begin(tag.at)..tag.at];
        if raw.contains("/*") {
            " ".repeat(raw.len())
        } else {
            raw.to_string()
        }
    }

    /// The lines of a tag in a comment, `/*` would nest and `*/` would end a block comment
    fn render(&self, lines: &[String], prefix: &str, block_comment: bool) -> Result<String> {
        if block_comment && lines.iter().any(|l| l.contains("/*") || l.contains("*/")) {
            return Err(Error::invalid_argument("a @vis tag in a block comment cannot contain /* or */"));
        }
        let mut out = lines[0].clone();
        for line in &lines[1..] {
            out.push('\n');
            if line.is_empty() {
                out.push_str(prefix.trim_end());
            } else {
                out.push_str(prefix);
                out.push_str(line);
            }
        }
        Ok(out)
    }

    /// Are the offsets of a tag valid in the text? The text can be newer than the parse.
    fn check(&self, tag: &Tag) -> Result<()> {
        let valid = |offset: usize| offset <= self.text.len() && self.text.is_char_boundary(offset);
        if valid(tag.at) && valid(tag.end) && valid(tag.block.text_span.end() as usize) {
            Ok(())
        } else {
            Err(Error::invalid_argument("the parsed script is outdated"))
        }
    }

    /// Replace a text range. A tag of several lines that leaves `*/` alone at the end of its line
    /// moves it onto a line of its own.
    fn splice_tag(&mut self, begin: usize, end: usize, insert: &str, tag_lines: usize) -> Result<()> {
        self.splice(begin, end, insert)?;
        let after = begin + insert.len();
        let line_end = self.line_end(after);
        if tag_lines > 1 && self.text[after..line_end].trim() == "*/" {
            let spaces = self.text[after..line_end].len() - self.text[after..line_end].trim_start().len();
            self.text.replace_range(after..after + spaces, "\n");
        }
        Ok(())
    }

    /// Replace a text range
    fn splice(&mut self, begin: usize, end: usize, insert: &str) -> Result<()> {
        if begin > self.text.len() || !self.text.is_char_boundary(begin) {
            // std::string::replace throws std::out_of_range
            return Err(Error::invalid_argument("basic_string::replace: position out of range"));
        }
        let end = end.clamp(begin, self.text.len());
        if !self.text.is_char_boundary(end) {
            return Err(Error::invalid_argument("basic_string::replace: position out of range"));
        }
        self.text.replace_range(begin..end, insert);
        Ok(())
    }

    fn replace(&mut self, tag: &Tag, lines: &[String]) -> Result<()> {
        self.check(tag)?;
        let rendered = self.render(lines, &self.prefix(tag), self.in_block_comment(tag))?;
        self.splice_tag(tag.at, tag.end, &rendered, lines.len())
    }

    fn insert_before(&mut self, tag: &Tag, lines: &[String]) -> Result<()> {
        self.check(tag)?;
        let prefix = self.prefix(tag);
        let rendered = self.render(lines, &prefix, self.in_block_comment(tag))?;
        self.splice(tag.at, tag.at, &format!("{rendered}\n{prefix}"))
    }

    fn insert_after(&mut self, tag: &Tag, lines: &[String]) -> Result<()> {
        self.check(tag)?;
        let prefix = self.prefix(tag);
        let rendered = self.render(lines, &prefix, self.in_block_comment(tag))?;
        self.splice_tag(tag.end, tag.end, &format!("\n{prefix}{rendered}"), lines.len())
    }

    /// Insert a block comment in front of a statement
    fn insert_comment(&mut self, statement_id: usize, lines: &[String]) -> Result<()> {
        let at = self.parsed.associate_descriptions()[statement_id].statement_span.offset as usize;
        let comment = match lines {
            [line] => format!("/* {line} */\n"),
            _ => format!("/* {}\n*/\n", self.render(lines, "   ", true)?),
        };
        self.splice(at, at, &comment)
    }

    fn remove(&mut self, tag: &Tag) -> Result<()> {
        self.check(tag)?;
        let parsed = self.parsed;
        let blocks = &parsed.comment_blocks.blocks;
        let comments = &parsed.scanned.comments;
        let first = tag.block.comments_begin as usize;
        let mut last = first + tag.block.comments_count as usize - 1;
        if self.in_block_comment(tag) {
            let comment = comments[first];
            let shares_comment = blocks.iter().filter(|b| b.comments_begin as usize == first).count() > 1;
            if !shares_comment {
                // The tag is the whole comment, with the blanks and the line break after it
                let mut end = comment.end() as usize;
                while matches!(self.text.as_bytes().get(end), Some(b' ' | b'\t')) {
                    end += 1;
                }
                if self.text.as_bytes().get(end) == Some(&b'\n') {
                    end += 1;
                }
                return self.splice(comment.offset as usize, end, "");
            }
            if self.text[self.line_begin(tag.at)..tag.at].contains("/*") {
                // The first tag of the comment, the next tag moves up
                return self.splice(tag.at, tag.block.text_span.end() as usize, "");
            }
            let line_begin = self.line_begin(tag.at);
            let line_end = self.line_end(tag.end);
            return if self.text[tag.end..line_end].trim().is_empty() {
                self.splice(line_begin, (line_end + 1).min(self.text.len()), "")
            } else {
                // The comment closes after the tag, it now closes after the previous line
                self.splice(line_begin - 1, tag.end, "")
            };
        }
        // A region of line comments that the end line closes keeps the end line for the region before it
        let script = self.script();
        let closes = {
            let c = comments[last];
            let text = &script[c.offset as usize..c.end() as usize];
            text.iter().position(|&b| b != b'-').is_some_and(|i| text[i..].trim_ascii() == b"@end")
        };
        let region_before = blocks.iter().any(|b| {
            b.block_type == CommentBlockType::DASHQL_TAG && (b.comments_begin + b.comments_count) as usize == first
        });
        if closes && region_before && last > first {
            last -= 1;
        }
        let begin = self.line_begin(comments[first].offset as usize);
        let mut end = comments[last].end() as usize;
        if self.text.as_bytes().get(end) == Some(&b'\n') {
            end += 1;
        }
        self.splice(begin, end, "")
    }
}

/// Check that a statement can be rewritten
fn rewrite<'a>(text: &str, parsed: &'a ParsedScript, statement_id: usize) -> Result<Rewrite<'a>> {
    if !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    let statement = parsed.statements.get(statement_id).ok_or_else(|| Error::invalid_argument("unknown statement"))?;
    if statement.statement_type != StatementType::SELECT {
        return Err(Error::invalid_argument("@vis visualizes a query"));
    }
    Ok(Rewrite { parsed, text: text.to_string() })
}

/// Set or remove the renderer of a query
pub fn rewrite_vis_renderer(text: &str, parsed: &ParsedScript, statement_id: usize, renderer: Option<&VisRenderer>) -> Result<String> {
    let mut rewrite = rewrite(text, parsed, statement_id)?;
    let tags = rewrite.tags(statement_id);
    let current = tags.iter().find(|t| t.is_renderer());
    match (renderer, current) {
        (Some(renderer), Some(tag)) => rewrite.replace(tag, &renderer.lines())?,
        (Some(renderer), None) => match tags.first() {
            Some(tag) => rewrite.insert_before(tag, &renderer.lines())?,
            None => rewrite.insert_comment(statement_id, &renderer.lines())?,
        },
        (None, Some(tag)) => rewrite.remove(tag)?,
        (None, None) => {}
    }
    Ok(rewrite.text)
}

/// Set or remove the card of a query, a query needs a renderer for a card
pub fn rewrite_vis_card(text: &str, parsed: &ParsedScript, statement_id: usize, card: Option<&VisCard>) -> Result<String> {
    let mut rewrite = rewrite(text, parsed, statement_id)?;
    let tags = rewrite.tags(statement_id);
    let current = tags.iter().find(|t| t.kind == "card");
    match (card, current) {
        (Some(card), Some(tag)) => rewrite.replace(tag, &card.lines())?,
        (Some(card), None) => {
            let renderer = tags.iter().find(|t| t.is_renderer()).ok_or_else(|| Error::invalid_argument("the query has no @vis renderer"))?;
            rewrite.insert_after(renderer, &card.lines())?
        }
        (None, Some(tag)) => rewrite.remove(tag)?,
        (None, None) => {}
    }
    Ok(rewrite.text)
}
