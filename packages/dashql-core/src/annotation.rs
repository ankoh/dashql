//! The annotation of a statement: the comment tags in front of it (`@description`, `@metadata`, `@vis`),
//! read as one list and written back as one comment.
//!
//! An annotation is the text before the first tag of a block comment (the preamble) and the tags in their
//! order. A tag has a name and content lines, the first line is the text on the line of the tag and may be
//! empty. Reading collects the tagged comments of a statement, wherever they are and in whichever form.
//! Writing prints the annotation as one comment in place of the first of them and removes the others,
//! so every edit leaves the annotation consolidated. The content of the tags is not interpreted.
//!
//! Annotations are printed Javadoc-style, the formatter prints tagged comments the same way: a single
//! line stays on the line of `/**` (`/** @vis table */`), otherwise `/**` and `*/` are on lines of their
//! own and every line has a ` * ` gutter, which keeps lines that start with `*`. `/*` would nest and `*/`
//! would end the comment, an annotation with them cannot be printed.
//!
//! The spans of the parsed script are applied to the given text, which may be newer than the parse
//! (see docs/design/core_quirks.md).

use crate::error::{Error, Result};
use dashql_buffers::parser::CommentBlockType;
use dashql_buffers::status::StatusCode;
use dashql_parser::comment_blocks::{is_comment_tag, CommentBlock, CommentBlocks, COMMENT_TAG_END, COMMENT_TAG_PREFIX};
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;
use serde::{Deserialize, Serialize};

/// The gutter of the lines of a printed annotation
pub(crate) const ANNOTATION_GUTTER: &str = " * ";

/// A tag of an annotation, as JSON `{"name": ..., "lines": [...]}`
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnnotationTag {
    /// The tag name without `@`, e.g. `description`
    pub name: String,
    /// The content lines, the first one is the text on the line of the tag and may be empty
    #[serde(default)]
    pub lines: Vec<String>,
}

impl AnnotationTag {
    /// A tag from its name and content lines
    pub fn new(name: impl Into<String>, lines: Vec<String>) -> Self {
        Self { name: name.into(), lines }
    }

    /// A tag with a text that starts on the line after the tag
    pub fn with_text(name: impl Into<String>, text: &str) -> Self {
        Self::new(name, std::iter::once(String::new()).chain(text.lines().map(str::to_string)).collect())
    }

    /// The first word of the content, the kind of a `@vis` tag
    pub fn kind(&self) -> &str {
        self.lines.first().and_then(|l| l.split_whitespace().next()).unwrap_or("")
    }

    /// The content as text: the lines joined with line breaks, without an empty first line
    pub fn text(&self) -> String {
        let lines = match self.lines.split_first() {
            Some((first, rest)) if first.is_empty() => rest,
            _ => &self.lines[..],
        };
        lines.join("\n")
    }

    /// The printed lines: the tag with the text on its line, then the other content lines
    fn printed_lines(&self) -> impl Iterator<Item = String> + '_ {
        let mut first = format!("{COMMENT_TAG_PREFIX}{}", self.name);
        if let Some(text) = self.lines.first().filter(|l| !l.is_empty()) {
            first.push(' ');
            first.push_str(text);
        }
        std::iter::once(first).chain(self.lines.iter().skip(1).cloned())
    }

    /// The number of printed lines
    fn printed_len(&self) -> usize {
        self.lines.len().max(1)
    }
}

/// The annotation of a statement, as JSON `{"preamble": [...], "tags": [...]}`
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Annotation {
    /// The text before the first tag of a block comment
    pub preamble: Vec<String>,
    /// The tags in their order
    pub tags: Vec<AnnotationTag>,
}

/// Does a line start with a known tag? It would start a new tag when read back.
fn starts_with_tag(line: &str) -> bool {
    let Some(rest) = line.trim_start().strip_prefix(COMMENT_TAG_PREFIX) else { return false };
    let name = rest.split(|c: char| c.is_whitespace()).next().unwrap_or("");
    is_comment_tag(name.as_bytes())
}

impl Annotation {
    /// Read an annotation from comment blocks: ordinary blocks are the preamble, tagged blocks the tags.
    /// `text` is the script text.
    pub(crate) fn from_blocks<'a>(text: &[u8], blocks: &CommentBlocks, range: impl Iterator<Item = &'a CommentBlock>) -> Self {
        let span_text = |span: TextSpan| String::from_utf8_lossy(&text[span.offset as usize..span.end() as usize]).into_owned();
        let mut annotation = Annotation::default();
        for block in range {
            let spans = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
            let mut lines: Vec<String> = spans.iter().map(|&l| span_text(l)).collect();
            if block.block_type != CommentBlockType::DASHQL_TAG {
                annotation.preamble.append(&mut lines);
                continue;
            }
            // The parser drops the empty text of a tag that is alone on its line
            let tag_end = block.tag_span.end() as usize;
            let inline = spans.first().is_some_and(|first| !text[tag_end..first.offset as usize].contains(&b'\n'));
            if !inline {
                lines.insert(0, String::new());
            }
            annotation.tags.push(AnnotationTag::new(span_text(block.tag_span), lines));
        }
        annotation
    }

    /// Does the annotation have neither tags nor text?
    pub fn is_empty(&self) -> bool {
        self.preamble.is_empty() && self.tags.is_empty()
    }

    /// The lines of the comment without its markers
    pub fn lines(&self) -> Vec<String> {
        self.preamble.iter().cloned().chain(self.tags.iter().flat_map(AnnotationTag::printed_lines)).collect()
    }

    /// The index of the first printed line of a tag
    fn first_line_of(&self, tag: usize) -> usize {
        self.preamble.len() + self.tags[..tag].iter().map(AnnotationTag::printed_len).sum::<usize>()
    }

    /// Check that the annotation reads back unchanged
    fn check(&self) -> Result<()> {
        for tag in &self.tags {
            if !is_comment_tag(tag.name.as_bytes()) || tag.name == COMMENT_TAG_END {
                return Err(Error::invalid_argument(format!("unknown comment tag \"{}\"", tag.name)));
            }
        }
        let content = self.preamble.iter().chain(self.tags.iter().flat_map(|t| t.lines.iter()));
        for line in content {
            if line.contains(['\n', '\r']) {
                return Err(Error::invalid_argument("a line of a comment tag cannot contain a line break"));
            }
            if line.contains("/*") || line.contains("*/") {
                return Err(Error::invalid_argument("a comment tag cannot contain /* or */"));
            }
        }
        let continued = self.preamble.iter().chain(self.tags.iter().flat_map(|t| t.lines.iter().skip(1)));
        if let Some(line) = continued.into_iter().find(|l| starts_with_tag(l)) {
            return Err(Error::invalid_argument(format!("the line \"{line}\" would start a comment tag")));
        }
        Ok(())
    }

    /// Print the annotation as one comment, the lines after the first take `indent`. Returns the comment and
    /// the spans of its lines without the comment markers.
    pub fn print(&self, indent: &str) -> Result<(String, Vec<(usize, usize)>)> {
        self.check()?;
        let lines = self.lines();
        let mut out = String::new();
        let mut spans = Vec::with_capacity(lines.len());
        if let [line] = &lines[..] {
            out.push_str("/** ");
            spans.push((out.len(), out.len() + line.len()));
            out.push_str(line);
            out.push_str(" */");
            return Ok((out, spans));
        }
        out.push_str("/**");
        for line in &lines {
            out.push('\n');
            out.push_str(indent);
            out.push_str(if line.is_empty() { ANNOTATION_GUTTER.trim_end() } else { ANNOTATION_GUTTER });
            spans.push((out.len(), out.len() + line.len()));
            out.push_str(line);
        }
        out.push('\n');
        out.push_str(indent);
        out.push_str(" */");
        Ok((out, spans))
    }
}

/// Check that a statement of a parsed script can be annotated
fn check_statement(parsed: &ParsedScript, statement_id: usize) -> Result<()> {
    if !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    if statement_id >= parsed.statements.len() {
        return Err(Error::invalid_argument("unknown statement"));
    }
    Ok(())
}

/// Read the annotation of a statement and the comments that hold it, ascending indexes into the comments
/// of the script
fn read_with_comments(parsed: &ParsedScript, statement_id: usize) -> (Annotation, Vec<usize>) {
    let blocks = &parsed.comment_blocks;
    let description = parsed.associate_descriptions()[statement_id];
    let begin = description.description_blocks_begin as usize;
    let range = &blocks.blocks[begin..begin + description.description_blocks_count as usize];
    let mut comments: Vec<usize> = range
        .iter()
        .filter(|b| b.block_type == CommentBlockType::DASHQL_TAG)
        .flat_map(|b| b.comments_begin as usize..(b.comments_begin + b.comments_count) as usize)
        .collect();
    comments.dedup();
    // Ordinary comments are no part of the annotation, except for the text before the first tag of a block
    // comment
    let annotated = range.iter().filter(|b| comments.binary_search(&(b.comments_begin as usize)).is_ok());
    (Annotation::from_blocks(parsed.scanned.text.as_bytes(), blocks, annotated), comments)
}

/// Read the annotation of a statement
pub fn read_annotation(parsed: &ParsedScript, statement_id: usize) -> Result<Annotation> {
    check_statement(parsed, statement_id)?;
    Ok(read_with_comments(parsed, statement_id).0)
}

/// Whitespace within a line
fn is_horizontal_space(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\r')
}

/// The beginning of the whitespace before an offset on its line
fn skip_space_before(text: &[u8], mut offset: usize) -> usize {
    while offset > 0 && is_horizontal_space(text[offset - 1]) {
        offset -= 1;
    }
    offset
}

/// The end of the whitespace after an offset on its line
fn skip_space_after(text: &[u8], mut offset: usize) -> usize {
    while offset < text.len() && is_horizontal_space(text[offset]) {
        offset += 1;
    }
    offset
}

/// Does an offset start its line, after whitespace?
fn starts_line(text: &[u8], offset: usize) -> bool {
    let before = skip_space_before(text, offset);
    before == 0 || text[before - 1] == b'\n'
}

/// The text range that removes comments: their lines if nothing else is on them, otherwise the comments
/// and the blanks that separate them
fn removal(text: &[u8], comments: TextSpan) -> (usize, usize) {
    let (begin, end) = (comments.offset as usize, comments.end() as usize);
    let after = skip_space_after(text, end);
    let ends_line = after == text.len() || text[after] == b'\n';
    match (starts_line(text, begin), ends_line) {
        (true, true) => (skip_space_before(text, begin), (after + 1).min(text.len())),
        (true, false) => (begin, after),
        (false, _) => (skip_space_before(text, begin), end),
    }
}

/// Replace text ranges, from back to front. The ranges are ascending and do not overlap.
fn splice(text: &str, edits: &[(usize, usize, String)]) -> Result<String> {
    let valid = |offset: usize| offset <= text.len() && text.is_char_boundary(offset);
    if !edits.iter().all(|&(begin, end, _)| begin <= end && valid(begin) && valid(end)) {
        return Err(Error::invalid_argument("the parsed script is outdated"));
    }
    let mut out = text.to_string();
    for (begin, end, insert) in edits.iter().rev() {
        out.replace_range(*begin..*end, insert);
    }
    Ok(out)
}

/// Rewrite the annotation of a statement. `edit` changes the annotation and returns the index of the tag
/// it wrote, if any. The annotation is printed as one comment in place of its first comments, the other
/// comments with tags are removed. An edit that neither writes a tag nor changes the annotation leaves
/// the text alone. Returns the new text and the span of the written tag in it, from `@` to the end of its
/// last line.
pub(crate) fn rewrite(
    text: &str,
    parsed: &ParsedScript,
    statement_id: usize,
    edit: impl FnOnce(&mut Annotation) -> Result<Option<usize>>,
) -> Result<(String, Option<TextSpan>)> {
    check_statement(parsed, statement_id)?;
    let (before, comments) = read_with_comments(parsed, statement_id);
    let mut annotation = before.clone();
    let written = edit(&mut annotation)?;
    if written.is_none() && annotation == before {
        return Ok((text.to_string(), None));
    }
    let outdated = || Error::invalid_argument("the parsed script is outdated");
    let bytes = text.as_bytes();
    // The comments with tags, comments that are separated by whitespace only form a run. Removing a run
    // removes the blank lines between its comments too, they would be left behind.
    let mut runs: Vec<TextSpan> = Vec::new();
    for &id in &comments {
        let comment = parsed.scanned.comments[id];
        if comment.end() as usize > bytes.len() {
            return Err(outdated());
        }
        match runs.last_mut() {
            Some(run) if bytes[run.end() as usize..comment.offset as usize].iter().all(u8::is_ascii_whitespace) => {
                *run = TextSpan::new(run.offset, comment.end() - run.offset);
            }
            _ => runs.push(comment),
        }
    }
    let mut edits = Vec::with_capacity(runs.len().max(1));
    let mut span = None;
    let mut removed = &runs[..];
    if !annotation.is_empty() {
        // The comment replaces the first run, or goes on a line of its own before the statement
        let (mut begin, end) = match runs.split_first() {
            Some((first, rest)) => {
                removed = rest;
                (first.offset as usize, first.end() as usize)
            }
            None => {
                let at = parsed.associate_descriptions()[statement_id].statement_span.offset as usize;
                (at, at)
            }
        };
        if end > bytes.len() || !text.is_char_boundary(begin) {
            return Err(outdated());
        }
        let line_start = starts_line(bytes, begin);
        let indent = if line_start { &text[skip_space_before(bytes, begin)..begin] } else { "" };
        let (comment, line_spans) = annotation.print(indent)?;
        let mut insert = String::new();
        if runs.is_empty() && !line_start {
            begin = skip_space_before(bytes, begin);
            insert.push('\n');
        }
        if let Some(i) = written {
            let first_line = annotation.first_line_of(i);
            let last_line = first_line + annotation.tags[i].printed_len() - 1;
            let offset = begin + insert.len() + line_spans[first_line].0;
            span = Some(TextSpan::new(offset as u32, (line_spans[last_line].1 - line_spans[first_line].0) as u32));
        }
        insert.push_str(&comment);
        if runs.is_empty() {
            insert.push('\n');
            insert.push_str(indent);
        }
        edits.push((begin, end, insert));
    }
    for &run in removed {
        let (begin, end) = removal(bytes, run);
        edits.push((begin, end, String::new()));
    }
    Ok((splice(text, &edits)?, span))
}

/// Replace the annotation of a statement, an empty annotation removes it. Returns the new text.
pub fn write_annotation(text: &str, parsed: &ParsedScript, statement_id: usize, annotation: &Annotation) -> Result<String> {
    Ok(rewrite(text, parsed, statement_id, |current| {
        *current = annotation.clone();
        Ok(None)
    })?
    .0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;
    use std::sync::Arc;

    fn parsed(text: &str) -> ParsedScript {
        parse(Arc::new(scan(text, 0, 0)))
    }

    fn lines(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|l| l.to_string()).collect()
    }

    #[test]
    fn reads_the_tags_of_every_comment() {
        let text = "-- @description\n-- Sales.\n-- per region\n-- @end\n-- note\n/* Revenue.\n   @vis table */\nselect 1";
        let annotation = read_annotation(&parsed(text), 0).unwrap();
        assert_eq!(annotation.preamble, lines(&["Revenue."]));
        assert_eq!(
            annotation.tags,
            vec![AnnotationTag::new("description", lines(&["", "Sales.", "per region"])), AnnotationTag::new("vis", lines(&["table"]))]
        );
        assert_eq!(annotation.tags[0].text(), "Sales.\nper region");
        assert_eq!(annotation.tags[1].kind(), "table");
        assert!(read_annotation(&parsed("select 1"), 0).unwrap().is_empty());
        assert!(read_annotation(&parsed("select 1"), 1).is_err());
    }

    #[test]
    fn prints_javadoc_style() {
        let mut annotation = Annotation { preamble: vec![], tags: vec![AnnotationTag::new("vis", lines(&["table"]))] };
        assert_eq!(annotation.print("").unwrap().0, "/** @vis table */");
        annotation.tags.insert(0, AnnotationTag::with_text("description", "Sales.\n\n* per region"));
        assert_eq!(annotation.print("  ").unwrap().0, "/**\n   * @description\n   * Sales.\n   *\n   * * per region\n   * @vis table\n   */");
    }

    #[test]
    fn rejects_annotations_that_do_not_read_back() {
        let tag = |name: &str, content: &[&str]| Annotation { preamble: vec![], tags: vec![AnnotationTag::new(name, lines(content))] };
        assert!(tag("todo", &["x"]).print("").is_err());
        assert!(tag("end", &[""]).print("").is_err());
        assert!(tag("description", &["", "a */ b"]).print("").is_err());
        assert!(tag("description", &["", "a\nb"]).print("").is_err());
        assert!(tag("description", &["", "@vis table"]).print("").is_err());
        // A tag on the line of the tag is text, `@word` that is no tag is text
        assert!(tag("description", &["@vis table", "@todo"]).print("").is_ok());
    }

    #[test]
    fn writes_the_annotation_as_one_comment() {
        let text = "-- @description Sales.\n\n/* @vis table */\nselect 1";
        let script = parsed(text);
        let mut annotation = read_annotation(&script, 0).unwrap();
        annotation.tags[0] = AnnotationTag::with_text("description", "Revenue.");
        assert_eq!(write_annotation(text, &script, 0, &annotation).unwrap(), "/**\n * @description\n * Revenue.\n * @vis table\n */\nselect 1");
        // An unchanged annotation leaves the text alone, an empty one removes the comments
        assert_eq!(write_annotation(text, &script, 0, &read_annotation(&script, 0).unwrap()).unwrap(), text);
        assert_eq!(write_annotation(text, &script, 0, &Annotation::default()).unwrap(), "select 1");
        // Statements of every kind have annotations
        let text = "create table t (a int)";
        let annotation = Annotation { preamble: vec![], tags: vec![AnnotationTag::new("description", lines(&["Tables."]))] };
        assert_eq!(write_annotation(text, &parsed(text), 0, &annotation).unwrap(), "/** @description Tables. */\ncreate table t (a int)");
    }

    #[test]
    fn converts_to_and_from_json() {
        let annotation = Annotation { preamble: lines(&["Note."]), tags: vec![AnnotationTag::new("vis", lines(&["table"]))] };
        let json = serde_json::to_string(&annotation).unwrap();
        assert_eq!(json, r#"{"preamble":["Note."],"tags":[{"name":"vis","lines":["table"]}]}"#);
        assert_eq!(serde_json::from_str::<Annotation>(&json).unwrap(), annotation);
        assert_eq!(serde_json::from_str::<Annotation>("{}").unwrap(), Annotation::default());
        assert!(serde_json::from_str::<Annotation>("\"x\"").is_err());
        assert!(serde_json::from_str::<Annotation>(r#"{"tags": [{"lines": []}]}"#).is_err());
        assert!(serde_json::from_str::<Annotation>(r#"{"tags": [{"name": "vis", "lines": [1]}]}"#).is_err());
    }
}
