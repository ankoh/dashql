//! The syntax error that a completion reports.
//!
//! The parser recovers from a syntax error by dropping tokens or the statement, so the candidates after an error can
//! miss what the statement would offer: the cursor has no context, the tables of the statement are not in scope, or
//! the parser expects something else. A completion names the first error before the word at the cursor in the
//! statement of the cursor, a scanner or a parser error. An error in an earlier statement doesn't matter, the next
//! statement always survives the recovery. An error at the word at the cursor or after it is the text that the user is
//! typing, `where a = 1 gr|`, it is no error of the completion. So is an error at a keyword right before that word whose
//! lookahead token the word picks, `nulls fi|`.

use crate::cursor::{ScriptCursor, SymbolLocation};
use dashql_buffers::cursor::RelativeSymbolPosition;
use dashql_parser::keywords::Keyword;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::span::TextSpan;
use dashql_parser::symbol_kind::S_SEMICOLON;

/// A syntax error before the cursor in the statement of the cursor
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletionSyntaxError {
    /// The byte span of the error
    pub location: TextSpan,
    /// The line of the error, from 1
    pub line: u32,
    /// The message
    pub message: String,
    /// A guess of the fix, empty if there is none
    pub hint: String,
}

/// The first syntax error before the word at the cursor in the statement of the cursor
pub fn find_syntax_error(cursor: &ScriptCursor, target: Option<SymbolLocation>) -> Option<CompletionSyntaxError> {
    let target = target?;
    let parsed = cursor.script.parsed?;
    let scanned = &parsed.scanned;
    // The word at the cursor begins at its symbol, between symbols at the cursor
    let mut typed_begin = match target.relative_pos {
        RelativeSymbolPosition::BEGIN_OF_SYMBOL
        | RelativeSymbolPosition::MID_OF_SYMBOL
        | RelativeSymbolPosition::END_OF_SYMBOL => target.symbol.location.offset,
        _ => cursor.text_offset as u32,
    };
    let mut before = scanned.symbols.partition_point(|s| s.location.end() <= typed_begin);
    // The scanner picks the lookahead token of a keyword by the token after it, the word at the cursor: `nulls fi|` is
    // an error at NULLS until the word is `first`. Such a keyword belongs to the word.
    if let Some(keyword) = before.checked_sub(1).and_then(|i| scanned.symbols.get(i)) {
        let base = Keyword::base(keyword.kind);
        if !Keyword::lookahead_tokens(base).is_empty() {
            typed_begin = keyword.location.offset;
            before -= 1;
        }
    }
    // The statement of the cursor begins after the last `;` before the word
    let statement_begin = scanned
        .symbols
        .get(..before)
        .unwrap_or_default()
        .iter()
        .rev()
        .find(|s| s.kind == S_SEMICOLON)
        .map_or(0, |s| s.location.end());
    let in_statement = |location: &TextSpan| location.offset >= statement_begin && location.offset < typed_begin;
    let scanner_errors =
        scanned.errors.iter().map(|e| (e.location, &e.message, "")).filter(|(location, _, _)| in_statement(location));
    let parser_errors = parsed
        .errors
        .iter()
        .map(|e| (resolve_text_span(&scanned.text, &scanned.symbols, e.location), &e.message, e.hint.as_str()))
        .filter(|(location, _, _)| in_statement(location));
    let (location, message, hint) =
        scanner_errors.chain(parser_errors).min_by_key(|(location, _, _)| location.offset)?;
    let line = scanned.line_breaks.partition_point(|b| b.offset < location.offset) as u32 + 1;
    Some(CompletionSyntaxError { location, line, message: message.clone(), hint: hint.to_string() })
}
