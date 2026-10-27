//! The syntax spans of comments: `@vis` tags are highlighted like code, everything else is a comment.
//!
//! In a `@vis` tag, the tag and the kind are keywords. JSON keys and the keys of `card` args are
//! identifiers, JSON strings, numbers and booleans are literals, and `{{field}}` placeholders of Markdown
//! templates are identifiers. The rest of the comment stays a comment.

use dashql_buffers::parser::{CommentBlockType, ScannerTokenType};
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;

/// The tag of visualizations
const VIS_TAG: &[u8] = b"vis";

/// The tokens of the content lines of a tag
struct Lines<'a> {
    script: &'a [u8],
    out: &'a mut Vec<(TextSpan, ScannerTokenType)>,
}

impl Lines<'_> {
    fn push(&mut self, begin: usize, end: usize, token: ScannerTokenType) {
        if end > begin {
            self.out.push((TextSpan::new(begin as u32, (end - begin) as u32), token));
        }
    }

    /// The tokens of JSON text, `begin..end` lies on one line
    fn json(&mut self, begin: usize, end: usize) {
        let text = self.script;
        let mut i = begin;
        while i < end {
            let c = text[i];
            if c == b'"' {
                let token_begin = i;
                i += 1;
                while i < end && text[i] != b'"' {
                    i += if text[i] == b'\\' { 2 } else { 1 };
                }
                i = (i + 1).min(end);
                // A string followed by a colon is a key
                let mut next = i;
                while next < end && text[next].is_ascii_whitespace() {
                    next += 1;
                }
                let token = if text.get(next) == Some(&b':') {
                    ScannerTokenType::IDENTIFIER
                } else {
                    ScannerTokenType::LITERAL_STRING
                };
                self.push(token_begin, i, token);
            } else if c == b'-' || c.is_ascii_digit() {
                let token_begin = i;
                i += 1;
                while i < end && (text[i].is_ascii_digit() || matches!(text[i], b'.' | b'e' | b'E' | b'+' | b'-')) {
                    i += 1;
                }
                let float = text[token_begin..i].iter().any(|c| matches!(c, b'.' | b'e' | b'E'));
                let token = if float { ScannerTokenType::LITERAL_FLOAT } else { ScannerTokenType::LITERAL_INTEGER };
                self.push(token_begin, i, token);
            } else if c.is_ascii_alphabetic() {
                let token_begin = i;
                while i < end && text[i].is_ascii_alphabetic() {
                    i += 1;
                }
                match &text[token_begin..i] {
                    b"true" | b"false" => self.push(token_begin, i, ScannerTokenType::LITERAL_BOOLEAN),
                    b"null" => self.push(token_begin, i, ScannerTokenType::KEYWORD),
                    _ => {}
                }
            } else {
                i += 1;
            }
        }
    }

    /// The `key=value` args of a card
    fn args(&mut self, begin: usize, end: usize) {
        let text = self.script;
        let mut i = begin;
        while i < end {
            while i < end && text[i].is_ascii_whitespace() {
                i += 1;
            }
            let arg_begin = i;
            while i < end && !text[i].is_ascii_whitespace() {
                i += 1;
            }
            if let Some(eq) = text[arg_begin..i].iter().position(|&c| c == b'=') {
                self.push(arg_begin, arg_begin + eq, ScannerTokenType::IDENTIFIER);
                self.push(arg_begin + eq + 1, i, ScannerTokenType::LITERAL_INTEGER);
            }
        }
    }

    /// The `{{field}}` placeholders of a Markdown template
    fn placeholders(&mut self, begin: usize, end: usize) {
        let text = self.script;
        let mut i = begin;
        while i + 1 < end {
            if &text[i..i + 2] != b"{{" {
                i += 1;
                continue;
            }
            match text[i + 2..end].windows(2).position(|w| w == b"}}") {
                Some(close) => {
                    let close = i + 2 + close + 2;
                    self.push(i, close, ScannerTokenType::IDENTIFIER);
                    i = close;
                }
                None => break,
            }
        }
    }
}

/// The highlighted tokens of the `@vis` tags, sorted by offset
fn vis_tokens(parsed: &ParsedScript) -> Vec<(TextSpan, ScannerTokenType)> {
    let script = parsed.scanned.text.as_bytes();
    let blocks = &parsed.comment_blocks;
    let mut out = Vec::new();
    for block in &blocks.blocks {
        let tag = block.tag_span;
        if block.block_type != CommentBlockType::DASHQL_TAG || &script[tag.offset as usize..tag.end() as usize] != VIS_TAG {
            continue;
        }
        let mut lines = Lines { script, out: &mut out };
        // The tag with its `@`
        lines.push(tag.offset as usize - 1, tag.end() as usize, ScannerTokenType::KEYWORD);
        let content = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
        let Some(first) = content.first() else { continue };
        let first_begin = first.offset as usize;
        let mut kind_end = first_begin;
        while kind_end < first.end() as usize && !script[kind_end].is_ascii_whitespace() {
            kind_end += 1;
        }
        lines.push(first_begin, kind_end, ScannerTokenType::KEYWORD);
        let kind = &script[first_begin..kind_end];
        for (i, line) in content.iter().enumerate() {
            let begin = if i == 0 { kind_end } else { line.offset as usize };
            let end = line.end() as usize;
            match kind {
                b"vegalite" => lines.json(begin, end),
                b"card" if i == 0 => lines.args(begin, end),
                b"markdown" => lines.placeholders(begin, end),
                _ => {}
            }
        }
    }
    out.sort_by_key(|(span, _)| span.offset);
    out
}

/// The syntax spans of the comments: a comment is one comment span, `@vis` tags are split into their
/// tokens and the comment spans between them
pub fn comment_syntax_spans(parsed: &ParsedScript) -> Vec<(TextSpan, ScannerTokenType)> {
    let tokens = vis_tokens(parsed);
    let mut out = Vec::with_capacity(parsed.scanned.comments.len() + tokens.len() * 2);
    let mut next = 0;
    for &comment in &parsed.scanned.comments {
        let mut at = comment.offset as usize;
        let end = comment.end() as usize;
        while next < tokens.len() && (tokens[next].0.offset as usize) < at {
            next += 1;
        }
        while next < tokens.len() && (tokens[next].0.end() as usize) <= end {
            let (span, token) = tokens[next];
            if span.offset as usize > at {
                out.push((TextSpan::new(at as u32, span.offset - at as u32), ScannerTokenType::COMMENT));
            }
            out.push((span, token));
            at = span.end() as usize;
            next += 1;
        }
        if end > at {
            out.push((TextSpan::new(at as u32, (end - at) as u32), ScannerTokenType::COMMENT));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;
    use std::sync::Arc;

    fn spans(text: &str) -> Vec<(&str, ScannerTokenType)> {
        let parsed = parse(Arc::new(scan(text, 0, 0)));
        comment_syntax_spans(&parsed)
            .into_iter()
            .map(|(span, token)| (&text[span.offset as usize..span.end() as usize], token))
            .collect()
    }

    #[test]
    fn highlights_vis_tags() {
        use ScannerTokenType as T;
        assert_eq!(spans("/* plain @vis */ select 1"), vec![("/* plain @vis */", T::COMMENT)]);
        assert_eq!(
            spans("/* @vis vegalite {\"mark\": \"bar\", \"x\": 1.5, \"y\": true} */ select 1"),
            vec![
                ("/* ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("vegalite", T::KEYWORD),
                (" {", T::COMMENT),
                ("\"mark\"", T::IDENTIFIER),
                (": ", T::COMMENT),
                ("\"bar\"", T::LITERAL_STRING),
                (", ", T::COMMENT),
                ("\"x\"", T::IDENTIFIER),
                (": ", T::COMMENT),
                ("1.5", T::LITERAL_FLOAT),
                (", ", T::COMMENT),
                ("\"y\"", T::IDENTIFIER),
                (": ", T::COMMENT),
                ("true", T::LITERAL_BOOLEAN),
                ("} */", T::COMMENT),
            ]
        );
        assert_eq!(
            spans("-- @vis card width=6\n-- @vis markdown **{{a}}**\n-- @end\nselect 1"),
            vec![
                ("-- ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("card", T::KEYWORD),
                (" ", T::COMMENT),
                ("width", T::IDENTIFIER),
                ("=", T::COMMENT),
                ("6", T::LITERAL_INTEGER),
                ("-- ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("markdown", T::KEYWORD),
                (" **", T::COMMENT),
                ("{{a}}", T::IDENTIFIER),
                ("**", T::COMMENT),
                ("-- @end", T::COMMENT),
            ]
        );
    }
}
