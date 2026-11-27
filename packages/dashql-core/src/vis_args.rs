//! The `key=value` args of comment tags: `@board`, `@flow` and `@vis kpi`, like the `@vis board` and `@vis flow` of
//! older scripts.
//!
//! The args are read with the SQL scanner of DashQL, so their values are written like in SQL: a name (`revenue`), a
//! quoted name (`"Total revenue"`), a string (`'Monthly revenue'`) or a number with an optional sign (`-120`, `1.5`).
//! Unquoted names fold to lowercase, quoted names keep their case. A key is a word, the args are separated by
//! whitespace, and whitespace around `=` is allowed. The analyzer, the highlighting, the completion, the formatter and
//! the rewrites all read args with [`scan_args`], so they agree on where an arg begins and ends.

use crate::utils::unquote_string_literal;
use dashql_parser::scanner::{scan, ScannedScript, Symbol, SymbolValue};
use dashql_parser::symbol_kind::*;
use std::ops::Range;

/// The value of an arg
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ArgValue {
    /// A name, an unquoted one folded to lowercase
    Name(String),
    /// A string literal, without its quotes
    String(String),
    /// A number literal with its sign, as written
    Number(String),
    /// Nothing follows the `=`
    Missing,
    /// A value that the scanner rejected, e.g. a quoted name without its closing quote, it has a problem of its own with
    /// the range of the value
    Invalid,
}

/// An arg of a tag, the ranges are byte ranges of the scanned text
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Arg {
    /// The key, folded to lowercase
    pub key: String,
    pub key_range: Range<usize>,
    pub value: ArgValue,
    /// The value as written, empty after the `=` if the value is missing
    pub value_range: Range<usize>,
}

impl Arg {
    /// The range of the whole arg, from its key to its value
    pub fn range(&self) -> Range<usize> {
        self.key_range.start..self.value_range.end.max(self.key_range.end)
    }
}

/// The args of a text and its problems, each a range of the text with a message
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Args {
    pub args: Vec<Arg>,
    pub problems: Vec<(Range<usize>, String)>,
}

fn range(symbol: &Symbol) -> Range<usize> {
    symbol.location.offset as usize..symbol.location.end() as usize
}

/// The symbols of scanned args. A quoted value without its closing quote runs to the end as a problem of the
/// scanner, it is no value.
fn arg_symbols(scanned: &ScannedScript) -> Vec<&Symbol> {
    let rejected = |s: &Symbol| scanned.errors.iter().any(|e| e.location == s.location);
    scanned.symbols.iter().filter(|s| s.kind != S_YYEOF && !rejected(s)).collect()
}

/// Scan the args of a text. `kind` names the tag in the problems, e.g. `board` or `vis kpi`.
pub(crate) fn scan_args(text: &str, kind: &str) -> Args {
    let scanned = scan(text, 0, 0);
    let symbols = arg_symbols(&scanned);
    let symbol_at = |i: usize| symbols.get(i).copied();
    let written = |range: Range<usize>| text.get(range).unwrap_or_default();
    let mut out = Args::default();
    // A word is a name or a keyword, keywords are read as names here
    let word = |symbol: &Symbol| match symbol.value {
        SymbolValue::Name(id) => Some(scanned.names.get(id).text.clone()),
        SymbolValue::Text(text) => Some(text.to_string()),
        SymbolValue::None => None,
    };
    let is_number = |symbol: &Symbol| symbol.kind == S_ICONST || symbol.kind == S_FCONST;
    // A value that the scanner rejected starts after the `=`, its range is the one of the problem
    let rejected_at = |at: usize| {
        scanned
            .errors
            .iter()
            .map(|e| e.location.offset as usize..e.location.end() as usize)
            .find(|error| error.start >= at && text.get(at..error.start).is_some_and(|gap| gap.trim().is_empty()))
    };
    let mut i = 0;
    while let Some(symbol) = symbol_at(i) {
        let equals = symbol_at(i + 1).filter(|next| next.kind == S_EQUALS);
        let (Some(key), Some(equals)) = (word(symbol), equals) else {
            // Text that is no arg, up to the next whitespace
            let mut last = symbol;
            i += 1;
            while let Some(next) = symbol_at(i).filter(|next| next.location.offset == last.location.end()) {
                last = next;
                i += 1;
            }
            let span = range(symbol).start..range(last).end;
            let message = format!("@{kind} takes key=value args, not \"{}\"", written(span.clone()));
            out.problems.push((span, message));
            continue;
        };
        let after_equals = range(equals).end;
        i += 2;
        let (value, value_range) = match symbol_at(i) {
            // A word that a `=` follows is the next key
            Some(v)
                if (v.kind == S_IDENT || matches!(v.value, SymbolValue::Text(_)))
                    && symbol_at(i + 1).is_none_or(|next| next.kind != S_EQUALS) =>
            {
                i += 1;
                (ArgValue::Name(word(v).unwrap_or_default()), range(v))
            }
            Some(v) if v.kind == S_SCONST => {
                i += 1;
                match unquote_string_literal(written(range(v))) {
                    Some(string) => (ArgValue::String(string), range(v)),
                    None => {
                        let message = format!("@{kind} takes strings in single quotes, not {}", written(range(v)));
                        out.problems.push((range(v), message));
                        (ArgValue::Invalid, range(v))
                    }
                }
            }
            Some(v) if is_number(v) => {
                i += 1;
                (ArgValue::Number(written(range(v)).to_string()), range(v))
            }
            // A sign right before a number
            Some(v)
                if (v.kind == S_MINUS || v.kind == S_PLUS)
                    && symbol_at(i + 1).is_some_and(|n| is_number(n) && n.location.offset == v.location.end()) =>
            {
                let number = range(v).start..symbol_at(i + 1).map_or(range(v).end, |n| range(n).end);
                i += 2;
                (ArgValue::Number(written(number.clone()).to_string()), number)
            }
            _ => match rejected_at(after_equals) {
                Some(rejected) => (ArgValue::Invalid, rejected),
                None => (ArgValue::Missing, after_equals..after_equals),
            },
        };
        out.args.push(Arg { key, key_range: range(symbol), value, value_range });
    }
    for error in &scanned.errors {
        let begin = error.location.offset as usize;
        out.problems.push((begin..error.location.end() as usize, format!("@{kind} has an {}", error.message)));
    }
    out.problems.sort_by_key(|(range, _)| range.start);
    out
}

/// The args of a text as written, each `key=value` without whitespace around the `=` and separated by single spaces.
/// The problems of the args if they have some (see `scan_args`), they then stay as written.
pub(crate) fn normalize_args(text: &str, kind: &str) -> Result<String, Vec<(Range<usize>, String)>> {
    let scanned = scan_args(text, kind);
    if !scanned.problems.is_empty() {
        return Err(scanned.problems);
    }
    let written = |range: Range<usize>| text.get(range).unwrap_or_default();
    Ok(scanned
        .args
        .iter()
        .map(|arg| format!("{}={}", written(arg.key_range.clone()), written(arg.value_range.clone())))
        .collect::<Vec<_>>()
        .join(" "))
}

/// Where the cursor is in the args of a text, for the completion
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ArgCursor {
    /// At a key: the range of the key at the cursor, empty in whitespace, and whether a `=` follows it
    Key { range: Range<usize>, has_equals: bool },
    /// At the value of a key: the range of the value at the cursor, empty right after the `=`
    Value { key: String, range: Range<usize> },
}

/// Find the arg at a cursor of a text: the key or the value of an arg whose range holds the cursor, also at its end,
/// the value of a key in the whitespace after its `=`, and text that is no arg as a key
pub(crate) fn arg_at(text: &str, at: usize) -> ArgCursor {
    let Args { args, problems } = scan_args(text, "");
    let holds = |range: &Range<usize>| range.start <= at && at <= range.end;
    for arg in &args {
        if holds(&arg.key_range) {
            return ArgCursor::Key { range: arg.key_range.clone(), has_equals: true };
        }
        if arg.key_range.end < at && at <= arg.value_range.end {
            let range = if at < arg.value_range.start { at..at } else { arg.value_range.clone() };
            return ArgCursor::Value { key: arg.key.clone(), range };
        }
    }
    if let Some((range, _)) = problems.into_iter().find(|(range, _)| holds(range)) {
        return ArgCursor::Key { range, has_equals: false };
    }
    // In the whitespace after a `=` that no value follows
    match args.into_iter().rev().find(|arg| arg.value_range.end <= at) {
        Some(arg) if arg.value == ArgValue::Missing => ArgCursor::Value { key: arg.key, range: at..at },
        _ => ArgCursor::Key { range: at..at, has_equals: false },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(text: &str) -> Vec<(String, ArgValue, &str)> {
        let args = scan_args(text, "board");
        assert_eq!(args.problems, vec![], "{text}");
        args.args.iter().map(|a| (a.key.clone(), a.value.clone(), &text[a.range()])).collect()
    }

    fn problems(text: &str) -> Vec<(&str, String)> {
        scan_args(text, "vis kpi").problems.into_iter().map(|(r, m)| (&text[r], m)).collect()
    }

    #[test]
    fn reads_names_strings_and_numbers() {
        let name = |s: &str| ArgValue::Name(s.to_string());
        let number = |s: &str| ArgValue::Number(s.to_string());
        assert_eq!(
            values(r#"value=Revenue x="Order Day"  label='it''s' row=-1 width=+2 scale=1.5"#),
            vec![
                ("value".to_string(), name("revenue"), "value=Revenue"),
                ("x".to_string(), name("Order Day"), r#"x="Order Day""#),
                ("label".to_string(), ArgValue::String("it's".into()), "label='it''s'"),
                ("row".to_string(), number("-1"), "row=-1"),
                ("width".to_string(), number("+2"), "width=+2"),
                ("scale".to_string(), number("1.5"), "scale=1.5"),
            ]
        );
        // Keywords are names, keys fold to lowercase, whitespace around = is allowed
        assert_eq!(
            values("ROW = 1 delta=first"),
            vec![("row".to_string(), number("1"), "ROW = 1"), ("delta".to_string(), name("first"), "delta=first")]
        );
        assert_eq!(values(""), vec![]);
    }

    #[test]
    fn names_what_is_no_arg() {
        assert_eq!(
            problems("width:3 row=1"),
            vec![("width:3", "@vis kpi takes key=value args, not \"width:3\"".into())]
        );
        assert_eq!(
            problems("value=Total revenue"),
            vec![("revenue", "@vis kpi takes key=value args, not \"revenue\"".into())]
        );
        assert_eq!(
            problems(r#"value="Total"#),
            vec![(r#""Total"#, "@vis kpi has an unterminated delimited identifier".into())]
        );
        assert_eq!(scan_args(r#"value="Total"#, "vis kpi").args[0].value, ArgValue::Invalid);
        assert_eq!(scan_args("value=", "vis kpi").args[0].value, ArgValue::Missing);
        assert_eq!(scan_args("value= x=day", "vis kpi").args[0].value, ArgValue::Missing);
    }

    #[test]
    fn normalizes_whitespace_but_keeps_what_is_written() {
        assert_eq!(
            normalize_args(r#"  value = "Total  Revenue"   x=Day "#, "").as_deref(),
            Ok(r#"value="Total  Revenue" x=Day"#)
        );
        assert!(normalize_args("width:3", "").is_err());
    }

    #[test]
    fn finds_the_arg_at_the_cursor() {
        let key = |range: Range<usize>, has_equals| ArgCursor::Key { range, has_equals };
        let value = |key: &str, range: Range<usize>| ArgCursor::Value { key: key.to_string(), range };
        assert_eq!(arg_at("", 0), key(0..0, false));
        assert_eq!(arg_at("val", 3), key(0..3, false));
        assert_eq!(arg_at("val=x", 2), key(0..3, true));
        assert_eq!(arg_at("value=", 6), value("value", 6..6));
        assert_eq!(arg_at("value = ", 8), value("value", 8..8));
        assert_eq!(arg_at("value=re", 8), value("value", 6..8));
        assert_eq!(arg_at("value = re", 10), value("value", 8..10));
        assert_eq!(arg_at(r#"value="To"#, 9), value("value", 6..9));
        assert_eq!(arg_at("value=re x", 10), key(9..10, false));
        assert_eq!(arg_at("value=re ", 9), key(9..9, false));
        assert_eq!(arg_at("row=-1", 6), value("row", 4..6));
    }
}
