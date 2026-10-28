//! The syntax spans of comments: `@vis` tags are highlighted like code, everything else is a comment.
//!
//! In a `@vis` tag, the tag and the kind are keywords. JSON keys and the keys of `card` args are
//! identifiers, JSON strings, numbers and booleans are literals, and `{{field}}` placeholders of Markdown
//! templates are identifiers. The rest of the comment stays a comment.
//!
//! The JSON objects of `vegalite` tags are found with the tokens, editors fold them.

use crate::vis_text::{JsonScanner, JsonSlot, JsonTokenKind, TagText};
use dashql_buffers::parser::{CommentBlockType, ScannerTokenType};
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;

/// The tag of visualizations
const VIS_TAG: &[u8] = b"vis";

/// The tokens of the content lines of a `card` or `markdown` tag
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

/// The tokens of the JSON of a `vegalite` tag, from `body` in the tag text, and the spans of its outermost objects
fn json_tokens(tag: &TagText, body: usize, out: &mut Vec<(TextSpan, ScannerTokenType)>, objects: &mut Vec<TextSpan>) {
    let json = &tag.text.as_bytes()[body..];
    let mut object_begin = None;
    for token in JsonScanner::new(json) {
        let (begin, end) = (body + token.begin, body + token.end);
        let token_type = match token.kind {
            JsonTokenKind::ObjectBegin if token.depth == 0 => {
                object_begin = Some(begin);
                continue;
            }
            JsonTokenKind::ObjectEnd if token.depth == 0 => {
                if let Some(begin) = object_begin.take() {
                    objects.push(tag.span(begin, end));
                }
                continue;
            }
            JsonTokenKind::String { .. } if token.slot == Some(JsonSlot::Key) => ScannerTokenType::IDENTIFIER,
            JsonTokenKind::String { .. } => ScannerTokenType::LITERAL_STRING,
            JsonTokenKind::Number if json[token.begin..token.end].iter().any(|c| matches!(c, b'.' | b'e' | b'E')) => {
                ScannerTokenType::LITERAL_FLOAT
            }
            JsonTokenKind::Number => ScannerTokenType::LITERAL_INTEGER,
            JsonTokenKind::Literal if &json[token.begin..token.end] == b"null" => ScannerTokenType::KEYWORD,
            JsonTokenKind::Literal => ScannerTokenType::LITERAL_BOOLEAN,
            _ => continue,
        };
        out.push((tag.span(begin, end), token_type));
    }
}

/// The highlighted tokens of the `@vis` tags, sorted by offset, and the JSON objects of the `vegalite` tags
fn vis_tokens(parsed: &ParsedScript) -> (Vec<(TextSpan, ScannerTokenType)>, Vec<TextSpan>) {
    let script = parsed.scanned.text.as_bytes();
    let blocks = &parsed.comment_blocks;
    let mut out = Vec::new();
    let mut objects = Vec::new();
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
        if kind == b"vegalite" {
            let text = TagText::new(&parsed.scanned.text, content, block.text_span);
            json_tokens(&text, kind_end - first_begin, &mut out, &mut objects);
            continue;
        }
        for (i, line) in content.iter().enumerate() {
            let begin = if i == 0 { kind_end } else { line.offset as usize };
            let end = line.end() as usize;
            match kind {
                b"card" if i == 0 => lines.args(begin, end),
                b"markdown" => lines.placeholders(begin, end),
                _ => {}
            }
        }
    }
    out.sort_by_key(|(span, _)| span.offset);
    objects.sort_by_key(|span| span.offset);
    (out, objects)
}

/// The syntax spans of the comments: a comment is one comment span, `@vis` tags are split into their
/// tokens and the comment spans between them. Returns the spans and the JSON objects of the `vegalite` tags.
pub fn comment_syntax_spans(parsed: &ParsedScript) -> (Vec<(TextSpan, ScannerTokenType)>, Vec<TextSpan>) {
    let (tokens, objects) = vis_tokens(parsed);
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
    (out, objects)
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
            .0
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

    fn vegalite_specs(text: &str) -> Vec<&str> {
        let parsed = parse(Arc::new(scan(text, 0, 0)));
        comment_syntax_spans(&parsed)
            .1
            .into_iter()
            .map(|span| &text[span.offset as usize..span.end() as usize])
            .collect()
    }

    #[test]
    fn finds_vegalite_specs() {
        assert_eq!(
            vegalite_specs("/* @vis vegalite\n   {\n     \"mark\": {\"type\": \"bar\"},\n     \"title\": \"a } b\"\n   }\n*/\nselect 1"),
            vec!["{\n     \"mark\": {\"type\": \"bar\"},\n     \"title\": \"a } b\"\n   }"]
        );
        assert_eq!(vegalite_specs("-- @vis vegalite {\"mark\":\"bar\"}\n-- @end\nselect 1"), vec!["{\"mark\":\"bar\"}"]);
        // Only the JSON of vegalite tags, and only closed objects
        assert_eq!(vegalite_specs("/* @vis markdown {{a}} */ select 1; /* {\"mark\": 1} */ select 2"), Vec::<&str>::new());
        assert_eq!(vegalite_specs("/* @vis vegalite {\"mark\": \"bar\" */ select 1"), Vec::<&str>::new());
    }
}
