//! Reading the content of `@vis` tags: the joined text of a tag and a tolerant JSON scanner.
//!
//! The content lines of a tag are joined with line breaks into one text, offsets map back to the script.
//! The JSON of `vegalite` tags is scanned token by token, also when it is incomplete or malformed, and
//! every scalar knows its slot: a key, the value of a key or an element of an array. Highlighting,
//! completion and the warnings of the analyzer find their way through the JSON with this scanner,
//! `serde_json` builds the values.

use dashql_parser::span::TextSpan;

/// The content of a tag: its lines joined with line breaks, mapped back to the script text
pub(crate) struct TagText {
    /// The joined content lines
    pub text: String,
    /// The script offset of every content line and its offset in the joined text
    lines: Vec<(usize, usize)>,
    /// The whole tag block, the location of spans in a tag without content
    block: TextSpan,
}

impl TagText {
    pub fn new(script: &str, lines: &[TextSpan], block: TextSpan) -> Self {
        let mut text = String::new();
        let mut offsets = Vec::with_capacity(lines.len());
        for (i, line) in lines.iter().enumerate() {
            if i > 0 {
                text.push('\n');
            }
            offsets.push((line.offset as usize, text.len()));
            text.push_str(&script[line.offset as usize..line.end() as usize]);
        }
        Self {
            text,
            lines: offsets,
            block,
        }
    }

    /// Does the tag have content lines?
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    /// The script span of a range of the joined text. A range across lines includes the comment markers
    /// and gutters between them.
    pub fn span(&self, begin: usize, end: usize) -> TextSpan {
        if self.lines.is_empty() {
            return self.block;
        }
        let (begin, end) = (self.to_script(begin), self.to_script(end));
        TextSpan::new(begin as u32, (end - begin) as u32)
    }

    /// The joined offset of a script offset. An offset before the content of a line, e.g. in its
    /// indentation, maps to the begin of the line.
    pub fn to_joined(&self, offset: usize) -> usize {
        let mut joined = 0;
        for (i, &(script, at)) in self.lines.iter().enumerate() {
            let len = self.line_len(i);
            if offset < script {
                return at;
            }
            if offset <= script + len {
                return at + offset - script;
            }
            joined = at + len;
        }
        joined
    }

    /// The script offset of a joined offset, the tag must have content lines
    fn to_script(&self, joined: usize) -> usize {
        let line = self.lines.partition_point(|&(_, at)| at <= joined).saturating_sub(1);
        let (script, at) = self.lines[line];
        script + joined - at
    }

    fn line_len(&self, i: usize) -> usize {
        let end = self.lines.get(i + 1).map_or(self.text.len(), |&(_, at)| at - 1);
        end - self.lines[i].1
    }
}

/// The kind of a JSON token
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum JsonTokenKind {
    ObjectBegin,
    ObjectEnd,
    ArrayBegin,
    ArrayEnd,
    Colon,
    Comma,
    /// A string, not closed if the text or the line ends before the closing quote
    String { closed: bool },
    /// A number, e.g. `-1.5e3`
    Number,
    /// `true`, `false` or `null`
    Literal,
    /// Any other text up to the next delimiter, e.g. a word that is still typed
    Word,
}

/// The slot of a scalar in its container
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum JsonSlot {
    /// A key of an object
    Key,
    /// The value of a key
    Value(String),
    /// An element of an array
    Element,
}

/// An element of the path to a token
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PathItem {
    Key(String),
    Index,
}

/// A token of JSON text
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct JsonToken {
    pub kind: JsonTokenKind,
    /// The byte range of the token
    pub begin: usize,
    pub end: usize,
    /// The number of containers around the token, the brackets of a container are outside of it
    pub depth: usize,
    /// The slot of a scalar (string, number, literal or word), None for brackets and punctuation and
    /// for a scalar where no value fits, e.g. a second value after a key
    pub slot: Option<JsonSlot>,
}

impl JsonToken {
    /// The value of a closed string
    pub fn string(&self, text: &[u8]) -> Option<String> {
        match self.kind {
            JsonTokenKind::String { closed: true } => serde_json::from_slice(&text[self.begin..self.end]).ok(),
            _ => None,
        }
    }
}

/// The state of an open container
enum Frame {
    Object { key: Option<String>, state: ObjectState },
    Array { expects_value: bool },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ObjectState {
    ExpectKey,
    ExpectColon,
    ExpectValue,
    AfterValue,
}

/// The bytes that end a number, a literal or a word
const DELIMITERS: &[u8] = b"{}[],:\" \t\r\n";

/// Scans JSON text into tokens and tracks the containers. Nothing is an error: unbalanced brackets,
/// missing commas and unclosed strings are scanned as they come.
pub(crate) struct JsonScanner<'a> {
    text: &'a [u8],
    at: usize,
    stack: Vec<Frame>,
}

impl<'a> JsonScanner<'a> {
    pub fn new(text: &'a [u8]) -> Self {
        Self {
            text,
            at: 0,
            stack: Vec::new(),
        }
    }

    /// The slot of the next scalar, None outside of containers or where no value fits
    pub fn slot(&self) -> Option<JsonSlot> {
        match self.stack.last()? {
            Frame::Object { state: ObjectState::ExpectKey, .. } => Some(JsonSlot::Key),
            Frame::Object { state: ObjectState::ExpectValue, key } => Some(JsonSlot::Value(key.clone().unwrap_or_default())),
            Frame::Array { expects_value: true } => Some(JsonSlot::Element),
            _ => None,
        }
    }

    /// The path to the innermost open container
    pub fn path(&self) -> Vec<PathItem> {
        let outer = self.stack.split_last().map_or(&[][..], |(_, outer)| outer);
        outer
            .iter()
            .map(|frame| match frame {
                Frame::Object { key, .. } => PathItem::Key(key.clone().unwrap_or_default()),
                Frame::Array { .. } => PathItem::Index,
            })
            .collect()
    }

    /// A value ended, the container moves on
    fn value_done(&mut self) {
        match self.stack.last_mut() {
            Some(Frame::Object { state, .. }) => *state = ObjectState::AfterValue,
            Some(Frame::Array { expects_value }) => *expects_value = false,
            None => {}
        }
    }

    /// A scalar ended: a key or a value
    fn scalar_done(&mut self, token: &JsonToken) {
        let text = self.text;
        match self.stack.last_mut() {
            Some(Frame::Object { key, state }) if *state == ObjectState::ExpectKey => {
                *key = Some(match token.kind {
                    JsonTokenKind::String { .. } => token.string(text).unwrap_or_default(),
                    _ => String::from_utf8_lossy(&text[token.begin..token.end]).into_owned(),
                });
                *state = ObjectState::ExpectColon;
            }
            _ => self.value_done(),
        }
    }
}

impl Iterator for JsonScanner<'_> {
    type Item = JsonToken;

    fn next(&mut self) -> Option<JsonToken> {
        let text = self.text;
        while self.at < text.len() && text[self.at].is_ascii_whitespace() {
            self.at += 1;
        }
        let begin = self.at;
        let c = *text.get(begin)?;
        let token = |kind, end, depth, slot| JsonToken { kind, begin, end, depth, slot };
        let depth = self.stack.len();
        match c {
            b'{' | b'[' => {
                self.at += 1;
                let (kind, frame) = if c == b'{' {
                    (JsonTokenKind::ObjectBegin, Frame::Object { key: None, state: ObjectState::ExpectKey })
                } else {
                    (JsonTokenKind::ArrayBegin, Frame::Array { expects_value: true })
                };
                self.stack.push(frame);
                Some(token(kind, self.at, depth, None))
            }
            b'}' | b']' => {
                self.at += 1;
                self.stack.pop();
                self.value_done();
                let kind = if c == b'}' { JsonTokenKind::ObjectEnd } else { JsonTokenKind::ArrayEnd };
                Some(token(kind, self.at, self.stack.len(), None))
            }
            b',' => {
                self.at += 1;
                match self.stack.last_mut() {
                    Some(Frame::Object { key, state }) => {
                        *key = None;
                        *state = ObjectState::ExpectKey;
                    }
                    Some(Frame::Array { expects_value }) => *expects_value = true,
                    None => {}
                }
                Some(token(JsonTokenKind::Comma, self.at, depth, None))
            }
            b':' => {
                self.at += 1;
                if let Some(Frame::Object { state, .. }) = self.stack.last_mut() {
                    *state = ObjectState::ExpectValue;
                }
                Some(token(JsonTokenKind::Colon, self.at, depth, None))
            }
            b'"' => {
                // JSON strings contain no line breaks, an unclosed string ends with its line
                let mut i = begin + 1;
                let mut closed = false;
                while i < text.len() && text[i] != b'\n' {
                    match text[i] {
                        b'"' => {
                            closed = true;
                            i += 1;
                            break;
                        }
                        b'\\' if text.get(i + 1).is_some_and(|&c| c != b'\n') => i += 2,
                        _ => i += 1,
                    }
                }
                self.at = i;
                let string = token(JsonTokenKind::String { closed }, i, depth, self.slot());
                self.scalar_done(&string);
                Some(string)
            }
            _ => {
                let mut i = begin;
                while i < text.len() && !DELIMITERS.contains(&text[i]) {
                    i += 1;
                }
                self.at = i;
                let word = &text[begin..i];
                let kind = if matches!(word, b"true" | b"false" | b"null") {
                    JsonTokenKind::Literal
                } else if (c == b'-' || c.is_ascii_digit())
                    && word.iter().all(|&c| c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'))
                {
                    JsonTokenKind::Number
                } else {
                    JsonTokenKind::Word
                };
                let scalar = token(kind, i, depth, self.slot());
                self.scalar_done(&scalar);
                Some(scalar)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(json: &str) -> Vec<(&str, JsonTokenKind, usize, Option<JsonSlot>)> {
        JsonScanner::new(json.as_bytes()).map(|t| (&json[t.begin..t.end], t.kind, t.depth, t.slot)).collect()
    }

    #[test]
    fn scans_tokens_with_their_slots() {
        use JsonSlot::*;
        use JsonTokenKind::*;
        let value = |key: &str| Some(Value(key.to_string()));
        assert_eq!(
            tokens("{\"mark\": \"bar\", \"x\": [1.5, true], \"y\": null}"),
            vec![
                ("{", ObjectBegin, 0, None),
                ("\"mark\"", String { closed: true }, 1, Some(Key)),
                (":", Colon, 1, None),
                ("\"bar\"", String { closed: true }, 1, value("mark")),
                (",", Comma, 1, None),
                ("\"x\"", String { closed: true }, 1, Some(Key)),
                (":", Colon, 1, None),
                ("[", ArrayBegin, 1, None),
                ("1.5", Number, 2, Some(Element)),
                (",", Comma, 2, None),
                ("true", Literal, 2, Some(Element)),
                ("]", ArrayEnd, 1, None),
                (",", Comma, 1, None),
                ("\"y\"", String { closed: true }, 1, Some(Key)),
                (":", Colon, 1, None),
                ("null", Literal, 1, value("y")),
                ("}", ObjectEnd, 0, None),
            ]
        );
    }

    #[test]
    fn scans_malformed_json() {
        use JsonSlot::*;
        use JsonTokenKind::*;
        // An unclosed string ends with its line, an escaped quote does not close a string. Without a
        // comma, the next value still belongs to the key before.
        assert_eq!(
            tokens("{\"a\": \"b\n\"c\\\"\": 12px"),
            vec![
                ("{", ObjectBegin, 0, None),
                ("\"a\"", String { closed: true }, 1, Some(Key)),
                (":", Colon, 1, None),
                ("\"b", String { closed: false }, 1, Some(Value("a".into()))),
                ("\"c\\\"\"", String { closed: true }, 1, None),
                (":", Colon, 1, None),
                ("12px", Word, 1, Some(Value("a".into()))),
            ]
        );
        // Unbalanced brackets
        assert_eq!(tokens("}]"), vec![("}", ObjectEnd, 0, None), ("]", ArrayEnd, 0, None)]);
    }

    #[test]
    fn tracks_the_path() {
        let mut scanner = JsonScanner::new(b"{\"layer\": [{\"encoding\": {\"x\": {");
        scanner.by_ref().for_each(drop);
        let key = |k: &str| PathItem::Key(k.to_string());
        assert_eq!(scanner.path(), vec![key("layer"), PathItem::Index, key("encoding"), key("x")]);
        assert_eq!(scanner.slot(), Some(JsonSlot::Key));
    }

    #[test]
    fn maps_the_tag_text_to_the_script() {
        let script = "-- @vis vegalite {\n--   \"mark\": 1\n-- }";
        let line = |text: &str| TextSpan::new(script.find(text).unwrap() as u32, text.len() as u32);
        let tag = TagText::new(script, &[line("vegalite {"), line("\"mark\": 1"), line("}")], TextSpan::new(0, 0));
        assert_eq!(tag.text, "vegalite {\n\"mark\": 1\n}");
        let span = |begin: usize, end: usize| {
            let span = tag.span(begin, end);
            &script[span.offset as usize..span.end() as usize]
        };
        assert_eq!(span(11, 17), "\"mark\"");
        assert_eq!(span(9, tag.text.len()), "{\n--   \"mark\": 1\n-- }");
        assert_eq!(tag.to_joined(script.find("\"mark\"").unwrap()), 11);
        assert_eq!(tag.to_joined(script.find("--   ").unwrap()), 11);
    }
}
