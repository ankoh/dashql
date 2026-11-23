//! The syntax spans of comments: comment tags are highlighted like code, everything else is a comment.
//!
//! Every tag, `@vis`, `@board`, `@flow`, `@param` and the `@end` that older scripts close a region
//! of line comments with, is a keyword, so the tags of an annotation read alike. The JSON of `@vis vegalite` is split
//! into its tokens: keys are identifiers, strings, numbers and booleans are literals. In a `@vis` tag, the kind is a
//! keyword and `{{field}}` placeholders of Markdown templates are identifiers. The keys of the args of `@board`,
//! `@flow` and `@vis kpi` (and of `@vis board` and `@vis flow` of older scripts) are identifiers, their values
//! literals, read like `vis_args` reads them. The rest of the comment stays a comment, e.g. the value of a `@param`.
//!
//! The JSON objects of `vegalite` tags are found with the tokens, editors fold them.

use crate::vis_args::{scan_args, ArgValue};
use crate::vis_text::{JsonScanner, JsonSlot, JsonTokenKind, TagText};
use crate::visualize::markdown_placeholders;
use dashql_buffers::parser::{CommentBlockType, ScannerTokenType};
use dashql_parser::comment_blocks::{COMMENT_TAG_END, COMMENT_TAG_PREFIX};
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;

/// The tag of visualizations
const VIS_TAG: &[u8] = b"vis";
/// The tag of the dashboard placement
const BOARD_TAG: &[u8] = b"board";
/// The tag of the position on the dataflow canvas
const FLOW_TAG: &[u8] = b"flow";

/// The tokens of the content lines of a `board` or `markdown` tag
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

    /// The `key=value` args of a tag (see `vis_args`): the keys are identifiers, the values literals, a name like a
    /// string
    fn args(&mut self, begin: usize, end: usize) {
        // A span outside of the script has no args
        let Some(text) = self.script.get(begin..end).and_then(|text| std::str::from_utf8(text).ok()) else { return };
        for arg in scan_args(text, "").args {
            self.push(begin + arg.key_range.start, begin + arg.key_range.end, ScannerTokenType::IDENTIFIER);
            let token = match &arg.value {
                ArgValue::Number(number) if number.contains(['.', 'e', 'E']) => ScannerTokenType::LITERAL_FLOAT,
                ArgValue::Number(_) => ScannerTokenType::LITERAL_INTEGER,
                ArgValue::Name(_) | ArgValue::String(_) => ScannerTokenType::LITERAL_STRING,
                ArgValue::Missing | ArgValue::Invalid => continue,
            };
            self.push(begin + arg.value_range.start, begin + arg.value_range.end, token);
        }
    }

    /// The `{{field}}` placeholders of a Markdown template
    fn placeholders(&mut self, begin: usize, end: usize) {
        // A span outside of the script has no placeholders
        let Some(text) = self.script.get(begin..end).and_then(|text| std::str::from_utf8(text).ok()) else { return };
        for placeholder in markdown_placeholders(text) {
            self.push(begin + placeholder.range.start, begin + placeholder.range.end, ScannerTokenType::IDENTIFIER);
        }
    }
}

/// The tokens of the JSON of a tag, from `body` in the tag text, and the spans of its outermost objects
fn json_tokens(
    tag: &TagText,
    body: usize,
    out: &mut Vec<(TextSpan, ScannerTokenType)>,
    mut objects: Option<&mut Vec<TextSpan>>,
) {
    // A body past the tag text has no tokens
    let Some(json) = tag.text.as_bytes().get(body..) else { return };
    let mut object_begin = None;
    for token in JsonScanner::new(json) {
        let (begin, end) = (body + token.begin, body + token.end);
        let token_type = match token.kind {
            JsonTokenKind::ObjectBegin if token.depth == 0 => {
                object_begin = Some(begin);
                continue;
            }
            JsonTokenKind::ObjectEnd if token.depth == 0 => {
                if let (Some(begin), Some(objects)) = (object_begin.take(), objects.as_deref_mut()) {
                    objects.push(tag.span(begin, end));
                }
                continue;
            }
            JsonTokenKind::String { .. } if token.slot == Some(JsonSlot::Key) => ScannerTokenType::IDENTIFIER,
            JsonTokenKind::String { .. } => ScannerTokenType::LITERAL_STRING,
            JsonTokenKind::Number
                if json
                    .get(token.begin..token.end)
                    .is_some_and(|t| t.iter().any(|c| matches!(c, b'.' | b'e' | b'E'))) =>
            {
                ScannerTokenType::LITERAL_FLOAT
            }
            JsonTokenKind::Number => ScannerTokenType::LITERAL_INTEGER,
            JsonTokenKind::Literal if json.get(token.begin..token.end) == Some(b"null".as_slice()) => {
                ScannerTokenType::KEYWORD
            }
            JsonTokenKind::Literal => ScannerTokenType::LITERAL_BOOLEAN,
            _ => continue,
        };
        out.push((tag.span(begin, end), token_type));
    }
}

/// The `@end` of a line comment that closes a tagged region, as script offsets
fn end_tag(script: &[u8], comment: TextSpan) -> Option<(usize, usize)> {
    let (begin, end) = (comment.offset as usize, comment.end() as usize);
    let text = script.get(begin..end)?;
    let dashes = text.iter().take_while(|&&c| c == b'-').count();
    if dashes < 2 {
        return None;
    }
    let rest = text.get(dashes..)?;
    let trimmed = rest.trim_ascii();
    let end_tag = [COMMENT_TAG_PREFIX.as_bytes(), COMMENT_TAG_END.as_bytes()].concat();
    if trimmed != end_tag.as_slice() {
        return None;
    }
    let at = begin + dashes + (rest.len() - rest.trim_ascii_start().len());
    Some((at, at + end_tag.len()))
}

/// The highlighted tokens of the comment tags, sorted by offset, and the JSON objects of the `vegalite` tags
fn tag_tokens(parsed: &ParsedScript) -> (Vec<(TextSpan, ScannerTokenType)>, Vec<TextSpan>) {
    let script = parsed.scanned.text.as_bytes();
    let blocks = &parsed.comment_blocks;
    let mut out = Vec::new();
    let mut objects = Vec::new();
    for block in &blocks.blocks {
        if block.block_type != CommentBlockType::DASHQL_TAG {
            continue;
        }
        let tag = block.tag_span;
        // A tag outside of the script is not highlighted
        let Some(name) = script.get(tag.offset as usize..tag.end() as usize) else { continue };
        let mut lines = Lines { script, out: &mut out };
        // The tag with its `@`, and the end line of a region of line comments
        lines.push(tag.offset as usize - 1, tag.end() as usize, ScannerTokenType::KEYWORD);
        let last = ((block.comments_begin + block.comments_count) as usize)
            .checked_sub(1)
            .and_then(|i| parsed.scanned.comments.get(i));
        if let Some((begin, end)) = last.and_then(|&last| end_tag(script, last)) {
            lines.push(begin, end, ScannerTokenType::KEYWORD);
        }
        let content = blocks
            .lines
            .get(block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize)
            .unwrap_or_default();
        // `@board` and `@flow` are args
        if name == BOARD_TAG || name == FLOW_TAG {
            if let Some(first) = content.first() {
                lines.args(first.offset as usize, first.end() as usize);
            }
            continue;
        }
        if name != VIS_TAG {
            continue;
        }
        let Some(first) = content.first() else { continue };
        let first_begin = first.offset as usize;
        let first_line = script.get(first_begin..first.end() as usize).unwrap_or_default();
        let kind = first_line.split(u8::is_ascii_whitespace).next().unwrap_or_default();
        let kind_end = first_begin + kind.len();
        lines.push(first_begin, kind_end, ScannerTokenType::KEYWORD);
        if kind == b"vegalite" {
            let text = TagText::new(&parsed.scanned.text, content, block.text_span);
            json_tokens(&text, kind_end - first_begin, &mut out, Some(&mut objects));
            continue;
        }
        for (i, line) in content.iter().enumerate() {
            let begin = if i == 0 { kind_end } else { line.offset as usize };
            let end = line.end() as usize;
            match kind {
                b"board" | b"card" | b"flow" if i == 0 => lines.args(begin, end),
                b"kpi" if i == 0 => lines.args(begin, end),
                b"markdown" => lines.placeholders(begin, end),
                _ => {}
            }
        }
    }
    out.sort_by_key(|(span, _)| span.offset);
    objects.sort_by_key(|span| span.offset);
    (out, objects)
}

/// The syntax spans of the comments: a comment is one comment span, comment tags are split into their
/// tokens and the comment spans between them. Returns the spans and the JSON objects of the `vegalite` tags.
pub fn comment_syntax_spans(parsed: &ParsedScript) -> (Vec<(TextSpan, ScannerTokenType)>, Vec<TextSpan>) {
    let (tokens, objects) = tag_tokens(parsed);
    let mut out = Vec::with_capacity(parsed.scanned.comments.len() + tokens.len() * 2);
    let mut tokens = tokens.iter().peekable();
    for &comment in &parsed.scanned.comments {
        let mut at = comment.offset as usize;
        let end = comment.end() as usize;
        while tokens.next_if(|(span, _)| (span.offset as usize) < at).is_some() {}
        while let Some(&(span, token)) = tokens.next_if(|(span, _)| (span.end() as usize) <= end) {
            if span.offset as usize > at {
                out.push((TextSpan::new(at as u32, span.offset - at as u32), ScannerTokenType::COMMENT));
            }
            out.push((span, token));
            at = span.end() as usize;
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
            spans("-- @vis board width=6\n-- @vis markdown **{{a}}**\n-- @end\nselect 1"),
            vec![
                ("-- ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("board", T::KEYWORD),
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
                ("-- ", T::COMMENT),
                ("@end", T::KEYWORD),
            ]
        );
    }

    #[test]
    fn highlights_the_placeholders_of_a_markdown_template() {
        use ScannerTokenType as T;
        // Like the template compiles: the last two of more braces open a placeholder, an escaped one is text
        assert_eq!(
            spans("/* @vis markdown {{{a}}} \\{{b}} {{}} */ select 1"),
            vec![
                ("/* ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("markdown", T::KEYWORD),
                (" {", T::COMMENT),
                ("{{a}}", T::IDENTIFIER),
                ("} \\{{b}} {{}} */", T::COMMENT),
            ]
        );
    }

    #[test]
    fn highlights_the_args_of_a_kpi_card() {
        use ScannerTokenType as T;
        // The keys are identifiers, the column names and the kind of change literals, a quoted name as a whole
        assert_eq!(
            spans("/* @vis kpi value = \"Total revenue\" delta=none */ select 1 as \"Total revenue\""),
            vec![
                ("/* ", T::COMMENT),
                ("@vis", T::KEYWORD),
                (" ", T::COMMENT),
                ("kpi", T::KEYWORD),
                (" ", T::COMMENT),
                ("value", T::IDENTIFIER),
                (" = ", T::COMMENT),
                ("\"Total revenue\"", T::LITERAL_STRING),
                (" ", T::COMMENT),
                ("delta", T::IDENTIFIER),
                ("=", T::COMMENT),
                ("none", T::LITERAL_STRING),
                (" */", T::COMMENT),
            ]
        );
    }

    #[test]
    fn highlights_every_tag_alike() {
        use ScannerTokenType as T;
        // The content of a tag without tokens stays a comment, the keys of the args of a board are identifiers
        assert_eq!(
            spans("/* @param Sales.\n   @board width=6\n*/\nselect 1"),
            vec![
                ("/* ", T::COMMENT),
                ("@param", T::KEYWORD),
                (" Sales.\n   ", T::COMMENT),
                ("@board", T::KEYWORD),
                (" ", T::COMMENT),
                ("width", T::IDENTIFIER),
                ("=", T::COMMENT),
                ("6", T::LITERAL_INTEGER),
                ("\n*/", T::COMMENT),
            ]
        );
        assert_eq!(
            spans("-- @param\n-- Sales.\n--   @end\nselect 1"),
            vec![
                ("-- ", T::COMMENT),
                ("@param", T::KEYWORD),
                ("-- Sales.", T::COMMENT),
                ("--   ", T::COMMENT),
                ("@end", T::KEYWORD),
            ]
        );
        // A region of line comments ends with the run, the end line is not needed
        assert_eq!(
            spans("-- @param Sales.\nselect 1"),
            vec![("-- ", T::COMMENT), ("@param", T::KEYWORD), (" Sales.", T::COMMENT)]
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
        assert_eq!(
            vegalite_specs("-- @vis vegalite {\"mark\":\"bar\"}\n-- @end\nselect 1"),
            vec!["{\"mark\":\"bar\"}"]
        );
        // Only the JSON of vegalite tags, and only closed objects
        assert_eq!(
            vegalite_specs("/* @vis markdown {{a}} */ select 1; /* {\"mark\": 1} */ select 2"),
            Vec::<&str>::new()
        );
        assert_eq!(vegalite_specs("/* @vis vegalite {\"mark\": \"bar\" */ select 1"), Vec::<&str>::new());
    }
}
