//! The brackets of a statement, for the editor that closes the brackets that the user opens

use dashql_parser::scanner::Symbol;
use dashql_parser::symbol_kind::*;
use dashql_parser::SymbolKind;

/// The closing bracket of an opening one
fn closer_of(opener: SymbolKind) -> Option<SymbolKind> {
    match opener {
        S_LRB => Some(S_RRB),
        S_LSB => Some(S_RSB),
        S_LCB => Some(S_RCB),
        _ => None,
    }
}

/// The opening bracket of a character, `(`, `[` or `{`
pub fn opener_symbol(opener: char) -> Option<SymbolKind> {
    match opener {
        '(' => Some(S_LRB),
        '[' => Some(S_LSB),
        '{' => Some(S_LCB),
        _ => None,
    }
}

/// The brackets without a partner: the open ones at the end and the closing ones that close none
fn imbalance(kinds: impl Iterator<Item = SymbolKind>) -> usize {
    let mut open = Vec::new();
    let mut unmatched_closers = 0;
    for kind in kinds {
        if closer_of(kind).is_some() {
            open.push(kind);
        } else if matches!(kind, S_RRB | S_RSB | S_RCB) {
            if open.last().and_then(|&o| closer_of(o)) == Some(kind) {
                open.pop();
            } else {
                unmatched_closers += 1;
            }
        }
    }
    open.len() + unmatched_closers
}

/// Does an opening bracket that replaces the bytes `[from, to)` give a closing bracket of its statement a partner? The
/// editor then inserts the opener alone instead of a pair. Only the statement of the opener counts, from the `;` before
/// it to the one after it. Brackets in strings and comments are no symbols, and the symbols that the opener replaces
/// are left out.
pub fn opener_pairs_unmatched_closer(symbols: &[Symbol], from: usize, to: usize, opener: SymbolKind) -> bool {
    if closer_of(opener).is_none() {
        return false;
    }
    let start = |s: &Symbol| s.location.offset as usize;
    let end = |s: &Symbol| s.location.offset as usize + s.location.length as usize;
    // The symbols of the statement that the opener keeps, with their offsets
    let mut statement: Vec<(SymbolKind, usize)> = Vec::new();
    for symbol in symbols.iter().filter(|s| s.kind != S_YYEOF && (from == to || end(s) <= from || start(s) >= to)) {
        if symbol.kind == S_SEMICOLON {
            if end(symbol) <= from {
                statement.clear();
                continue;
            }
            break;
        }
        statement.push((symbol.kind, start(symbol)));
    }
    let kinds = |before: bool| statement.iter().filter(move |(_, at)| (*at < from) == before).map(|(kind, _)| *kind);
    let without = imbalance(statement.iter().map(|(kind, _)| *kind));
    let with = imbalance(kinds(true).chain([opener]).chain(kinds(false)));
    with < without
}
