//! Completion inside comments: the names of comment tags and the content of `@vis` tags.
//!
//! - `@` at the start of a comment line completes the tag names.
//! - `@vis ` completes the kinds, `@vis card ` its args.
//! - In the JSON of `@vis vegalite`, a tolerant scanner finds the key path at the cursor and whether a
//!   key or a value follows, also in JSON that is not complete yet. Keys come from a table per path,
//!   values from the Vega-Lite enums and, for `field`, from the output columns of the query.
//! - In the template of `@vis markdown`, `{{` completes the output columns.
//!
//! Candidates replace the token at the cursor, JSON keys and values are inserted as JSON strings.

use crate::analyzer::statement_output_columns;
use crate::completion::{Candidate, CandidateTags, Completion, Score};
use crate::vis_text::{JsonScanner, JsonSlot, JsonTokenKind, PathItem, TagText};
use dashql_buffers::completion::CandidateTag;
use dashql_buffers::parser::{CommentBlockType, SymbolSpan};
use dashql_parser::comment_blocks::{CommentBlock, COMMENT_TAGS, COMMENT_TAG_END};
use dashql_parser::parser::ParsedScript;
use dashql_parser::span::TextSpan;
use std::sync::Arc;

/// The tag of visualizations
const VIS_TAG: &[u8] = b"vis";
/// The kinds of `@vis` tags
const VIS_KINDS: &[&str] = &["vegalite", "markdown", "table", "card"];
/// The args of `@vis card`
const CARD_ARGS: &[&str] = &["row", "column", "width", "height"];

/// The top-level properties of a Vega-Lite spec
const SPEC_KEYS: &[&str] = &[
    "mark", "encoding", "title", "description", "transform", "layer", "width", "height", "params", "resolve",
    "projection", "facet", "spec", "repeat", "hconcat", "vconcat", "concat", "autosize", "padding",
    "background", "view", "config", "name",
];
/// The mark types
const MARK_TYPES: &[&str] = &[
    "bar", "line", "point", "area", "arc", "rect", "rule", "text", "tick", "circle", "square", "trail",
    "boxplot", "errorband", "errorbar", "geoshape", "image",
];
/// The properties of a mark definition
const MARK_KEYS: &[&str] = &[
    "type", "color", "fill", "stroke", "opacity", "fillOpacity", "strokeOpacity", "strokeWidth", "strokeDash",
    "size", "shape", "angle", "point", "line", "filled", "tooltip", "interpolate", "tension", "orient",
    "thickness", "cornerRadius", "radius", "innerRadius", "outerRadius", "align", "baseline", "dx", "dy",
    "fontSize", "fontWeight", "text", "clip",
];
/// The encoding channels
const CHANNELS: &[&str] = &[
    "x", "y", "color", "size", "shape", "opacity", "tooltip", "text", "theta", "radius", "x2", "y2", "xOffset",
    "yOffset", "fill", "stroke", "fillOpacity", "strokeOpacity", "strokeWidth", "strokeDash", "angle", "theta2",
    "radius2", "latitude", "longitude", "latitude2", "longitude2", "row", "column", "facet", "detail", "key",
    "order", "href", "url", "description",
];
/// The properties of a field definition
const FIELD_DEF_KEYS: &[&str] = &[
    "field", "type", "aggregate", "timeUnit", "bin", "title", "sort", "stack", "scale", "axis", "legend",
    "format", "formatType", "value", "datum", "condition", "impute", "bandPosition",
];
/// The field types
const FIELD_TYPES: &[&str] = &["quantitative", "temporal", "ordinal", "nominal", "geojson"];
/// The aggregate operations
const AGGREGATES: &[&str] = &[
    "count", "sum", "mean", "average", "median", "min", "max", "distinct", "valid", "missing", "values",
    "product", "variance", "variancep", "stdev", "stdevp", "stderr", "q1", "q3", "ci0", "ci1", "argmin",
    "argmax",
];
/// The time units
const TIME_UNITS: &[&str] = &[
    "year", "quarter", "month", "week", "day", "date", "hours", "minutes", "seconds", "milliseconds",
    "dayofyear", "yearquarter", "yearmonth", "yearmonthdate", "yearmonthdatehours", "monthdate",
    "hoursminutes", "hoursminutesseconds", "minutesseconds",
];
/// The properties of a scale
const SCALE_KEYS: &[&str] = &[
    "type", "domain", "domainMin", "domainMax", "domainMid", "range", "rangeMin", "rangeMax", "scheme", "zero",
    "nice", "clamp", "reverse", "round", "padding", "paddingInner", "paddingOuter", "interpolate", "exponent",
    "base", "constant", "bins", "align",
];
/// The scale types
const SCALE_TYPES: &[&str] = &[
    "linear", "log", "pow", "sqrt", "symlog", "time", "utc", "ordinal", "band", "point", "sequential",
    "quantile", "quantize", "threshold", "bin-ordinal", "identity",
];
/// The properties of an axis
const AXIS_KEYS: &[&str] = &[
    "title", "orient", "format", "formatType", "grid", "ticks", "tickCount", "tickSize", "labels",
    "labelAngle", "labelFontSize", "labelOverlap", "labelLimit", "domain", "direction", "offset", "values",
    "titleFontSize", "zindex",
];
/// The properties of a legend
const LEGEND_KEYS: &[&str] = &[
    "title", "orient", "format", "formatType", "direction", "columns", "symbolType", "labelLimit", "padding",
    "offset", "values", "type", "zindex",
];

fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

/// The candidates of a completion in a comment
struct Candidates {
    /// The text range that a candidate replaces
    target: TextSpan,
    /// The typed prefix that filters the candidates
    prefix: String,
    /// The candidates with their scores, in the order they were added
    out: Vec<Candidate>,
}

impl Candidates {
    fn new(target: TextSpan, prefix: &[u8]) -> Self {
        Self {
            target,
            prefix: String::from_utf8_lossy(prefix).to_ascii_lowercase(),
            out: Vec::new(),
        }
    }

    /// Add a candidate if it matches the prefix, `insert` is the text that replaces the target
    fn add(&mut self, name: &str, insert: String) {
        let lower = name.to_ascii_lowercase();
        let tags: CandidateTags = if self.prefix.is_empty() || lower.starts_with(&self.prefix) {
            CandidateTag::PREFIX_MATCH.0
        } else if lower.contains(&self.prefix) {
            CandidateTag::SUBSTRING_MATCH.0
        } else {
            return;
        };
        if self.out.iter().any(|c| &*c.completion_text == insert.as_str()) {
            return;
        }
        let location = SymbolSpan::new(self.target.offset, self.target.length);
        let mut candidate = Candidate::new(Arc::from(insert), 0, tags, location, location);
        candidate.completion_text_is_verbatim = true;
        self.out.push(candidate);
    }

    fn add_all(&mut self, names: &[&str], quote: bool) {
        for name in names {
            self.add(name, if quote { json_string(name) } else { name.to_string() });
        }
    }

    /// The top k candidates: prefix matches before substring matches, otherwise in the order they were added
    fn finish(mut self, k: usize) -> Vec<Candidate> {
        let count = self.out.len() as Score;
        for (i, candidate) in self.out.iter_mut().enumerate() {
            let prefix = candidate.candidate_tags & CandidateTag::PREFIX_MATCH.0 != 0;
            candidate.score = (count - i as Score) + if prefix { count } else { 0 };
        }
        self.out.sort_by(|l, r| r.score.cmp(&l.score));
        self.out.truncate(k);
        self.out
    }
}

fn json_string(text: &str) -> String {
    serde_json::to_string(text).expect("a string always serializes")
}

/// The comment that contains a text offset
fn comment_at(comments: &[TextSpan], offset: usize) -> Option<TextSpan> {
    let i = comments.partition_point(|c| c.offset as usize <= offset);
    let comment = *comments.get(i.checked_sub(1)?)?;
    (offset > comment.offset as usize && offset <= comment.end() as usize).then_some(comment)
}

/// Complete the name of a tag when the cursor is in `@name` at the start of a comment line
fn complete_tag_name(text: &[u8], comments: &[TextSpan], offset: usize, k: usize) -> Option<Vec<Candidate>> {
    let comment = comment_at(comments, offset)?;
    let comment_begin = comment.offset as usize;
    let line_begin = text[..offset].iter().rposition(|&c| c == b'\n').map_or(0, |n| n + 1).max(comment_begin);
    let mut i = line_begin;
    let is_line_comment = text[comment_begin..].starts_with(b"--");
    // Skip the comment marker, or the gutter of a block comment line
    if line_begin == comment_begin {
        let marker = if is_line_comment { b'-' } else { b'*' };
        i += 2;
        while i < offset && text[i] == marker {
            i += 1;
        }
    }
    while i < offset && text[i].is_ascii_whitespace() {
        i += 1;
    }
    if line_begin != comment_begin && i < offset && text[i] == b'*' {
        i += 1;
        while i < offset && text[i].is_ascii_whitespace() {
            i += 1;
        }
    }
    if i >= offset || text[i] != b'@' || !text[i + 1..offset].iter().all(|&c| is_word_byte(c)) {
        return None;
    }
    let name_begin = i + 1;
    let mut name_end = offset;
    while name_end < comment.end() as usize && is_word_byte(text[name_end]) {
        name_end += 1;
    }
    let target = TextSpan::new(name_begin as u32, (name_end - name_begin) as u32);
    let mut candidates = Candidates::new(target, &text[name_begin..offset]);
    for &tag in COMMENT_TAGS {
        // Only regions of line comments are closed
        if tag != COMMENT_TAG_END || is_line_comment {
            candidates.add(tag, tag.to_string());
        }
    }
    Some(candidates.finish(k))
}

/// The JSON context at the end of a text
#[derive(Debug, PartialEq, Eq)]
struct JsonContext {
    path: Vec<PathItem>,
    slot: JsonSlot,
    /// The token at the cursor: its begin and whether it is a string
    token: Option<(usize, bool)>,
}

/// Scan JSON up to the cursor, which is the end of `json`. The JSON does not need to be complete.
fn scan_json(json: &[u8]) -> Option<JsonContext> {
    let mut scanner = JsonScanner::new(json);
    while let Some(token) = scanner.next() {
        // A scalar that ends at the cursor is still typed, unless it is a closed string
        let typed = matches!(
            token.kind,
            JsonTokenKind::String { closed: false } | JsonTokenKind::Number | JsonTokenKind::Literal | JsonTokenKind::Word
        );
        if typed && token.end == json.len() {
            let string = matches!(token.kind, JsonTokenKind::String { .. });
            return Some(JsonContext {
                path: scanner.path(),
                slot: token.slot?,
                token: Some((token.begin, string)),
            });
        }
    }
    Some(JsonContext {
        path: scanner.path(),
        slot: scanner.slot()?,
        token: None,
    })
}

/// The candidates of a JSON context in a Vega-Lite spec
fn add_json_candidates(candidates: &mut Candidates, context: &JsonContext, columns: &[Arc<str>]) {
    let key = |item: &PathItem, name: &str| matches!(item, PathItem::Key(k) if k == name);
    // Nested specs are specs
    let mut path = &context.path[..];
    loop {
        match path {
            [PathItem::Key(k), PathItem::Index, rest @ ..] if matches!(k.as_str(), "layer" | "hconcat" | "vconcat" | "concat") => {
                path = rest
            }
            [PathItem::Key(k), rest @ ..] if k == "spec" => path = rest,
            _ => break,
        }
    }
    let add_columns = |candidates: &mut Candidates| {
        for column in columns {
            candidates.add(column, json_string(column));
        }
    };
    match (&context.slot, path) {
        (JsonSlot::Value(k), _) if k == "field" => add_columns(candidates),
        (JsonSlot::Element, [.., g, PathItem::Index]) if key(g, "groupby") => add_columns(candidates),
        (JsonSlot::Key, []) => candidates.add_all(SPEC_KEYS, true),
        (JsonSlot::Value(k), []) if k == "mark" => candidates.add_all(MARK_TYPES, true),
        (JsonSlot::Key, [m]) if key(m, "mark") => candidates.add_all(MARK_KEYS, true),
        (JsonSlot::Value(k), [m]) if key(m, "mark") && k == "type" => candidates.add_all(MARK_TYPES, true),
        (JsonSlot::Key, [e]) if key(e, "encoding") => candidates.add_all(CHANNELS, true),
        (slot, [e, PathItem::Key(_), rest @ ..]) if key(e, "encoding") => {
            // A channel holds a field definition, or an array of them (e.g. tooltip)
            let rest = match rest {
                [PathItem::Index, rest @ ..] => rest,
                rest => rest,
            };
            match (slot, rest) {
                (JsonSlot::Key, []) => candidates.add_all(FIELD_DEF_KEYS, true),
                (JsonSlot::Value(k), []) => match k.as_str() {
                    "type" => candidates.add_all(FIELD_TYPES, true),
                    "aggregate" => candidates.add_all(AGGREGATES, true),
                    "timeUnit" => candidates.add_all(TIME_UNITS, true),
                    _ => {}
                },
                (JsonSlot::Key, [s]) if key(s, "scale") => candidates.add_all(SCALE_KEYS, true),
                (JsonSlot::Value(k), [s]) if key(s, "scale") && k == "type" => candidates.add_all(SCALE_TYPES, true),
                (JsonSlot::Key, [a]) if key(a, "axis") => candidates.add_all(AXIS_KEYS, true),
                (JsonSlot::Key, [l]) if key(l, "legend") => candidates.add_all(LEGEND_KEYS, true),
                _ => {}
            }
        }
        _ => {}
    }
}

/// The statement whose description holds a comment block
fn statement_of_block(parsed: &ParsedScript, block: usize) -> Option<usize> {
    parsed.associate_descriptions().iter().position(|d| {
        let begin = d.description_blocks_begin as usize;
        (begin..begin + d.description_blocks_count as usize).contains(&block)
    })
}

/// Complete the content of a `@vis` tag
fn complete_vis_tag(completion: &Completion, parsed: &ParsedScript, offset: usize, k: usize) -> Option<Vec<Candidate>> {
    let script = parsed.scanned.text.as_bytes();
    let blocks = &parsed.comment_blocks;
    let (block_id, block): (usize, &CommentBlock) = blocks.blocks.iter().enumerate().find(|(_, b)| {
        b.block_type == CommentBlockType::DASHQL_TAG
            && &script[b.tag_span.offset as usize..b.tag_span.end() as usize] == VIS_TAG
            && b.tag_span.end() as usize <= offset
            && offset <= b.text_span.end() as usize
    })?;
    let lines = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
    let columns = || {
        let statement = statement_of_block(parsed, block_id)?;
        Some(statement_output_columns(completion.cursor.script.analyzed?, statement))
    };
    let tag = TagText::new(&parsed.scanned.text, lines, block.text_span);
    // Without content, the cursor is right after the tag
    let at = if lines.is_empty() || offset < lines[0].offset as usize { 0 } else { tag.to_joined(offset) };
    let text = tag.text.as_bytes();
    let span = |begin: usize, end: usize| if tag.is_empty() { TextSpan::new(offset as u32, 0) } else { tag.span(begin, end) };
    let kind_end = text.iter().position(|c| c.is_ascii_whitespace()).unwrap_or(text.len());
    if at <= kind_end {
        let mut candidates = Candidates::new(span(0, kind_end), &text[..at]);
        candidates.add_all(VIS_KINDS, false);
        return Some(candidates.finish(k));
    }
    match &text[..kind_end] {
        b"card" => {
            let first_line_end = text.iter().position(|&c| c == b'\n').unwrap_or(text.len());
            if at > first_line_end {
                return None;
            }
            let arg_begin = text[..at].iter().rposition(|c| c.is_ascii_whitespace()).map_or(0, |n| n + 1);
            if text[arg_begin..at].contains(&b'=') {
                return None;
            }
            let mut arg_end = at;
            while arg_end < first_line_end && !text[arg_end].is_ascii_whitespace() && text[arg_end] != b'=' {
                arg_end += 1;
            }
            let has_equals = text.get(arg_end) == Some(&b'=');
            let used: Vec<&[u8]> = text[kind_end..first_line_end]
                .split(|c| c.is_ascii_whitespace())
                .filter_map(|arg| arg.iter().position(|&c| c == b'=').map(|eq| &arg[..eq]))
                .collect();
            let mut candidates = Candidates::new(span(arg_begin, arg_end), &text[arg_begin..at]);
            for &arg in CARD_ARGS {
                if !used.contains(&arg.as_bytes()) || text[arg_begin..arg_end].starts_with(arg.as_bytes()) {
                    candidates.add(arg, if has_equals { arg.to_string() } else { format!("{arg}=") });
                }
            }
            Some(candidates.finish(k))
        }
        b"vegalite" => {
            let context = scan_json(&text[kind_end..at])?;
            let (begin, end) = match context.token {
                Some((begin, true)) => {
                    // The string token ends after its word, with the closing quote if one follows
                    let begin = kind_end + begin;
                    let mut end = at;
                    while end < text.len() && (is_word_byte(text[end]) || text[end] == b'$') {
                        end += 1;
                    }
                    if text.get(end) == Some(&b'"') {
                        end += 1;
                    }
                    (begin, end)
                }
                Some((begin, false)) => {
                    let begin = kind_end + begin;
                    let mut end = at;
                    while end < text.len() && !b"{}[],:\" \t\r\n".contains(&text[end]) {
                        end += 1;
                    }
                    (begin, end)
                }
                None => (at, at),
            };
            let prefix_begin = if context.token.is_some_and(|(_, string)| string) { begin + 1 } else { begin };
            let mut candidates = Candidates::new(span(begin, end), &text[prefix_begin..at]);
            add_json_candidates(&mut candidates, &context, &columns().unwrap_or_default());
            Some(candidates.finish(k))
        }
        b"markdown" => {
            let open = text[..at].windows(2).rposition(|w| w == b"{{")? + 2;
            let name = &text[open..at];
            if !name.iter().all(|&c| is_word_byte(c) || c == b' ') {
                return None;
            }
            let begin = open + name.iter().take_while(|&&c| c == b' ').count();
            let mut end = at;
            while end < text.len() && is_word_byte(text[end]) {
                end += 1;
            }
            let mut candidates = Candidates::new(span(begin, end), &text[begin..at]);
            for column in columns().unwrap_or_default() {
                candidates.add(&column, column.to_string());
            }
            Some(candidates.finish(k))
        }
        _ => None,
    }
}

/// Complete at a cursor inside a comment. Without candidates, the completion stays empty.
pub(crate) fn complete_in_comment(completion: &mut Completion, k: usize) {
    let cursor = completion.cursor;
    let Some(scanned) = cursor.script.scanned else { return };
    let text = scanned.text.as_bytes();
    let offset = cursor.text_offset.min(text.len());
    let candidates = complete_tag_name(text, &scanned.comments, offset, k)
        .or_else(|| complete_vis_tag(completion, cursor.script.parsed?, offset, k));
    if let Some(candidates) = candidates {
        completion.top_candidates = candidates;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(json: &str) -> Option<JsonContext> {
        scan_json(json.as_bytes())
    }

    fn path(keys: &[&str]) -> Vec<PathItem> {
        keys.iter().map(|k| if *k == "[]" { PathItem::Index } else { PathItem::Key(k.to_string()) }).collect()
    }

    #[test]
    fn scans_incomplete_json() {
        assert_eq!(context(" {").map(|c| c.slot), Some(JsonSlot::Key));
        assert_eq!(context(" {\"ma").unwrap().token, Some((2, true)));
        let c = context("{\"mark\": ").unwrap();
        assert_eq!((c.path, c.slot), (vec![], JsonSlot::Value("mark".into())));
        let c = context("{\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"re").unwrap();
        assert_eq!((c.path, c.slot), (path(&["encoding", "x"]), JsonSlot::Value("field".into())));
        let c = context("{\"layer\": [{\"mark\": \"bar\"}, {\"encoding\": {").unwrap();
        assert_eq!((c.path, c.slot), (path(&["layer", "[]", "encoding"]), JsonSlot::Key));
        let c = context("{\"encoding\": {\"x\": {\"field\": \"a\", ty").unwrap();
        assert_eq!((c.path, c.slot, c.token.map(|t| t.1)), (path(&["encoding", "x"]), JsonSlot::Key, Some(false)));
        // After a complete value or a key, nothing is completed
        assert_eq!(context("{\"mark\": \"bar\""), None);
        assert_eq!(context("{\"mark\" "), None);
        assert_eq!(context(""), None);
    }
}
