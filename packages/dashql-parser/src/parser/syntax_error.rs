//! The message and the hint of a syntax error.
//!
//! The message names the token that does not fit by its kind and text, `unexpected keyword FROM`, `unexpected name
//! "frm"`, `unexpected ","`, `unexpected end of input`, and lists what fits there if that is short, `expected ")" or
//! ","`. Where a name fits, the keywords that the parser takes there only as a name are that name, the list leaves them
//! out. The hint guesses the fix from the tokens around the error: a comma too many, a misspelled keyword, a missing
//! `;`, `)` or `,`, a reserved keyword or a string literal as a name. See "Error messages" in
//! `docs/design/core_parser.md`.

#![allow(non_upper_case_globals)]

use super::driver::{feed, lac_check, StateId};
use super::probe::takes_keyword_only_as_name_at;
use crate::keywords::{Keyword, KeywordCategory, KEYWORDS};
use crate::scanner::Symbol;
use crate::symbol_kind::*;
use crate::tables::YYNTOKENS;
use crate::{symbol_name, SymbolKind};
use std::borrow::Cow;

/// The most tokens that the message lists as expected, a longer list is left out
const MAX_EXPECTED: usize = 5;
/// The most characters of the text of a token in a message
const MAX_TOKEN_TEXT: usize = 32;

/// The token that does not fit
#[derive(Clone, Copy)]
pub struct Unexpected<'a> {
    /// The kind of the token
    pub kind: SymbolKind,
    /// The text of the token, empty at the end of the input
    pub text: &'a str,
    /// The kind and the text of the token before it
    pub previous: Option<(SymbolKind, &'a str)>,
    /// Is the token before it the top of the stack, shifted without a reduction after it?
    pub previous_on_top: bool,
    /// The kind of the token after it, EOF at the end
    pub next: SymbolKind,
    /// Is there a gap between the token before it and the token?
    pub after_gap: bool,
}

impl<'a> Unexpected<'a> {
    /// The token at a symbol index and the token before it
    pub fn at(text: &'a str, symbols: &[Symbol], kind: SymbolKind, index: u32, previous_on_top: bool) -> Self {
        let text_of = |symbol: &Symbol| {
            let begin = symbol.location.offset as usize;
            text.get(begin..begin + symbol.location.length as usize).unwrap_or("")
        };
        let token_text = if kind == S_YYEOF { "" } else { symbols.get(index as usize).map_or("", text_of) };
        let previous =
            index.checked_sub(1).and_then(|i| symbols.get(i as usize)).map(|symbol| (symbol.kind, text_of(symbol)));
        let next = symbols.get(index as usize + 1).filter(|_| kind != S_YYEOF).map_or(S_YYEOF, |symbol| symbol.kind);
        let previous_end = index.checked_sub(1).and_then(|i| symbols.get(i as usize)).map(|s| s.location.end());
        let after_gap = match (previous_end, symbols.get(index as usize)) {
            (Some(end), Some(symbol)) => end < symbol.location.offset,
            _ => true,
        };
        Self { kind, text: token_text, previous, previous_on_top, next, after_gap }
    }
}

/// The keyword of a token, a lookahead token is its keyword
fn keyword_name(kind: SymbolKind) -> Option<&'static str> {
    Keyword::name_of(Keyword::of_lookahead_token(kind).unwrap_or(kind))
}

/// The text of a punctuation or operator token that has a fixed one
fn fixed_text(kind: SymbolKind) -> Option<&'static str> {
    Some(match kind {
        S_LRB => "(",
        S_RRB => ")",
        S_LSB => "[",
        S_RSB => "]",
        S_LCB => "{",
        S_RCB => "}",
        S_STAR => "*",
        S_COMMA => ",",
        S_COLON => ":",
        S_QUESTION_MARK => "?",
        S_DOLLAR => "$",
        S_SEMICOLON => ";",
        S_MINUS => "-",
        S_PLUS => "+",
        S_DIVIDE => "/",
        S_MODULO => "%",
        S_LESS_THAN => "<",
        S_GREATER_THAN => ">",
        S_EQUALS => "=",
        S_CIRCUMFLEX => "^",
        S_AMPERSAND => "&",
        S_PIPE => "|",
        S_EXCLAMATION_MARK => "!",
        S_DOT | S_DOT_TRAILING | S_DOT_STAR_LA => ".",
        S_DOT_DOT => "..",
        S_TYPECAST => "::",
        S_COLON_EQUALS => ":=",
        S_EQUALS_GREATER => "=>",
        S_LESS_EQUALS => "<=",
        S_GREATER_EQUALS => ">=",
        S_NOT_EQUALS => "<>",
        _ => return None,
    })
}

/// The text of a token in a message, shortened, in double quotes unless it is quoted already
fn excerpt(text: &str, quote: bool) -> String {
    let mut out = String::new();
    let mut chars = text.chars();
    out.extend(chars.by_ref().take(MAX_TOKEN_TEXT));
    if chars.next().is_some() {
        out.push_str("...");
    }
    if quote && !out.starts_with(['"', '`']) {
        format!("\"{out}\"")
    } else {
        out
    }
}

/// The token that does not fit, by its kind and text
fn describe_unexpected(kind: SymbolKind, text: &str) -> String {
    match kind {
        S_YYEOF => "end of input".to_string(),
        S_IDENT => format!("name {}", excerpt(text, true)),
        S_SCONST | S_DCONST => format!("string {}", excerpt(text, false)),
        S_ICONST | S_FCONST => format!("number {}", excerpt(text, false)),
        S_BCONST | S_XCONST => format!("bit string {}", excerpt(text, false)),
        S_PARAM => format!("parameter {}", excerpt(text, false)),
        _ => match keyword_name(kind) {
            Some(keyword) => format!("keyword {}", keyword.to_ascii_uppercase()),
            None if text.is_empty() => symbol_name(kind).into_owned(),
            None => excerpt(text, true),
        },
    }
}

/// A token that fits, by its kind
fn describe_expected(kind: SymbolKind) -> Cow<'static, str> {
    let class = match kind {
        S_YYEOF => "end of input",
        S_IDENT => "a name",
        S_SCONST => "a string",
        S_DCONST => "a dollar-quoted string",
        S_ICONST => "an integer",
        S_FCONST => "a number",
        S_BCONST | S_XCONST => "a bit string",
        S_PARAM => "a parameter",
        S_Op | S_QUANTIFIED_OP | S_QUANTIFIED_OPERATOR => "an operator",
        _ => "",
    };
    if !class.is_empty() {
        Cow::Borrowed(class)
    } else if let Some(keyword) = keyword_name(kind) {
        Cow::Owned(keyword.to_ascii_uppercase())
    } else if let Some(text) = fixed_text(kind) {
        Cow::Owned(format!("\"{text}\""))
    } else {
        symbol_name(kind)
    }
}

/// The tokens that fit, as they are listed, None if there are more than `MAX_EXPECTED`
fn expected_list(states: &[StateId], scratch: &mut Vec<StateId>) -> Option<Vec<Cow<'static, str>>> {
    let takes_name = lac_check(states, S_IDENT, scratch);
    let mut list: Vec<Cow<'static, str>> = Vec::new();
    for token in 0..YYNTOKENS as SymbolKind {
        if matches!(token, S_YYerror | S_YYUNDEF | S_COMPLETE_HERE) || !lac_check(states, token, scratch) {
            continue;
        }
        // A keyword that is a name here is listed as the name
        if takes_name && keyword_name(token).is_some() && takes_keyword_only_as_name_at(states, token) {
            continue;
        }
        let text = describe_expected(token);
        if list.contains(&text) {
            continue;
        }
        if list.len() == MAX_EXPECTED {
            return None;
        }
        list.push(text);
    }
    Some(list)
}

/// Are two words at most one edit apart: a substitution, an insertion, a deletion or a transposition?
fn within_one_edit(a: &[u8], b: &[u8]) -> bool {
    if a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let (a, b) = (a.get(prefix..).unwrap_or_default(), b.get(prefix..).unwrap_or_default());
    let (a_rest, b_rest) = (a.get(1..).unwrap_or_default(), b.get(1..).unwrap_or_default());
    if a_rest == b_rest || a_rest == b || a == b_rest {
        return true;
    }
    matches!((a, b), ([x0, x1, a_rest @ ..], [y0, y1, b_rest @ ..]) if x0 == y1 && x1 == y0 && a_rest == b_rest)
}

/// A keyword that a word is one edit away from, that fits after a stack of states if one is given. Short words and
/// words that are keywords themselves are no misspellings.
fn misspelled_keyword(word: &str, states: Option<&[StateId]>, scratch: &mut Vec<StateId>) -> Option<&'static str> {
    let word = word.to_ascii_lowercase();
    if word.len() < 3 || Keyword::find(word.as_bytes()).is_some() {
        return None;
    }
    // A keyword that begins with the word first, the rest of it may be missing: `wher` is WHERE, not WHEN
    KEYWORDS
        .iter()
        .filter(|keyword| keyword.name.len() >= 4 && within_one_edit(word.as_bytes(), keyword.name.as_bytes()))
        .filter(|keyword| match states {
            Some(states) => lac_check(states, keyword.symbol, scratch),
            None => keyword.category == KeywordCategory::SqlReserved,
        })
        .min_by_key(|keyword| !keyword.name.starts_with(word.as_str()))
        .map(|keyword| keyword.name)
}

/// Would a token fit after inserting another one?
fn fits_after(states: &[StateId], inserted: SymbolKind, token: SymbolKind, scratch: &mut Vec<StateId>) -> bool {
    let mut states = states.to_vec();
    feed(&mut states, inserted) && lac_check(&states, token, scratch)
}

/// Where a hint places something relative to the token that does not fit
fn before(kind: SymbolKind, text: &str) -> String {
    if kind == S_YYEOF {
        "at the end".to_string()
    } else {
        format!("before {}", describe_unexpected(kind, text))
    }
}

/// Guess the fix of a syntax error, empty if there is no guess
fn hint(states: &[StateId], unexpected: &Unexpected, scratch: &mut Vec<StateId>) -> String {
    let (kind, text) = (unexpected.kind, unexpected.text);
    // A comma too many, `select a, from t`
    if let (Some((S_COMMA, _)), true) = (unexpected.previous, unexpected.previous_on_top) {
        if let Some(below) = states.get(..states.len().saturating_sub(1)).filter(|s| !s.is_empty()) {
            if lac_check(below, kind, scratch) {
                return format!("remove the \",\" {}", before(kind, text));
            }
        }
    }
    // A misspelled keyword, `select * frm t` or `select * from t wher a = 1`
    if kind == S_IDENT {
        if let Some(keyword) = misspelled_keyword(text, Some(states), scratch) {
            return format!("did you mean {}?", keyword.to_ascii_uppercase());
        }
    }
    if let Some((S_IDENT, previous)) = unexpected.previous {
        if let Some(keyword) = misspelled_keyword(previous, None, scratch) {
            return format!("did you mean {} instead of {}?", keyword.to_ascii_uppercase(), excerpt(previous, true));
        }
    }
    // A string literal where a name fits, `select * from 'foo'`
    if kind == S_SCONST && lac_check(states, S_IDENT, scratch) {
        return "string literals cannot be used as identifiers here; use a double-quoted identifier instead"
            .to_string();
    }
    let previous = unexpected.previous.map(|(previous, _)| previous);
    // A statement that follows without a semicolon, `select * from foo select 1`
    if keyword_name(kind).is_some() && fits_after(states, S_SEMICOLON, kind, scratch) {
        return format!("a \";\" may be missing {}", before(kind, text));
    }
    // A missing closing bracket, `select (a from t`. Right after an opening one, something else is missing.
    if previous != Some(S_LRB) && fits_after(states, S_RRB, kind, scratch) {
        return format!("a \")\" may be missing {}", before(kind, text));
    }
    // A missing comma between two values, `select a b c from t`
    if is_value(kind)
        && unexpected.after_gap
        && previous.is_some_and(|previous| is_value(previous) || previous == S_RRB)
        && fits_after(states, S_COMMA, kind, scratch)
    {
        return format!("a \",\" may be missing {}", before(kind, text));
    }
    // A reserved keyword where a name fits, `select * from order`, if the token after it fits after a name. A name
    // follows a keyword, `(`, `,` or `.`, after an operator the operand is missing.
    let name_position = previous.is_none_or(|p| keyword_name(p).is_some() || matches!(p, S_LRB | S_COMMA | S_DOT));
    if let Some(keyword) = keyword_name(kind).filter(|_| name_position) {
        if lac_check(states, S_IDENT, scratch) && fits_after(states, S_IDENT, unexpected.next, scratch) {
            let upper = keyword.to_ascii_uppercase();
            return format!("{upper} is a reserved keyword, write \"{keyword}\" to use it as a name");
        }
    }
    String::new()
}

/// Is a token a name or a constant?
fn is_value(kind: SymbolKind) -> bool {
    matches!(kind, S_IDENT | S_SCONST | S_ICONST | S_FCONST | S_BCONST | S_XCONST)
}

/// Build the message of a syntax error and its hint
pub fn syntax_error(
    states: &[StateId],
    unexpected: Option<Unexpected>,
    scratch: &mut Vec<StateId>,
) -> (String, String) {
    let Some(unexpected) = unexpected else {
        return ("syntax error".to_string(), String::new());
    };
    let mut message = format!("syntax error, unexpected {}", describe_unexpected(unexpected.kind, unexpected.text));
    if let Some(list) = expected_list(states, scratch).filter(|list| !list.is_empty()) {
        message.push_str(", expected ");
        for (i, text) in list.iter().enumerate() {
            if i > 0 {
                message.push_str(if i + 1 == list.len() { " or " } else { ", " });
            }
            message.push_str(text);
        }
    }
    (message, hint(states, &unexpected, scratch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits() {
        assert!(within_one_edit(b"frm", b"from"));
        assert!(within_one_edit(b"form", b"from"));
        assert!(within_one_edit(b"wher", b"where"));
        assert!(within_one_edit(b"selct", b"select"));
        assert!(within_one_edit(b"slect", b"select"));
        assert!(within_one_edit(b"sleect", b"select"));
        assert!(within_one_edit(b"from", b"from"));
        assert!(!within_one_edit(b"fr", b"from"));
        assert!(!within_one_edit(b"orm", b"from"));
        assert!(!within_one_edit(b"grop", b"order"));
    }

    #[test]
    fn excerpts() {
        assert_eq!(excerpt("frm", true), "\"frm\"");
        assert_eq!(excerpt("\"My Table\"", true), "\"My Table\"");
        assert_eq!(excerpt(&"a".repeat(40), false), format!("{}...", "a".repeat(32)));
    }
}
