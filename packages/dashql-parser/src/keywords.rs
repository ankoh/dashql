//! The keywords of the grammar, generated from `grammar/lists/*.list` (shared with the bison grammar).

use crate::{symbol_kind, SymbolKind};

#[rustfmt::skip]
mod table;

use table::KEYWORD_TABLE;
pub use table::{KEYWORDS, MAX_KEYWORD_LENGTH};

/// The category of a keyword
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeywordCategory {
    SqlColumnName,
    SqlReserved,
    SqlTypeFunc,
    SqlUnreserved,
}

/// A keyword
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Keyword {
    /// The lower-case keyword text
    pub name: &'static str,
    /// The terminal symbol of the keyword
    pub symbol: SymbolKind,
    /// The category
    pub category: KeywordCategory,
    /// May the keyword be a column label without AS (`select 1 abort`)?
    pub bare_label: bool,
}

impl Keyword {
    /// Find a keyword by its lower-case text
    pub fn find(text: &[u8]) -> Option<&'static Keyword> {
        if text.len() > MAX_KEYWORD_LENGTH {
            return None;
        }
        let mask = KEYWORD_TABLE.len().wrapping_sub(1);
        let mut slot = fnv1a(text) as usize & mask;
        // The table has empty slots, a probe ends at one at the latest
        for _ in 0..KEYWORD_TABLE.len() {
            match KEYWORD_TABLE.get(slot).copied().unwrap_or(0) {
                0 => return None,
                i => {
                    let keyword = KEYWORDS.get((i as usize).wrapping_sub(1))?;
                    if keyword.name.as_bytes() == text {
                        return Some(keyword);
                    }
                }
            }
            slot = (slot + 1) & mask;
        }
        None
    }

    /// The text of a keyword symbol or of a punctuation or operator symbol with a fixed text
    pub fn symbol_text(symbol: SymbolKind) -> Option<&'static str> {
        use symbol_kind::*;
        if let Some(name) = Self::name_of(symbol) {
            return Some(name);
        }
        Some(match symbol {
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

    /// The keyword text of a terminal symbol, if the symbol is a keyword
    pub fn name_of(symbol: SymbolKind) -> Option<&'static str> {
        keyword_names().get(symbol as usize).copied().flatten()
    }

    /// The keyword of a symbol, a lookahead token is its keyword
    pub fn base(symbol: SymbolKind) -> SymbolKind {
        Self::of_lookahead_token(symbol).unwrap_or(symbol)
    }

    /// The keyword of a lookahead token. The scanner replaces a keyword with its lookahead token if the next token
    /// selects another rule, e.g. NULLS before FIRST or LAST becomes NULLS_LA.
    pub fn of_lookahead_token(symbol: SymbolKind) -> Option<SymbolKind> {
        use symbol_kind::*;
        match symbol {
            S_NOT_LA => Some(S_NOT),
            S_NULLS_LA => Some(S_NULLS_P),
            S_WITH_LA | S_WITH_OPTIONS_LA => Some(S_WITH),
            S_WITHOUT_LA => Some(S_WITHOUT),
            S_ARRAY_LA => Some(S_ARRAY),
            S_SEMI_JOIN_LA => Some(S_SEMI),
            S_ANTI_JOIN_LA => Some(S_ANTI),
            _ => None,
        }
    }

    /// The lookahead tokens of a keyword, see [`Keyword::of_lookahead_token`]
    pub fn lookahead_tokens(symbol: SymbolKind) -> &'static [SymbolKind] {
        use symbol_kind::*;
        match symbol {
            S_NOT => &[S_NOT_LA],
            S_NULLS_P => &[S_NULLS_LA],
            S_WITH => &[S_WITH_LA, S_WITH_OPTIONS_LA],
            S_WITHOUT => &[S_WITHOUT_LA],
            S_ARRAY => &[S_ARRAY_LA],
            S_SEMI => &[S_SEMI_JOIN_LA],
            S_ANTI => &[S_ANTI_JOIN_LA],
            _ => &[],
        }
    }
}

/// FNV-1a, the hash of the keyword lookup table (see //grammar/rust:gen_keywords.py)
fn fnv1a(text: &[u8]) -> u32 {
    let mut h: u32 = 0x811C_9DC5;
    for &b in text {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// Keyword texts indexed by symbol kind
fn keyword_names() -> &'static [Option<&'static str>] {
    static NAMES: std::sync::OnceLock<Vec<Option<&'static str>>> = std::sync::OnceLock::new();
    NAMES.get_or_init(|| {
        let mut names = vec![None; crate::tables::YYNTOKENS];
        for k in KEYWORDS {
            if let Some(name) = names.get_mut(k.symbol as usize) {
                *name = Some(k.name);
            }
        }
        names
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_keywords() {
        let select = Keyword::find(b"select").unwrap();
        assert_eq!(select.symbol, symbol_kind::S_SELECT);
        assert_eq!(select.category, KeywordCategory::SqlReserved);
        assert_eq!(Keyword::find(b"SELECT"), None);
        assert_eq!(Keyword::find(b"selec"), None);
        assert_eq!(Keyword::find(b"a_name_that_is_too_long_to_be_a_keyword"), None);
        assert!(KEYWORDS.windows(2).all(|w| w[0].name < w[1].name));
        assert!(KEYWORDS.iter().all(|k| Keyword::find(k.name.as_bytes()) == Some(k)));
    }

    #[test]
    fn names_symbols() {
        assert_eq!(Keyword::name_of(symbol_kind::S_SELECT), Some("select"));
        assert_eq!(Keyword::name_of(symbol_kind::S_IDENT), None);
        assert_eq!(Keyword::name_of(symbol_kind::S_NOT_LA), None);
    }
}
