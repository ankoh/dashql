//! Comment output of the formatter.
//!
//! Comments work on bytes: wrapping splits long words at byte offsets, which can split UTF-8
//! sequences (see docs/design/core_quirks.md).

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

/// Format a run of line comments. Regions from `-- @<tag>` to the next tag line or `-- @end` are kept
/// as written, since their content is structured (e.g. JSON) and rewrapping it would break it. Other
/// comments are rewrapped. Only the last region of consecutive regions needs the end line. A blank line that follows a region is kept, `following` is the offset of
/// the text after the comment block.
fn append_line_comment_block(
    output: &mut Vec<u8>,
    input: &[u8],
    comments: &[TextSpan],
    max_width: usize,
    following: Option<usize>,
) {
    let mut pending = 0;
    let mut i = 0;
    while i < comments.len() {
        match read_comment_tag(input, &comments[i]) {
            Some(tag) if tag.name != COMMENT_TAG_END.as_bytes() => {}
            _ => {
                i += 1;
                continue;
            }
        }
        // Consecutive regions are kept as one, up to the end line of the last region. Without an end
        // line, the next tag line still closes a region.
        let mut close = i + 1;
        let mut next_tag = None;
        while close < comments.len() {
            if let Some(tag) = read_comment_tag(input, &comments[close]) {
                if tag.name != COMMENT_TAG_END.as_bytes() {
                    next_tag = next_tag.or(Some(close));
                } else if tag.alone {
                    break;
                }
            }
            close += 1;
        }
        let region_end = match (close < comments.len(), next_tag) {
            (true, _) => close + 1,
            (false, Some(next)) => next,
            // An unterminated region is an ordinary comment
            (false, None) => {
                i += 1;
                continue;
            }
        };
        if pending < i {
            append_wrapped_line_comments(output, input, &comments[pending..i], max_width);
        }
        let region = &comments[i..region_end];
        let has_vis = region.iter().any(|c| read_comment_tag(input, c).is_some_and(|t| t.name == VIS_TAG));
        if let Some(block) = has_vis.then(|| print_vis_comment(input, region)).flatten() {
            if !output.is_empty() && !ends_with_line_break(output) {
                output.push(b'\n');
            }
            output.extend_from_slice(&block);
        } else {
            for comment in region {
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
        let region_text_end = comments[region_end - 1].end() as usize;
        let next = if region_end < comments.len() { Some(comments[region_end].offset as usize) } else { following };
        if let Some(next) = next {
            if next >= region_text_end {
                let gap = substr(input, region_text_end, next - region_text_end);
                if count_line_breaks(gap) > 1 {
                    output.extend_from_slice(b"\n\n");
                }
            }
        }
        pending = region_end;
        i = region_end;
    }
    if pending < comments.len() {
        append_wrapped_line_comments(output, input, &comments[pending..], max_width);
    }
}

/// The tag of visualizations, `@vis <kind> ...`
const VIS_TAG: &[u8] = b"vis";
/// The indentation of the lines after the first in a canonical block comment, aligned after `/* `
const VIS_COMMENT_INDENT: &[u8] = b"   ";

/// Split a line at its first whitespace, the rest is trimmed
fn split_word(line: &[u8]) -> (&[u8], &[u8]) {
    let end = find_first_of(line, b" \t\r\x0c\x0b").unwrap_or(line.len());
    (&line[..end], trim_whitespace(&line[end..]))
}

/// The canonical lines of a `@vis` tag, `lines` are its content lines
fn vis_tag_lines(lines: &[&[u8]]) -> Vec<Vec<u8>> {
    let tag = |rest: &[u8]| {
        let mut line = b"@vis".to_vec();
        if !rest.is_empty() {
            line.push(b' ');
            line.extend_from_slice(rest);
        }
        line
    };
    let Some((header, body)) = lines.split_first() else { return vec![tag(b"")] };
    let (kind, rest) = split_word(header);
    let verbatim = || std::iter::once(tag(header)).chain(body.iter().map(|l| l.to_vec())).collect();
    match kind {
        b"vegalite" => {
            // The JSON is pretty-printed with the key order kept, malformed JSON stays as written
            let json = std::iter::once(rest).chain(body.iter().copied()).collect::<Vec<_>>().join(&b'\n');
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(&json) else { return verbatim() };
            let pretty = serde_json::to_string_pretty(&value).expect("a JSON value always serializes");
            std::iter::once(tag(kind)).chain(pretty.lines().map(|l| l.as_bytes().to_vec())).collect()
        }
        b"table" | b"card" => {
            // Args are separated by single spaces
            let mut header = kind.to_vec();
            let mut rest = rest;
            while !rest.is_empty() {
                let (arg, next) = split_word(rest);
                header.push(b' ');
                header.extend_from_slice(arg);
                rest = next;
            }
            std::iter::once(tag(&header)).chain(body.iter().map(|l| l.to_vec())).collect()
        }
        _ => verbatim(),
    }
}

/// Print comments that hold a `@vis` tag as one canonical block comment. The tags keep their order,
/// text before the first tag stays in front of them. Returns None if the comments stay as written:
/// without a `@vis` tag, with malformed tags, or with text that would end or nest a block comment.
fn print_vis_comment(input: &[u8], comments: &[TextSpan]) -> Option<Vec<u8>> {
    let blocks = group_comment_bytes(input, comments);
    if !blocks.warnings.is_empty() {
        return None;
    }
    let span_text = |span: TextSpan| substr(input, span.offset as usize, span.length as usize);
    let block_lines = |block: &dashql_parser::comment_blocks::CommentBlock| {
        let lines = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
        lines.iter().map(|&l| span_text(l)).collect::<Vec<_>>()
    };
    let mut lines: Vec<Vec<u8>> = Vec::new();
    let mut has_vis = false;
    for (i, block) in blocks.blocks.iter().enumerate() {
        let content = block_lines(block);
        if block.block_type == CommentBlockType::COMMENT {
            // Only text before the first tag is allowed
            if i > 0 {
                return None;
            }
            lines.extend(content.iter().map(|l| l.to_vec()));
            continue;
        }
        let name = span_text(block.tag_span);
        if name == VIS_TAG {
            has_vis = true;
            lines.extend(vis_tag_lines(&content));
            continue;
        }
        // Other tags are kept, text that followed the tag on its line stays there
        let mut tag = COMMENT_TAG_PREFIX.as_bytes().to_vec();
        tag.extend_from_slice(name);
        let tag_end = block.tag_span.end() as usize;
        let inline = block.lines_count > 0
            && !substr(input, tag_end, (blocks.lines[block.lines_begin as usize].offset as usize).saturating_sub(tag_end))
                .contains(&b'\n');
        let mut rest = content.iter();
        if inline {
            tag.push(b' ');
            tag.extend_from_slice(rest.next().unwrap());
        }
        lines.push(tag);
        lines.extend(rest.map(|l| l.to_vec()));
    }
    if !has_vis || lines.iter().any(|l| l.windows(2).any(|w| w == b"/*" || w == b"*/")) {
        return None;
    }
    let mut out = b"/* ".to_vec();
    if let [line] = &lines[..] {
        out.extend_from_slice(line);
        out.extend_from_slice(b" */");
        return Some(out);
    }
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
            if !line.is_empty() {
                out.extend_from_slice(VIS_COMMENT_INDENT);
            }
        }
        out.extend_from_slice(line);
    }
    out.extend_from_slice(b"\n*/");
    Some(out)
}

/// Append comments: block comments verbatim, runs of line comments rewrapped. Comments with a `@vis`
/// tag are printed as canonical block comments.
pub(super) fn append_comments(
    output: &mut Vec<u8>,
    input: &[u8],
    comments: &[TextSpan],
    max_width: usize,
    following: Option<usize>,
) {
    let mut block_begin = 0;
    for i in 0..=comments.len() {
        let mut end_block = i == comments.len();
        let mut is_block_comment = false;
        if !end_block {
            is_block_comment = comment_text(input, &comments[i]).starts_with(b"/*");
            end_block = is_block_comment;
        }
        if !end_block && !is_block_comment && i > block_begin {
            let previous_end = comments[i - 1].end() as usize;
            let gap = substr(input, previous_end, (comments[i].offset as usize).wrapping_sub(previous_end));
            end_block = !is_whitespace(gap) || count_line_breaks(gap) > 1;
        }
        if end_block {
            if i > block_begin {
                let next = if i < comments.len() { Some(comments[i].offset as usize) } else { following };
                append_line_comment_block(output, input, &comments[block_begin..i], max_width, next);
            }
            block_begin = i;
        }
        if is_block_comment {
            if !output.is_empty() && !ends_with_line_break(output) {
                output.push(b'\n');
            }
            let text = comment_text(input, &comments[i]);
            match find_subslice(text, b"@vis").and_then(|_| print_vis_comment(input, &comments[i..=i])) {
                Some(block) => output.extend_from_slice(&block),
                None => output.extend_from_slice(text),
            }
            block_begin = i + 1;
        }
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
    fn keeps_tagged_regions() {
        let input = "-- @metadata\n-- {\"a\":   1}\n-- @end\n\n-- x   y";
        let out = format(input, &["-- @metadata", "-- {\"a\":   1}", "-- @end", "-- x   y"], 120);
        assert_eq!(out, "-- @metadata\n-- {\"a\":   1}\n-- @end\n\n-- x y");
    }

    /// Format a script that consists of comments, every comment is found by the scanner
    fn format_comments(input: &str) -> String {
        let scanned = dashql_parser::scanner::scan(input, 0, 0);
        let mut out = Vec::new();
        append_comments(&mut out, input.as_bytes(), &scanned.comments, 120, None);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn prints_vis_block_comments() {
        assert_eq!(format_comments("/*   @vis   card  width=6   height=3 */"), "/* @vis card width=6 height=3 */");
        assert_eq!(format_comments("/* @vis table */"), "/* @vis table */");
        assert_eq!(
            format_comments("/* @vis vegalite {\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}} */"),
            "/* @vis vegalite\n   {\n     \"mark\": \"bar\",\n     \"encoding\": {\n       \"x\": {\n         \"field\": \"a\"\n       }\n     }\n   }\n*/"
        );
        // Formatting twice gives the same output
        let once = format_comments("/* @vis vegalite\n{\"mark\":\"bar\"}\n*/");
        assert_eq!(format_comments(&once), once);
    }

    #[test]
    fn prints_vis_line_comments_as_block_comment() {
        let input = "-- @description Revenue.\n-- @vis card width=6\n-- @vis vegalite\n-- {\"mark\": \"bar\"}\n-- @end";
        let expected = "/* @description Revenue.\n   @vis card width=6\n   @vis vegalite\n   {\n     \"mark\": \"bar\"\n   }\n*/";
        assert_eq!(format_comments(input), expected);
        assert_eq!(format_comments(expected), expected);
        // Regions without a @vis tag stay line comments
        let input = "-- @description Revenue.\n-- @end";
        assert_eq!(format_comments(input), input);
    }

    #[test]
    fn keeps_text_before_the_first_vis_tag() {
        let input = "/* Revenue dashboard.\n      @vis table\n*/";
        assert_eq!(format_comments(input), "/* Revenue dashboard.\n   @vis table\n*/");
    }

    #[test]
    fn keeps_markdown_and_malformed_json() {
        let input = "/* @vis markdown\n   - {{a}}\n     - {{b}}\n*/";
        assert_eq!(format_comments(input), input);
        let input = "/* @vis vegalite {\"mark\": */";
        assert_eq!(format_comments(input), "/* @vis vegalite {\"mark\": */");
        let input = "/* @vis vegalite\n     {\"mark\":\n  */";
        assert_eq!(format_comments(input), "/* @vis vegalite\n   {\"mark\":\n*/");
    }

    #[test]
    fn keeps_vis_line_comments_that_cannot_be_block_comments() {
        let input = "-- @vis markdown\n-- see */ here\n-- @end";
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
