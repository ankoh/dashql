//! Comment output of the formatter.
//!
//! Comments work on bytes: wrapping splits long words at byte offsets, which can split UTF-8
//! sequences (see docs/design/core_quirks.md).

use crate::annotation::{Annotation, ANNOTATION_GUTTER};
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
    let begin = offset.min(text.len());
    let end = begin + length.min(text.len() - begin);
    &text[begin..end]
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
        let mut offset = 0;
        while offset < word.len() {
            let remaining = word.len() - offset;
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
                line.extend_from_slice(&word[offset..]);
                offset = word.len();
            } else {
                let available = content_width - line.len() - separator;
                if !line.is_empty() {
                    line.push(b' ');
                }
                line.extend_from_slice(&word[offset..offset + available]);
                offset += available;
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
        if text.starts_with(b"--") {
            text = &text[2..];
        }
        loop {
            let line_end = find_first_of(text, b"\r\n");
            let line = trim_whitespace(&text[..line_end.unwrap_or(text.len())]);
            normalized_lines.push(line);

            let Some(line_end) = line_end else { break };
            let mut next = line_end + 1;
            if text[line_end] == b'\r' && next < text.len() && text[next] == b'\n' {
                next += 1;
            }
            text = &text[next..];
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
            let word = &remaining[..word_end.unwrap_or(remaining.len())];
            if !word.is_empty() {
                words.push(word);
            }
            let Some(word_end) = word_end else { break };
            remaining = trim_whitespace(&remaining[word_end + 1..]);
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
    let name_end = find_first_of(text, b" \t\r\n\x0c");
    let name = &text[..name_end.unwrap_or(text.len())];
    if !is_comment_tag(name) {
        return None;
    }
    let alone = match name_end {
        None => true,
        Some(end) => trim_whitespace(&text[end..]).is_empty(),
    };
    Some(CommentTag { name, alone })
}

/// The tag of visualizations, `@vis <kind> ...`
const VIS_TAG: &str = "vis";

/// Split a line at its first whitespace, the rest is trimmed
fn split_word(line: &str) -> (&str, &str) {
    let end = line.find([' ', '\t', '\r', '\x0c', '\x0b']).unwrap_or(line.len());
    (&line[..end], line[end..].trim())
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
        "table" | "card" => {
            // Args are separated by single spaces
            let header = std::iter::once(kind).chain(rest.split_whitespace()).collect::<Vec<_>>().join(" ");
            std::iter::once(header).chain(body.iter().cloned()).collect()
        }
        _ => lines.to_vec(),
    }
}

/// Print comments that hold tags as one canonical tagged comment, like an annotation (see `annotation`):
/// the tags keep their order, `@vis` tags are normalized, the text before the first tag of a block comment
/// goes in front of them. Returns None if the comments stay as written: without a tag, with malformed tags,
/// or with text that would end or nest a block comment.
fn print_tagged_comment(input: &[u8], comments: &[TextSpan], max_width: usize) -> Option<Vec<u8>> {
    let blocks = group_comment_bytes(input, comments);
    if !blocks.warnings.is_empty() || !blocks.blocks.iter().any(|b| b.block_type == CommentBlockType::DASHQL_TAG) {
        return None;
    }
    let mut annotation = Annotation::from_blocks(input, &blocks, blocks.blocks.iter());
    for tag in annotation.tags.iter_mut().filter(|t| t.name == VIS_TAG) {
        tag.lines = vis_tag_lines(&tag.lines, max_width);
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
    let closes = |c: &TextSpan| read_comment_tag(input, c).is_some_and(|t| t.name == COMMENT_TAG_END.as_bytes() && t.alone);
    let mut units = Vec::new();
    let mut i = 0;
    while i < comments.len() {
        if is_block_comment(input, &comments[i]) {
            units.push(Unit { comments: i..i + 1, tagged: block_comment_has_tag(input, comments[i]) });
            i += 1;
            continue;
        }
        let mut run_end = i + 1;
        while run_end < comments.len() && !is_block_comment(input, &comments[run_end]) {
            let gap = gap_between(input, &comments[run_end - 1], &comments[run_end]);
            if !is_whitespace(gap) || count_line_breaks(gap) > 1 {
                break;
            }
            run_end += 1;
        }
        let mut pending = i;
        let mut j = i;
        while j < run_end {
            if !opens(&comments[j]) {
                j += 1;
                continue;
            }
            let mut close = j + 1;
            while close < run_end && !closes(&comments[close]) {
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
/// A blank line that follows tagged comments is kept, `following` is the offset of the text after the
/// comments.
pub(super) fn append_comments(
    output: &mut Vec<u8>,
    input: &[u8],
    comments: &[TextSpan],
    max_width: usize,
    following: Option<usize>,
) {
    let units = comment_units(input, comments);
    let mut u = 0;
    while u < units.len() {
        let unit = &units[u];
        if !unit.tagged {
            let slice = &comments[unit.comments.clone()];
            if is_block_comment(input, &slice[0]) {
                append_verbatim(output, input, slice);
            } else {
                append_wrapped_line_comments(output, input, slice, max_width);
            }
            u += 1;
            continue;
        }
        // The tagged units that follow after whitespace only
        let mut last = u;
        while last + 1 < units.len()
            && units[last + 1].tagged
            && is_whitespace(gap_between(input, &comments[units[last].comments.end - 1], &comments[units[last + 1].comments.start]))
        {
            last += 1;
        }
        let range = unit.comments.start..units[last].comments.end;
        if !output.is_empty() && !ends_with_line_break(output) {
            output.push(b'\n');
        }
        match print_tagged_comment(input, &comments[range.clone()], max_width) {
            Some(block) => output.extend_from_slice(&block),
            // Units that cannot be merged are printed one by one
            None => {
                for unit in &units[u..=last] {
                    let slice = &comments[unit.comments.clone()];
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
        let text_end = comments[range.end - 1].end() as usize;
        let next = comments.get(range.end).map(|c| c.offset as usize).or(following);
        if let Some(next) = next.filter(|&next| next >= text_end) {
            if count_line_breaks(substr(input, text_end, next - text_end)) > 1 {
                output.extend_from_slice(b"\n\n");
            }
        }
        u = last + 1;
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
        let input = "-- @metadata\n-- {\"a\":   1}\n-- @end\n\n-- x   y";
        let out = format(input, &["-- @metadata", "-- {\"a\":   1}", "-- @end", "-- x   y"], 120);
        assert_eq!(out, "/**\n * @metadata\n * {\"a\":   1}\n */\n\n-- x y");
        let input = "-- @description Sales.\n-- @end\n-- x   y";
        assert_eq!(format(input, &["-- @description Sales.", "-- @end", "-- x   y"], 120), "/** @description Sales. */\n-- x y");
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
        assert_eq!(format_comments("/*   @vis   card  width=6   height=3 */"), "/** @vis card width=6 height=3 */");
        assert_eq!(format_comments("/* @vis table */"), "/** @vis table */");
        let input = "/* @vis vegalite {\"mark\":\"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}} */";
        assert_eq!(format_comments(input), "/**\n * @vis vegalite\n * {\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}}\n */");
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
        let expected = "/**\n * @description Revenue.\n * @vis card width=6\n * @vis vegalite\n * {\"mark\": \"bar\"}\n */";
        for input in [
            "-- @description Revenue.\n-- @vis card width=6\n-- @vis vegalite\n-- {\"mark\": \"bar\"}",
            "-- @description Revenue.\n-- @vis card width=6\n-- @vis vegalite\n-- {\"mark\": \"bar\"}\n-- @end",
            "/* @description Revenue.\n   @vis card width=6\n   @vis vegalite\n   {\"mark\": \"bar\"}\n*/",
        ] {
            assert_eq!(format_comments(input), expected, "{input}");
        }
        assert_eq!(format_comments(expected), expected);
        // Descriptions keep their lines, an empty line keeps its gutter
        let input = "-- @description\n-- Revenue.\n--\n-- * per region\n-- @end";
        assert_eq!(format_comments(input), "/**\n * @description\n * Revenue.\n *\n * * per region\n */");
        assert_eq!(format_comments("/* @description Revenue. */"), "/** @description Revenue. */");
    }

    #[test]
    fn merges_tagged_comments() {
        let input = "-- @description\n-- Add to timestamps.\n-- @end\n\n/* @vis vegalite\n   {\"mark\": \"bar\"}\n*/";
        assert_eq!(format_comments(input), "/**\n * @description\n * Add to timestamps.\n * @vis vegalite\n * {\"mark\": \"bar\"}\n */");
        // Ordinary comments between them keep them apart
        let input = "/* @description Sales. */\n-- note\n/* @vis table */";
        assert_eq!(format_comments(input), "/** @description Sales. */\n-- note\n/** @vis table */");
        // The text before the first tag of a block comment goes in front of all tags
        let input = "/* @description Sales. */\n/* Note.\n   @vis table */";
        assert_eq!(format_comments(input), "/**\n * Note.\n * @description Sales.\n * @vis table\n */");
        // Comments that cannot be printed canonically stay apart
        let input = "/* @description Sales. */\n-- @vis markdown\n-- see */ here";
        assert_eq!(format_comments(input), "/** @description Sales. */\n-- @vis markdown\n-- see */ here");
    }

    #[test]
    fn keeps_text_before_the_first_tag() {
        let input = "/* Revenue dashboard.\n      @vis table\n*/";
        assert_eq!(format_comments(input), "/**\n * Revenue dashboard.\n * @vis table\n */");
        // Comments without tags stay as written
        let input = "/* Revenue dashboard.\n      @param x\n*/";
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
