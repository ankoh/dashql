//! Comment output of the formatter.
//!
//! Comments work on bytes: wrapping splits long words at byte offsets, which can split UTF-8
//! sequences (see docs/design/core_quirks.md).

use crate::annotation::{Annotation, AnnotationTag, ANNOTATION_GUTTER};
use dashql_parser::comment_blocks::{
    group_comment_bytes, is_comment_tag, CommentBlockType, COMMENT_TAG_END, COMMENT_TAG_PREFIX,
};
use dashql_parser::span::TextSpan;

/// `std::isspace` in the C locale
pub(super) fn is_space(ch: u8) -> bool {
    matches!(ch, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r')
}

fn is_whitespace(text: &[u8]) -> bool {
    text.iter().all(|&ch| is_space(ch))
}

fn trim_whitespace(mut text: &[u8]) -> &[u8] {
    while let [first, rest @ ..] = text {
        if !is_space(*first) {
            break;
        }
        text = rest;
    }
    while let [rest @ .., last] = text {
        if !is_space(*last) {
            break;
        }
        text = rest;
    }
    text
}

/// `std::string_view::substr`, clamped to the text
fn substr(text: &[u8], offset: usize, length: usize) -> &[u8] {
    let rest = text.get(offset..).unwrap_or_default();
    rest.get(..length).unwrap_or(rest)
}

fn comment_text<'a>(input: &'a [u8], comment: &TextSpan) -> &'a [u8] {
    substr(input, comment.offset as usize, comment.length as usize)
}

/// `find_first_of`
fn find_first_of(text: &[u8], chars: &[u8]) -> Option<usize> {
    text.iter().position(|ch| chars.contains(ch))
}

fn find_subslice(text: &[u8], needle: &[u8]) -> Option<usize> {
    text.windows(needle.len()).position(|w| w == needle)
}

fn count_line_breaks(text: &[u8]) -> usize {
    text.iter().filter(|&&ch| ch == b'\n').count()
}

fn ends_with_line_break(output: &[u8]) -> bool {
    output.last() == Some(&b'\n')
}

fn append_comment_line(output: &mut Vec<u8>, text: &[u8], max_width: usize) {
    if !output.is_empty() && !ends_with_line_break(output) {
        output.push(b'\n');
    }
    output.extend_from_slice(b"--");
    if text.is_empty() {
        return;
    }
    if max_width >= 4 {
        output.push(b' ');
    }
    output.extend_from_slice(text);
}

fn append_wrapped_comment_paragraph(output: &mut Vec<u8>, words: &[&[u8]], max_width: usize) {
    if words.is_empty() {
        append_comment_line(output, &[], max_width);
        return;
    }

    let prefix_width = if max_width >= 4 { 3 } else { 2 };
    let content_width = if max_width > prefix_width { max_width - prefix_width } else { 1 };
    let mut line: Vec<u8> = Vec::new();
    for word in words {
        let mut rest: &[u8] = word;
        while !rest.is_empty() {
            let remaining = rest.len();
            if !line.is_empty() && line.len() + 1 + remaining > content_width {
                append_comment_line(output, &line, max_width);
                line.clear();
                continue;
            }

            let separator = if line.is_empty() { 0 } else { 1 };
            if remaining <= content_width - line.len() - separator {
                if !line.is_empty() {
                    line.push(b' ');
                }
                line.extend_from_slice(rest);
                rest = &[];
            } else {
                let available = content_width - line.len() - separator;
                if !line.is_empty() {
                    line.push(b' ');
                }
                // `available` is below the length of the rest
                let (head, tail) = rest.split_at_checked(available).unwrap_or((rest, &[]));
                line.extend_from_slice(head);
                rest = tail;
                append_comment_line(output, &line, max_width);
                line.clear();
            }
        }
    }
    if !line.is_empty() {
        append_comment_line(output, &line, max_width);
    }
}

fn append_wrapped_line_comments(output: &mut Vec<u8>, input: &[u8], comments: &[TextSpan], max_width: usize) {
    let mut normalized_lines: Vec<&[u8]> = Vec::new();
    for comment in comments {
        let mut text = comment_text(input, comment);
        if let Some(rest) = text.strip_prefix(b"--") {
            text = rest;
        }
        loop {
            let line_end = find_first_of(text, b"\r\n");
            let (line, rest) = text.split_at_checked(line_end.unwrap_or(text.len())).unwrap_or((text, &[]));
            normalized_lines.push(trim_whitespace(line));
            if line_end.is_none() {
                break;
            }
            // `rest` starts with the line break, `\r\n` is one
            text = match rest {
                [b'\r', b'\n', tail @ ..] | [_, tail @ ..] => tail,
                [] => rest,
            };
        }
    }

    let first = normalized_lines.iter().position(|l| !l.is_empty()).unwrap_or(normalized_lines.len());
    normalized_lines.drain(..first);
    while normalized_lines.last().is_some_and(|l| l.is_empty()) {
        normalized_lines.pop();
    }

    if normalized_lines.is_empty() {
        append_comment_line(output, &[], max_width);
        return;
    }

    let mut words: Vec<&[u8]> = Vec::new();
    for line in normalized_lines {
        if line.is_empty() {
            if !words.is_empty() {
                append_wrapped_comment_paragraph(output, &words, max_width);
                words.clear();
            }
            append_comment_line(output, &[], max_width);
            continue;
        }

        let mut remaining = line;
        while !remaining.is_empty() {
            let word_end = find_first_of(remaining, b" \t\r\n\x0c");
            let (word, rest) =
                remaining.split_at_checked(word_end.unwrap_or(remaining.len())).unwrap_or((remaining, &[]));
            if !word.is_empty() {
                words.push(word);
            }
            if word_end.is_none() {
                break;
            }
            // `rest` starts with the separator
            remaining = trim_whitespace(rest.get(1..).unwrap_or_default());
        }
    }
    if !words.is_empty() {
        append_wrapped_comment_paragraph(output, &words, max_width);
    }
}

/// The tag name of a `-- @<tag>` line comment and whether the tag is alone on its line
struct CommentTag<'a> {
    /// The tag name after `@`
    name: &'a [u8],
    /// Is the tag the only text after the comment marker?
    alone: bool,
}

fn read_comment_tag<'a>(input: &'a [u8], comment: &TextSpan) -> Option<CommentTag<'a>> {
    let text = comment_text(input, comment);
    let text = trim_whitespace(text.strip_prefix(b"--")?);
    let text = text.strip_prefix(COMMENT_TAG_PREFIX.as_bytes())?;
    let name_end = find_first_of(text, b" \t\r\n\x0c").unwrap_or(text.len());
    let (name, rest) = text.split_at_checked(name_end).unwrap_or((text, &[]));
    if !is_comment_tag(name) {
        return None;
    }
    let alone = trim_whitespace(rest).is_empty();
    Some(CommentTag { name, alone })
}

/// The tag of visualizations, `@vis <kind> ...`
const VIS_TAG: &str = "vis";
/// The tag of the dashboard placement, `@board <args>`
const BOARD_TAG: &str = "board";
/// The tag of the position on the dataflow canvas, `@flow <args>`
const FLOW_TAG: &str = "flow";

/// Split a line at its first whitespace, the rest is trimmed
fn split_word(line: &str) -> (&str, &str) {
    let end = line.find([' ', '\t', '\r', '\x0c', '\x0b']).unwrap_or(line.len());
    line.split_at_checked(end).map_or((line, ""), |(word, rest)| (word, rest.trim()))
}

/// The canonical content lines of a `@vis` tag, the first line is the text on the line of the tag.
/// `max_width` is the width of the comment lines.
fn vis_tag_lines(lines: &[String], max_width: usize) -> Vec<String> {
    let Some((header, body)) = lines.split_first() else { return Vec::new() };
    let (kind, rest) = split_word(header);
    match kind {
        "vegalite" => {
            // The JSON is printed compactly with the key order kept, malformed JSON stays as written
            let json = std::iter::once(rest).chain(body.iter().map(String::as_str)).collect::<Vec<_>>().join("\n");
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else { return lines.to_vec() };
            let width = max_width.saturating_sub(ANNOTATION_GUTTER.len());
            let compact = crate::compact_json::to_string_compact(&value, width);
            std::iter::once(kind.to_string()).chain(compact.lines().map(str::to_string)).collect()
        }
        "table" | "kpi" => {
            // Args are separated by single spaces, args with problems stay as written
            let args = crate::vis_args::normalize_args(rest).unwrap_or_else(|| rest.to_string());
            let header = if args.is_empty() { kind.to_string() } else { format!("{kind} {args}") };
            std::iter::once(header).chain(body.iter().cloned()).collect()
        }
        _ => lines.to_vec(),
    }
}

/// The canonical content lines of a `@board` or `@flow` tag: its args, separated by single spaces, args with problems
/// stay as written
fn args_tag_lines(lines: &[String]) -> Vec<String> {
    let Some((header, body)) = lines.split_first() else { return Vec::new() };
    let args = crate::vis_args::normalize_args(header).unwrap_or_else(|| header.trim().to_string());
    std::iter::once(args).chain(body.iter().cloned()).collect()
}

/// The `@board` or `@flow` tag of the `@vis board`, `@vis card` or `@vis flow` of an older script, with its args
fn legacy_layout_tag(tag: &AnnotationTag) -> Option<AnnotationTag> {
    if tag.name != VIS_TAG {
        return None;
    }
    let name = match tag.kind() {
        "board" | "card" => BOARD_TAG,
        "flow" => FLOW_TAG,
        _ => return None,
    };
    let (_, args) = split_word(tag.lines.first().map(String::as_str).unwrap_or("").trim_start());
    let lines = std::iter::once(args.to_string()).chain(tag.lines.iter().skip(1).cloned()).collect();
    Some(AnnotationTag::new(name, lines))
}

/// Print comments that hold tags as one canonical tagged comment, like an annotation (see `annotation`):
/// the tags keep their order, `@vis`, `@board` and `@flow` tags are normalized and the `@vis board` and `@vis flow` of
/// older scripts become `@board` and `@flow`, the ordinary comments and the text before the first tag of a block
/// comment go in front of them. Returns None if the comments stay as written: without a tag, with malformed tags,
/// or with text that would end or nest a block comment.
fn print_tagged_comment(input: &[u8], comments: &[TextSpan], max_width: usize) -> Option<Vec<u8>> {
    let blocks = group_comment_bytes(input, comments);
    if !blocks.warnings.is_empty() || !blocks.blocks.iter().any(|b| b.block_type == CommentBlockType::DASHQL_TAG) {
        return None;
    }
    let mut annotation = Annotation::from_blocks(input, &blocks, blocks.blocks.iter());
    for tag in annotation.tags.iter_mut() {
        // Older scripts place visualizations with `@vis board` and scripts with `@vis flow`
        if let Some(layout) = legacy_layout_tag(tag) {
            *tag = layout;
        }
        match tag.name.as_str() {
            VIS_TAG => tag.lines = vis_tag_lines(&tag.lines, max_width),
            BOARD_TAG | FLOW_TAG => tag.lines = args_tag_lines(&tag.lines),
            _ => {}
        }
    }
    annotation.print("").ok().map(|(comment, _)| comment.into_bytes())
}

/// Is a comment a block comment?
fn is_block_comment(input: &[u8], comment: &TextSpan) -> bool {
    comment_text(input, comment).starts_with(b"/*")
}

/// Does a block comment hold a tag?
fn block_comment_has_tag(input: &[u8], comment: TextSpan) -> bool {
    find_subslice(comment_text(input, &comment), COMMENT_TAG_PREFIX.as_bytes()).is_some()
        && group_comment_bytes(input, &[comment]).blocks.iter().any(|b| b.block_type == CommentBlockType::DASHQL_TAG)
}

/// The text between two comments
fn gap_between<'a>(input: &'a [u8], previous: &TextSpan, next: &TextSpan) -> &'a [u8] {
    let end = previous.end() as usize;
    substr(input, end, (next.offset as usize).saturating_sub(end))
}

/// A slice of the comments: ordinary comments, or comments with tags
struct Unit {
    /// The comments of the unit
    comments: std::ops::Range<usize>,
    /// Does the unit hold tags?
    tagged: bool,
}

/// Split comments into units. A block comment is a unit. A run of line comments on consecutive lines is
/// split into tagged regions, from a `-- @<tag>` line to the end of the run or to an `-- @end` line that
/// older scripts close it with, and the ordinary comments between them.
fn comment_units(input: &[u8], comments: &[TextSpan]) -> Vec<Unit> {
    let opens = |c: &TextSpan| read_comment_tag(input, c).is_some_and(|t| t.name != COMMENT_TAG_END.as_bytes());
    let closes =
        |c: &TextSpan| read_comment_tag(input, c).is_some_and(|t| t.name == COMMENT_TAG_END.as_bytes() && t.alone);
    let mut units = Vec::new();
    let mut i = 0;
    while let Some(&comment) = comments.get(i) {
        if is_block_comment(input, &comment) {
            units.push(Unit { comments: i..i + 1, tagged: block_comment_has_tag(input, comment) });
            i += 1;
            continue;
        }
        let mut run_end = i + 1;
        let mut previous = comment;
        while let Some(&next) = comments.get(run_end).filter(|c| !is_block_comment(input, c)) {
            let gap = gap_between(input, &previous, &next);
            if !is_whitespace(gap) || count_line_breaks(gap) > 1 {
                break;
            }
            previous = next;
            run_end += 1;
        }
        let mut pending = i;
        let mut j = i;
        while j < run_end {
            if !comments.get(j).is_some_and(opens) {
                j += 1;
                continue;
            }
            let mut close = j + 1;
            while close < run_end && !comments.get(close).is_some_and(closes) {
                close += 1;
            }
            let end = (close + 1).min(run_end);
            if pending < j {
                units.push(Unit { comments: pending..j, tagged: false });
            }
            units.push(Unit { comments: j..end, tagged: true });
            pending = end;
            j = end;
        }
        if pending < run_end {
            units.push(Unit { comments: pending..run_end, tagged: false });
        }
        i = run_end;
    }
    units
}

/// Append comments as written, without trailing whitespace
fn append_verbatim(output: &mut Vec<u8>, input: &[u8], comments: &[TextSpan]) {
    for comment in comments {
        if !output.is_empty() && !ends_with_line_break(output) {
            output.push(b'\n');
        }
        let mut text = comment_text(input, comment);
        while let [rest @ .., last] = text {
            if !is_space(*last) {
                break;
            }
            text = rest;
        }
        output.extend_from_slice(text);
    }
}

/// Append comments: block comments verbatim, runs of line comments rewrapped. Comments with tags that
/// follow each other with nothing but whitespace between them are merged into one canonical tagged
/// comment, so an annotation reads as one block. Comments with tags that cannot be printed canonically
/// are kept as written, since their content is structured (e.g. JSON) and rewrapping it would break it.
/// A blank line that follows tagged comments or ends the comments is kept, `following` is the offset of the text after
/// the comments.
pub(super) fn append_comments(
    output: &mut Vec<u8>,
    input: &[u8],
    comments: &[TextSpan],
    max_width: usize,
    following: Option<usize>,
) {
    let units = comment_units(input, comments);
    // The units are non-empty ranges of the comments
    let unit_comments = |unit: &Unit| comments.get(unit.comments.clone()).unwrap_or_default();
    let mut u = 0;
    while let Some(unit) = units.get(u) {
        if !unit.tagged {
            let slice = unit_comments(unit);
            if slice.first().is_some_and(|c| is_block_comment(input, c)) {
                append_verbatim(output, input, slice);
            } else {
                append_wrapped_line_comments(output, input, slice, max_width);
            }
            if let Some(last) = comments.last().filter(|_| unit.comments.end == comments.len()) {
                keep_blank_line(output, input, last.end() as usize, following);
            }
            u += 1;
            continue;
        }
        // The tagged units that follow after whitespace only
        let mut last = u;
        let mut last_unit = unit;
        while let Some(next) = units.get(last + 1).filter(|next| {
            next.tagged
                && matches!((unit_comments(last_unit).last(), unit_comments(next).first()),
                    (Some(previous), Some(first)) if is_whitespace(gap_between(input, previous, first)))
        }) {
            last += 1;
            last_unit = next;
        }
        let range = unit.comments.start..last_unit.comments.end;
        if !output.is_empty() && !ends_with_line_break(output) {
            output.push(b'\n');
        }
        let merged = comments.get(range.clone()).unwrap_or_default();
        match print_tagged_comment(input, merged, max_width) {
            Some(block) => output.extend_from_slice(&block),
            // Units that cannot be merged are printed one by one
            None => {
                for unit in units.get(u..=last).unwrap_or_default() {
                    let slice = unit_comments(unit);
                    if !output.is_empty() && !ends_with_line_break(output) {
                        output.push(b'\n');
                    }
                    match print_tagged_comment(input, slice, max_width) {
                        Some(block) => output.extend_from_slice(&block),
                        None => append_verbatim(output, input, slice),
                    }
                }
            }
        }
        let next = comments.get(range.end).map(|c| c.offset as usize).or(following);
        if let Some(last) = merged.last() {
            keep_blank_line(output, input, last.end() as usize, next);
        }
        u = last + 1;
    }
}

/// Keep a blank line between the end of comments and the text that follows them at `next`
fn keep_blank_line(output: &mut Vec<u8>, input: &[u8], text_end: usize, next: Option<usize>) {
    if let Some(next) = next.filter(|&next| next >= text_end) {
        if count_line_breaks(substr(input, text_end, next - text_end)) > 1 {
            output.extend_from_slice(b"\n\n");
        }
    }
}

/// Append the comments in front of a statement. With a tag among them they are its annotation: one canonical
/// comment with the ordinary comments as the description on top, like a rewrite of a tag prints it (see
/// `annotation`). Otherwise, or if the annotation cannot be printed canonically, they are appended like other
/// comments. `following` is the offset of the statement.
pub(super) fn append_description(
    output: &mut Vec<u8>,
    input: &[u8],
    comments: &[TextSpan],
    max_width: usize,
    following: Option<usize>,
) {
    let annotation = comment_units(input, comments)
        .iter()
        .any(|unit| unit.tagged)
        .then(|| print_tagged_comment(input, comments, max_width))
        .flatten();
    let Some(block) = annotation else {
        append_comments(output, input, comments, max_width, following);
        return;
    };
    if !output.is_empty() && !ends_with_line_break(output) {
        output.push(b'\n');
    }
    output.extend_from_slice(&block);
    // A printed annotation has comments
    if let Some(last) = comments.last() {
        keep_blank_line(output, input, last.end() as usize, following);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spans(input: &str, comments: &[&str]) -> Vec<TextSpan> {
        let mut from = 0;
        comments
            .iter()
            .map(|c| {
                let offset = from + input[from..].find(c).unwrap();
                from = offset + c.len();
                TextSpan::new(offset as u32, c.len() as u32)
            })
            .collect()
    }

    fn format(input: &str, comments: &[&str], max_width: usize) -> String {
        let mut out = Vec::new();
        append_comments(&mut out, input.as_bytes(), &spans(input, comments), max_width, None);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn rewraps_line_comments() {
        let input = "-- aaa bbb\n-- ccc";
        assert_eq!(format(input, &["-- aaa bbb", "-- ccc"], 120), "-- aaa bbb ccc");
        assert_eq!(format(input, &["-- aaa bbb", "-- ccc"], 10), "-- aaa bbb\n-- ccc");
        assert_eq!(format(input, &["-- aaa bbb", "-- ccc"], 9), "-- aaa\n-- bbb\n-- ccc");
        // Words longer than the line are split
        assert_eq!(format("--abcdefgh", &["--abcdefgh"], 6), "-- abc\n-- def\n-- gh");
    }

    #[test]
    fn keeps_blank_lines_and_block_comments() {
        let input = "-- a\n\n-- b\n/* c */";
        assert_eq!(format(input, &["-- a", "-- b", "/* c */"], 120), "-- a\n-- b\n/* c */");
        let input = "-- a\n--\n-- b";
        assert_eq!(format(input, &["-- a", "--", "-- b"], 120), "-- a\n--\n-- b");
    }

    #[test]
    fn prints_tagged_regions() {
        // A tagged region ends with the run or with an end line, comments after it are rewrapped
        let input = "-- @vis markdown\n-- **{{a}}**   x\n-- @end\n\n-- x   y";
        let out = format(input, &["-- @vis markdown", "-- **{{a}}**   x", "-- @end", "-- x   y"], 120);
        assert_eq!(out, "/**\n * @vis markdown\n * **{{a}}**   x\n */\n\n-- x y");
        let input = "-- @param Sales.\n-- @end\n-- x   y";
        assert_eq!(format(input, &["-- @param Sales.", "-- @end", "-- x   y"], 120), "/** @param Sales. */\n-- x y");
    }

    /// Format a script that consists of comments, every comment is found by the scanner
    fn format_comments(input: &str) -> String {
        format_comments_within(input, 120)
    }

    fn format_comments_within(input: &str, max_width: usize) -> String {
        let scanned = dashql_parser::scanner::scan(input, 0, 0);
        let mut out = Vec::new();
        append_comments(&mut out, input.as_bytes(), &scanned.comments, max_width, None);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn prints_vis_block_comments() {
        assert_eq!(format_comments("/*   @board  width=6   height=3 */"), "/** @board width=6 height=3 */");
        assert_eq!(format_comments("/* @flow   x=1  y=2 */"), "/** @flow x=1 y=2 */");
        // The placements of older scripts become their own tags
        assert_eq!(format_comments("/*   @vis   board  width=6   height=3 */"), "/** @board width=6 height=3 */");
        assert_eq!(format_comments("/* @vis card width=6 */"), "/** @board width=6 */");
        assert_eq!(
            format_comments("/* @vis table\n   @vis flow x=1 y=2 */"),
            "/**\n * @vis table\n * @flow x=1 y=2\n */"
        );
        assert_eq!(format_comments("/* @vis table */"), "/** @vis table */");
        let input = "/* @vis vegalite {\"mark\":\"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}} */";
        assert_eq!(
            format_comments(input),
            "/**\n * @vis vegalite\n * {\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}}\n */"
        );
        // The JSON breaks where it does not fit in the comment lines
        assert_eq!(
            format_comments_within(input, 40),
            "/**\n * @vis vegalite\n * {\n *   \"mark\": \"bar\",\n *   \"encoding\": {\"x\": {\"field\": \"a\"}}\n * }\n */"
        );
        // Formatting twice gives the same output
        let once = format_comments("/* @vis vegalite\n{\"mark\":\"bar\"}\n*/");
        assert_eq!(format_comments(&once), once);
    }

    #[test]
    fn prints_tagged_line_comments_as_block_comment() {
        let expected = "/**\n * @param Revenue.\n * @board width=6\n * @vis vegalite\n * {\"mark\": \"bar\"}\n */";
        for input in [
            "-- @param Revenue.\n-- @vis board width=6\n-- @vis vegalite\n-- {\"mark\": \"bar\"}",
            "-- @param Revenue.\n-- @vis board width=6\n-- @vis vegalite\n-- {\"mark\": \"bar\"}\n-- @end",
            "/* @param Revenue.\n   @vis board width=6\n   @vis vegalite\n   {\"mark\": \"bar\"}\n*/",
        ] {
            assert_eq!(format_comments(input), expected, "{input}");
        }
        assert_eq!(format_comments(expected), expected);
        // Descriptions keep their lines, an empty line keeps its gutter
        let input = "-- @param\n-- Revenue.\n--\n-- * per region\n-- @end";
        assert_eq!(format_comments(input), "/**\n * @param\n * Revenue.\n *\n * * per region\n */");
        assert_eq!(format_comments("/* @param Revenue. */"), "/** @param Revenue. */");
    }

    #[test]
    fn merges_tagged_comments() {
        let input = "-- @param\n-- Add to timestamps.\n-- @end\n\n/* @vis vegalite\n   {\"mark\": \"bar\"}\n*/";
        assert_eq!(
            format_comments(input),
            "/**\n * @param\n * Add to timestamps.\n * @vis vegalite\n * {\"mark\": \"bar\"}\n */"
        );
        // Ordinary comments between them keep them apart
        let input = "/* @param Sales. */\n-- note\n/* @vis table */";
        assert_eq!(format_comments(input), "/** @param Sales. */\n-- note\n/** @vis table */");
        // The text before the first tag of a block comment goes in front of all tags
        let input = "/* @param Sales. */\n/* Note.\n   @vis table */";
        assert_eq!(format_comments(input), "/**\n * Note.\n *\n * @param Sales.\n * @vis table\n */");
        // Comments that cannot be printed canonically stay apart
        let input = "/* @param Sales. */\n-- @vis markdown\n-- see */ here";
        assert_eq!(format_comments(input), "/** @param Sales. */\n-- @vis markdown\n-- see */ here");
    }

    #[test]
    fn keeps_text_before_the_first_tag() {
        let input = "/* Revenue dashboard.\n      @vis table\n*/";
        assert_eq!(format_comments(input), "/**\n * Revenue dashboard.\n *\n * @vis table\n */");
        // Comments without tags stay as written
        let input = "/* Revenue dashboard.\n      @see x\n*/";
        assert_eq!(format_comments(input), input);
    }

    #[test]
    fn keeps_markdown_and_malformed_json() {
        let input = "/**\n * @vis markdown\n * - {{a}}\n *   - {{b}}\n */";
        assert_eq!(format_comments(input), input);
        let input = "/* @vis vegalite {\"mark\": */";
        assert_eq!(format_comments(input), "/** @vis vegalite {\"mark\": */");
        let input = "/* @vis vegalite\n     {\"mark\":\n  */";
        assert_eq!(format_comments(input), "/**\n * @vis vegalite\n * {\"mark\":\n */");
    }

    #[test]
    fn keeps_tagged_line_comments_that_cannot_be_block_comments() {
        let input = "-- @vis markdown\n-- see */ here";
        assert_eq!(format_comments(input), input);
    }

    #[test]
    fn trims_like_isspace() {
        assert_eq!(trim_whitespace(b"\x0b a \x0c"), b"a");
        assert!(is_whitespace(b" \t\r\n"));
        assert_eq!(substr(b"abc", 5, 2), b"");
        assert_eq!(substr(b"abc", 1, 10), b"bc");
    }
}
