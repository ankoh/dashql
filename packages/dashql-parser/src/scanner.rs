//! The SQL scanner.
//!
//! The rules of every flex-style start condition are a logos lexer: the longest match wins, and
//! logos priorities break ties. The lexer of the current start condition matches one token at a
//! time, so that actions can switch the start condition and put text back with `yyless`. See
//! docs/design/core_quirks.md for the quirks of the scanner.
//!
//! [`scan`] then applies a lookahead filter, which turns `NOT`, `NULLS`, `WITH` and `.` into their
//! `*_LA` variants depending on the following tokens.

use crate::keywords::{Keyword, KeywordCategory};
use crate::names::{NameId, NameRegistry};
use crate::span::TextSpan;
use crate::{symbol_kind::*, SymbolKind};
use logos::Logos;
use std::collections::VecDeque;

/// The semantic value of a scanned symbol
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SymbolValue {
    None,
    /// An identifier
    Name(NameId),
    /// The text of a keyword
    Text(&'static str),
}

/// A scanned symbol
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Symbol {
    /// The terminal symbol kind
    pub kind: SymbolKind,
    /// The byte span in the text
    pub location: TextSpan,
    /// The semantic value
    pub value: SymbolValue,
}

impl Symbol {
    fn new(kind: SymbolKind, location: TextSpan) -> Self {
        Self { kind, location, value: SymbolValue::None }
    }
}

/// A literal that Hyper replaced with a typed marker comment, e.g. `/*Integer(4888)*/`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObfuscatedLiteral {
    /// The location of the marker
    pub location: TextSpan,
    /// An executable literal derived from the marker hash, e.g. `18568`
    pub replacement: String,
}

/// A scanner error
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScannerError {
    /// The byte span of the error
    pub location: TextSpan,
    /// The error message
    pub message: String,
}

/// The output of the scanner
#[derive(Clone, Debug, Default)]
pub struct ScannedScript {
    /// The origin id
    pub external_id: u32,
    /// The text version
    pub text_version: u64,
    /// The text
    pub text: String,
    /// The scanner errors
    pub errors: Vec<ScannerError>,
    /// The line breaks (`\n`, `\r\n` or `\r`), including those in comments and literals
    pub line_breaks: Vec<TextSpan>,
    /// The comments
    pub comments: Vec<TextSpan>,
    /// The obfuscated literals, ordered by offset
    pub obfuscated_literals: Vec<ObfuscatedLiteral>,
    /// The names
    pub names: NameRegistry,
    /// The symbols, ending with EOF
    pub symbols: Vec<Symbol>,
}

/// Scan a script.
pub fn scan(text: &str, text_version: u64, external_id: u32) -> ScannedScript {
    let mut out = ScannedScript {
        external_id,
        text_version,
        text: text.to_string(),
        symbols: Vec::with_capacity(text.len() / 4 + 8),
        ..Default::default()
    };
    out.line_breaks = line_breaks(text.as_bytes());
    let mut lexer = Lexer::new(text.as_bytes());
    let mut lookahead: VecDeque<Symbol> = VecDeque::new();
    loop {
        let symbol = next_symbol(&mut lexer, &mut out, &mut lookahead);
        out.symbols.push(symbol);
        if symbol.kind == S_YYEOF {
            break;
        }
    }
    classify_quantified_operators(&mut out.symbols);
    out
}

/// A quantified comparison is distinct from a postfix operator followed by a keyword alias.
#[allow(non_upper_case_globals)]
fn classify_quantified_operators(symbols: &mut [Symbol]) {
    for i in 0..symbols.len() {
        let Some(symbol) = symbols.get(i).copied() else { continue };
        let mut end = i + 1;
        let kind = match symbol.kind {
            S_Op | S_AMPERSAND | S_PIPE | S_EXCLAMATION_MARK => S_QUANTIFIED_OP,
            S_OPERATOR => {
                if symbols.get(end).is_none_or(|s| s.kind != S_LRB) {
                    continue;
                }
                while symbols.get(end).is_some_and(|s| s.kind != S_RRB && s.kind != S_YYEOF) {
                    end += 1;
                }
                end += 1;
                S_QUANTIFIED_OPERATOR
            }
            _ => continue,
        };
        if symbols.get(end).is_some_and(|s| matches!(s.kind, S_ANY | S_SOME | S_ALL))
            && symbols.get(end + 1).is_some_and(|s| s.kind == S_LRB)
        {
            if let Some(symbol) = symbols.get_mut(i) {
                symbol.kind = kind;
            }
        }
    }
}

/// Find the line breaks of a text, `\r\n` is one line break.
fn line_breaks(text: &[u8]) -> Vec<TextSpan> {
    let mut breaks = Vec::new();
    let mut i = 0;
    while let Some(&c) = text.get(i) {
        match c {
            b'\r' if text.get(i + 1) == Some(&b'\n') => {
                breaks.push(Lexer::span(i, 2));
                i += 1;
            }
            b'\n' | b'\r' => breaks.push(Lexer::span(i, 1)),
            _ => {}
        }
        i += 1;
    }
    breaks
}

/// The lookahead filter of [`scan`].
fn next_symbol(lexer: &mut Lexer, out: &mut ScannedScript, lookahead: &mut VecDeque<Symbol>) -> Symbol {
    let current = match lookahead.pop_front() {
        Some(symbol) => symbol,
        None => lexer.lex(out),
    };
    match current.kind {
        S_NOT | S_NULLS_P | S_WITH | S_DOT | S_WITHOUT | S_ARRAY | S_FORMAT | S_SEMI | S_ANTI => {}
        _ => return current,
    }
    let next = lexer.lex(out);
    lookahead.push_back(next);
    match (current.kind, next.kind) {
        (S_NOT, S_BETWEEN | S_IN_P | S_LIKE | S_ILIKE | S_GLOB | S_SIMILAR) => Symbol::new(S_NOT_LA, current.location),
        (S_NULLS_P, S_FIRST_P | S_LAST_P) => Symbol::new(S_NULLS_LA, current.location),
        (S_WITH, S_TIME | S_ORDINALITY | S_AGGREGATION_THRESHOLD) => Symbol::new(S_WITH_LA, current.location),
        (S_WITH, S_OPTIONS) => Symbol::new(S_WITH_OPTIONS_LA, current.location),
        (S_WITHOUT, S_TIME) => Symbol::new(S_WITHOUT_LA, current.location),
        (S_ARRAY, S_LRB | S_WRAPPER) => Symbol::new(S_ARRAY_LA, current.location),
        (S_SEMI, S_JOIN) => Symbol::new(S_SEMI_JOIN_LA, current.location),
        (S_ANTI, S_JOIN) => Symbol::new(S_ANTI_JOIN_LA, current.location),
        (S_DOT, S_STAR) => Symbol::new(S_DOT_STAR_LA, current.location),
        // A name or a keyword continues the name after whitespace, a reserved keyword like FROM in `select t. from t`
        // only in theory
        (S_DOT, _) if current.location.end() < next.location.offset && !continues_name(&next) => {
            Symbol::new(S_DOT_TRAILING, current.location)
        }
        _ => current,
    }
}

/// Can a symbol after a dot and whitespace be the next name of a qualified name?
fn continues_name(symbol: &Symbol) -> bool {
    match symbol.value {
        SymbolValue::Name(_) => true,
        SymbolValue::Text(name) => {
            Keyword::find(name.as_bytes()).is_some_and(|keyword| keyword.category != KeywordCategory::SqlReserved)
        }
        SymbolValue::None => false,
    }
}

/// The flex start conditions
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Initial,
    /// Bit string literal
    Xb,
    /// Backtick-quoted identifier
    Xbt,
    /// C-style comment
    Xc,
    /// Double-quoted identifier
    Xd,
    /// Hexadecimal string literal
    Xh,
    /// Quoted string
    Xq,
    /// Dollar-quoted string
    Xdq,
}

// The rules of every start condition form a logos lexer. Logos takes the longest match like flex,
// and resolves a tie by priority. The default priority of a pattern is 2 for every byte or class it
// has to match, which already ranks `{comment}`, `{xcstart}` and the two-character operators above
// `{operator}`. The explicit priorities rank the remaining ties.
//
// Like flex, the lexers match bytes, not characters (`utf8 = false` and byte-string patterns), so
// `\x80-\xFF` are identifier bytes.

/// The rules of INITIAL
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
#[logos(subpattern space = br"[ \t\n\r\f]")]
#[logos(subpattern op_chars = br"[~!@#^&|+\-*/%<>=]")]
#[logos(subpattern integer = br"[0-9]+")]
#[logos(subpattern decimal = br"[0-9]*\.[0-9]+|[0-9]+\.[0-9]*")]
enum Initial {
    /// `{space}+`
    #[regex(br"(?&space)+")]
    Space,
    /// `{comment}`
    #[regex(br"--[^\n\r]*", allow_greedy = true)]
    Comment,
    /// The Hyper obfuscation markers, case-sensitive unlike the other rules
    #[regex(br"/\*String\([0-9A-F]{4}\)\*/", |_| S_SCONST)]
    #[regex(br"/\*Integer\([0-9A-F]{4}\)\*/", |_| S_ICONST)]
    #[regex(br"/\*Float\([0-9A-F]{4}\)\*/", |_| S_FCONST)]
    #[regex(br"/\*HexString\([0-9A-F]{4}\)\*/", |_| S_XCONST)]
    #[regex(br"/\*BitString\([0-9A-F]{4}\)\*/", |_| S_BCONST)]
    ObfuscatedLiteral(SymbolKind),
    /// `{xcstart}`: matches as much as `{operator}` would, the action puts the operator back
    #[regex(br"/\*(?&op_chars)*")]
    CommentStart,
    /// `{xbstart}`, `{xhstart}`, `{xqstart}`, `{xdstart}`, `{xbtstart}`
    #[regex(b"[bB]'", |_| State::Xb)]
    #[regex(b"[xX]'", |_| State::Xh)]
    #[token("'", |_| State::Xq)]
    #[token("\"", |_| State::Xd)]
    #[regex(b"[uU]&\"", |_| State::Xd)]
    #[token("`", |_| State::Xbt)]
    #[token("$$", |_| State::Xdq)]
    Begin(State),
    /// A tagged dollar string has a delimiter chosen by the SQL text.
    #[regex(br"\$[A-Za-z_\x80-\xff][A-Za-z_0-9\x80-\xff]*\$")]
    TaggedDollarString,
    /// The operators and punctuation with a token of their own
    #[token("::", |_| S_TYPECAST)]
    #[token("..", |_| S_DOT_DOT)]
    #[token(".", |_| S_DOT)]
    #[token(":=", |_| S_COLON_EQUALS)]
    #[token("=>", |_| S_EQUALS_GREATER)]
    #[token("<=", |_| S_LESS_EQUALS)]
    #[token(">=", |_| S_GREATER_EQUALS)]
    #[token("<>", |_| S_NOT_EQUALS)]
    #[token("!=", |_| S_NOT_EQUALS)]
    #[token(",", |_| S_COMMA)]
    #[token("(", |_| S_LRB)]
    #[token(")", |_| S_RRB)]
    #[token("[", |_| S_LSB)]
    #[token("]", |_| S_RSB)]
    #[token("{", |_| S_LCB)]
    #[token("}", |_| S_RCB)]
    #[token(";", |_| S_SEMICOLON)]
    #[token(":", |_| S_COLON)]
    #[token("+", |_| S_PLUS)]
    #[token("-", |_| S_MINUS)]
    #[token("/", |_| S_DIVIDE)]
    #[token("*", |_| S_STAR)]
    #[token("%", |_| S_MODULO)]
    #[token("^", |_| S_CIRCUMFLEX)]
    #[token("&", |_| S_AMPERSAND)]
    #[token("|", |_| S_PIPE)]
    #[token("!", |_| S_EXCLAMATION_MARK)]
    #[token("<", |_| S_LESS_THAN)]
    #[token(">", |_| S_GREATER_THAN)]
    #[token("=", |_| S_EQUALS)]
    #[token("$", |_| S_DOLLAR)]
    Token(SymbolKind),
    /// `{raw_dot_trailing}`, the action puts the space back
    #[regex(br"\.(?&space)")]
    DotTrailing,
    /// `{raw_question_mark}`, the action checks the trailing context
    #[token("?")]
    QuestionMark,
    /// `{operator}`, below the single-character tokens
    #[regex(br"(?&op_chars)+", priority = 1)]
    Operator,
    /// `{integer}`
    #[regex(br"(?&integer)")]
    Integer,
    /// `{decimal}`, `{real}`
    #[regex(br"(?&decimal)")]
    #[regex(br"((?&integer)|(?&decimal))[Ee][-+]?[0-9]+")]
    Float,
    /// `{decimalfail}`
    #[regex(br"(?&integer)\.\.")]
    DecimalFail,
    /// `{realfail1}`
    #[regex(br"((?&integer)|(?&decimal))[Ee]")]
    RealFail1,
    /// `{realfail2}`
    #[regex(br"((?&integer)|(?&decimal))[Ee][-+]")]
    RealFail2,
    /// `{identifier}`
    #[regex(br"[A-Za-z\x80-\xFF_][A-Za-z\x80-\xFF_0-9$]*")]
    Identifier,
    /// `{other}`, below everything else
    #[regex(br"[^\n]", priority = 0)]
    Other,
}

/// The rules of xc
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum Xc {
    /// `{xcstart}`
    #[regex(br"/\*[~!@#^&|+\-*/%<>=]*")]
    CommentStart,
    /// `{xcstop}`
    #[regex(br"\*+/")]
    CommentStop,
    /// `{xcinside}`, `{op_chars}`, `\*+`
    #[regex(br"[^*/]+")]
    #[regex(br"\*+")]
    #[token("/")]
    Inside,
}

/// The rules of xb and xh
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum XbXh {
    /// The closing quote, the action checks for a continuation (`{quotecontinue}`)
    #[token("'")]
    QuoteStop,
    /// `{xbinside}`, `{xhinside}`
    #[regex(br"[^']+")]
    Inside,
}

/// The rules of xq
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum Xq {
    /// The closing quote
    #[token("'")]
    QuoteStop,
    /// `{xqdouble}`, `{xqinside}`
    #[token("''")]
    #[regex(br"[^']+")]
    Inside,
}

/// The rules of xdq, the text between `$$` is verbatim
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum Xdq {
    /// The closing `$$`
    #[token("$$")]
    Stop,
    /// A lone `$` or text without one
    #[token("$")]
    #[regex(br"[^$]+")]
    Inside,
}

/// The rules of xd
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum Xd {
    /// `{xddouble}`, `{xdinside}`
    #[token("\"\"")]
    #[regex(br#"[^"]+"#)]
    Inside,
    /// `{xdstop}`
    #[token("\"")]
    Stop,
}

/// The rules of xbt
#[derive(Logos, Clone, Copy, Debug, PartialEq, Eq)]
#[logos(utf8 = false)]
enum Xbt {
    /// `{xbtdouble}`, `{xbtinside}`
    #[token("``")]
    #[regex(br"[^`]+")]
    Inside,
    /// `{xbtstop}`
    #[token("`")]
    Stop,
}

/// `{ident_cont}`
fn is_ident_cont(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

/// The token of a single special character
fn special_character(c: u8) -> Option<SymbolKind> {
    Some(match c {
        b',' => S_COMMA,
        b'(' => S_LRB,
        b')' => S_RRB,
        b'[' => S_LSB,
        b']' => S_RSB,
        b'{' => S_LCB,
        b'}' => S_RCB,
        b'.' => S_DOT,
        b';' => S_SEMICOLON,
        b':' => S_COLON,
        b'+' => S_PLUS,
        b'-' => S_MINUS,
        b'*' => S_STAR,
        b'/' => S_DIVIDE,
        b'%' => S_MODULO,
        b'?' => S_QUESTION_MARK,
        b'^' => S_CIRCUMFLEX,
        b'&' => S_AMPERSAND,
        b'|' => S_PIPE,
        b'!' => S_EXCLAMATION_MARK,
        b'<' => S_LESS_THAN,
        b'>' => S_GREATER_THAN,
        b'=' => S_EQUALS,
        _ => return None,
    })
}

/// The two-character operator tokens that also match `{operator}`
fn two_char_operator(a: u8, b: u8) -> Option<SymbolKind> {
    Some(match (a, b) {
        (b'=', b'>') => S_EQUALS_GREATER,
        (b'<', b'=') => S_LESS_EQUALS,
        (b'>', b'=') => S_GREATER_EQUALS,
        (b'<', b'>') | (b'!', b'=') => S_NOT_EQUALS,
        _ => return None,
    })
}

/// The scanner, switches between the lexers of the start conditions like the flex scanner
struct Lexer<'a> {
    /// The script text
    text: &'a [u8],
    /// The byte offset of the next match
    pos: usize,
    /// The current start condition
    state: State,
    /// The start of the current extended token (quoted literal, identifier or comment)
    ext_begin: TextSpan,
    /// The nesting depth of C-style comments
    ext_depth: usize,
    /// A buffer for lower-casing and unescaping names
    buffer: Vec<u8>,
}

impl<'a> Lexer<'a> {
    fn new(text: &'a [u8]) -> Self {
        Self {
            text,
            pos: 0,
            state: State::Initial,
            ext_begin: TextSpan::default(),
            ext_depth: 0,
            buffer: Vec::with_capacity(64),
        }
    }

    fn span(begin: usize, length: usize) -> TextSpan {
        TextSpan::new(begin as u32, length as u32)
    }

    /// The empty location at the end of the text
    fn eof_location(&self) -> TextSpan {
        Self::span(self.text.len(), 0)
    }

    /// Match the rules of a start condition at the current position and consume the match.
    fn next_match<T>(&mut self) -> Option<(T, TextSpan)>
    where
        T: Logos<'a, Source = [u8], Extras = ()>,
    {
        let start = self.pos;
        let mut lexer = T::lexer(self.text.get(start..).unwrap_or_default());
        // Every byte starts a match in every start condition, see `no_match` for the fallback
        let Some(Ok(token)) = lexer.next() else {
            return None;
        };
        let length = lexer.span().end;
        self.pos = start + length;
        Some((token, Self::span(start, length)))
    }

    /// No rule matches at the position: report it and skip the rest of the text
    #[cold]
    fn no_match(&mut self, out: &mut ScannedScript) -> Option<Symbol> {
        out.errors.push(ScannerError {
            location: Self::span(self.pos, self.text.len().saturating_sub(self.pos)),
            message: "no scanner rule matches".to_string(),
        });
        self.pos = self.text.len();
        self.state = State::Initial;
        None
    }

    /// Scan the next raw token (before the lookahead filter)
    fn lex(&mut self, out: &mut ScannedScript) -> Symbol {
        loop {
            if self.state == State::Initial {
                while let Some(c) = first_char(self.text.get(self.pos..).unwrap_or_default()) {
                    if !is_unicode_space(c) {
                        break;
                    }
                    self.pos += c.len_utf8();
                }
                // A parameter number ends before a field dot, unlike a decimal literal: $1.x.
                if self.pos > 0
                    && self.text.get(self.pos - 1) == Some(&b'$')
                    && self.text.get(self.pos).is_some_and(u8::is_ascii_digit)
                {
                    let begin = self.pos;
                    while self.text.get(self.pos).is_some_and(u8::is_ascii_digit) {
                        self.pos += 1;
                    }
                    return Symbol::new(S_ICONST, Self::span(begin, self.pos - begin));
                }
            }
            if self.pos >= self.text.len() {
                let eof = self.eof_location();
                let message = match self.state {
                    State::Initial => return Symbol::new(S_YYEOF, eof),
                    State::Xc => "unterminated comment",
                    State::Xb => "unterminated bit string literal",
                    State::Xh => "unterminated hexadecimal bit string literal",
                    State::Xq => "unterminated quoted string",
                    State::Xdq => "unterminated dollar-quoted string",
                    State::Xd => "unterminated delimited identifier",
                    State::Xbt => "unterminated backtick-quoted identifier",
                };
                let location = self.ext_begin.cover(eof);
                out.errors.push(ScannerError { location, message: message.to_string() });
                // An unterminated literal or quoted identifier still runs to the end of the text, so that the parser
                // and the cursor see it, e.g. to complete `from "my ta`. A comment remains no symbol.
                let symbol = match self.state {
                    State::Initial | State::Xc => None,
                    State::Xb | State::Xh | State::Xq => Some(Symbol::new(self.literal_kind(), location)),
                    State::Xdq => Some(Symbol::new(S_DCONST, location)),
                    State::Xd => Some(self.unterminated_identifier(out, location, b'"')),
                    State::Xbt => Some(self.unterminated_identifier(out, location, b'`')),
                };
                self.state = State::Initial;
                match symbol {
                    Some(symbol) => return symbol,
                    None => continue,
                }
            }
            let symbol = match self.state {
                State::Initial => match self.next_match::<Initial>() {
                    Some((token, loc)) => self.initial(out, token, loc),
                    None => self.no_match(out),
                },
                State::Xc => match self.next_match::<Xc>() {
                    Some((Xc::CommentStart, mut loc)) => {
                        self.yyless(&mut loc, 2);
                        self.ext_depth += 1;
                        None
                    }
                    Some((Xc::CommentStop, loc)) => {
                        self.ext_depth -= 1;
                        if self.ext_depth == 0 {
                            out.comments.push(self.ext_begin.cover(loc));
                            self.state = State::Initial;
                        }
                        None
                    }
                    Some((Xc::Inside, _)) => None,
                    None => self.no_match(out),
                },
                State::Xb | State::Xh => match self.next_match::<XbXh>() {
                    Some((XbXh::QuoteStop, loc)) => {
                        if self.quote_continue(out) {
                            None
                        } else {
                            Some(self.quote_stop(loc))
                        }
                    }
                    Some((XbXh::Inside, _)) => None,
                    None => self.no_match(out),
                },
                State::Xq => match self.next_match::<Xq>() {
                    Some((Xq::QuoteStop, loc)) => {
                        if self.quote_continue(out) {
                            None
                        } else {
                            Some(self.quote_stop(loc))
                        }
                    }
                    Some((Xq::Inside, _)) => None,
                    None => self.no_match(out),
                },
                State::Xdq => match self.next_match::<Xdq>() {
                    Some((Xdq::Stop, loc)) => {
                        self.state = State::Initial;
                        Some(Symbol::new(S_DCONST, self.ext_begin.cover(loc)))
                    }
                    Some((Xdq::Inside, _)) => None,
                    None => self.no_match(out),
                },
                State::Xd => match self.next_match::<Xd>() {
                    Some((Xd::Stop, loc)) => {
                        Some(self.identifier_stop(out, loc, b'"', "zero-length delimited identifier"))
                    }
                    Some((Xd::Inside, _)) => None,
                    None => self.no_match(out),
                },
                State::Xbt => match self.next_match::<Xbt>() {
                    Some((Xbt::Stop, loc)) => {
                        Some(self.identifier_stop(out, loc, b'`', "zero-length backtick-quoted identifier"))
                    }
                    Some((Xbt::Inside, _)) => None,
                    None => self.no_match(out),
                },
            };
            if let Some(symbol) = symbol {
                return symbol;
            }
        }
    }

    /// Put back all but the first `n` characters of the current match (`yyless(n)`).
    fn yyless(&mut self, loc: &mut TextSpan, n: usize) {
        self.pos = loc.offset as usize + n;
        loc.length = n as u32;
    }

    /// Run the action of an INITIAL rule. Returns a symbol if the action returns one.
    fn initial(&mut self, out: &mut ScannedScript, token: Initial, mut loc: TextSpan) -> Option<Symbol> {
        match token {
            Initial::Space => None,
            Initial::Comment => {
                out.comments.push(loc);
                None
            }
            Initial::ObfuscatedLiteral(kind) => {
                out.obfuscated_literals.extend(obfuscated_literal(self.text, loc));
                Some(Symbol::new(kind, loc))
            }
            Initial::CommentStart => {
                self.yyless(&mut loc, 2);
                self.ext_begin = loc;
                self.ext_depth += 1;
                self.state = State::Xc;
                None
            }
            Initial::Begin(state) => {
                self.ext_begin = loc;
                self.state = state;
                None
            }
            Initial::TaggedDollarString => {
                let delimiter = self.text.get(loc.offset as usize..loc.end() as usize).unwrap_or_default();
                let rest = self.text.get(self.pos..).unwrap_or_default();
                if let Some(end) = rest.windows(delimiter.len()).position(|part| part == delimiter) {
                    self.pos += end + delimiter.len();
                    Some(Symbol::new(S_DCONST, Self::span(loc.offset as usize, self.pos - loc.offset as usize)))
                } else {
                    let location = Self::span(loc.offset as usize, self.text.len() - loc.offset as usize);
                    out.errors
                        .push(ScannerError { location, message: "unterminated dollar-quoted string".to_string() });
                    self.pos = self.text.len();
                    Some(Symbol::new(S_DCONST, location))
                }
            }
            Initial::Token(kind) => Some(Symbol::new(kind, loc)),
            Initial::DotTrailing => {
                self.yyless(&mut loc, 1);
                Some(Symbol::new(S_DOT, loc))
            }
            // A standalone ? is an unnamed parameter. ?name, ?1 and ?"name" are not parameters of Hyper,
            // the grammar has no rule for QUESTION_MARK, so they are syntax errors.
            Initial::QuestionMark => match self.text.get(self.pos) {
                Some(&c) if is_ident_cont(c) || c == b'"' => Some(Symbol::new(S_QUESTION_MARK, loc)),
                _ => Some(Symbol::new(S_PARAM, loc)),
            },
            Initial::Operator => Some(self.operator(out, loc)),
            Initial::Integer => Some(self.number(loc)),
            Initial::Float => Some(Symbol::new(S_FCONST, loc)),
            Initial::DecimalFail | Initial::RealFail1 | Initial::RealFail2 => {
                // Put back the dots, or the exponent marker and its sign
                let putback = if token == Initial::RealFail1 { 1 } else { 2 };
                let keep = loc.length as usize - putback;
                self.yyless(&mut loc, keep);
                Some(self.number(loc))
            }
            Initial::Identifier => {
                if let Some((end, _)) = utf8(self.text.get(loc.offset as usize..loc.end() as usize).unwrap_or_default())
                    .char_indices()
                    .find(|(_, c)| is_unicode_space(*c))
                {
                    self.yyless(&mut loc, end);
                }
                Some(self.read_identifier(out, loc))
            }
            Initial::Other => Some(Symbol::new(S_RAW_CHAR, loc)),
        }
    }

    /// A number literal: integers that do not fit into an `i64` are FCONST, like in Postgres
    fn number(&self, loc: TextSpan) -> Symbol {
        let text = self.text.get(loc.offset as usize..loc.end() as usize).unwrap_or_default();
        let is_integer = utf8(text).parse::<i64>().is_ok();
        Symbol::new(if is_integer { S_ICONST } else { S_FCONST }, loc)
    }

    /// The closing quote of a string, bit string or hex string literal
    fn quote_stop(&mut self, loc: TextSpan) -> Symbol {
        let kind = self.literal_kind();
        self.state = State::Initial;
        Symbol::new(kind, self.ext_begin.cover(loc))
    }

    /// `{quotecontinue}`: a bit or hex string continues after whitespace with a line break and
    /// another quote. Consumes the whitespace and the quote and records the comments in it.
    fn quote_continue(&mut self, out: &mut ScannedScript) -> bool {
        let mut i = self.pos;
        let mut comments = Vec::new();
        let mut has_line_break = false;
        while let Some(&c) = self.text.get(i) {
            match c {
                b' ' | b'\t' | b'\x0C' => i += 1,
                b'\n' | b'\r' => {
                    has_line_break = true;
                    i += 1;
                }
                b'-' if self.text.get(i + 1) == Some(&b'-') => {
                    let length = self.text.get(i..).unwrap_or_default().iter().position(|&c| c == b'\n' || c == b'\r');
                    let length = length.unwrap_or(self.text.len() - i);
                    comments.push(Self::span(i, length));
                    i += length;
                }
                b'\'' if has_line_break => {
                    out.comments.extend(comments);
                    self.pos = i + 1;
                    return true;
                }
                _ => break,
            }
        }
        false
    }

    /// The `{xdstop}` and `{xbtstop}` actions
    fn identifier_stop(&mut self, out: &mut ScannedScript, loc: TextSpan, quote: u8, message: &str) -> Symbol {
        let loc = self.ext_begin.cover(loc);
        if self
            .text
            .get(loc.offset as usize..loc.offset as usize + 3)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"u&\""))
        {
            self.state = State::Initial;
            return self.unicode_identifier(out, loc);
        }
        if loc.length == 2 {
            out.errors.push(ScannerError { location: loc, message: message.to_string() });
        }
        self.state = State::Initial;
        self.read_quoted_identifier(out, loc, quote)
    }

    /// Read a Unicode delimited identifier and its optional UESCAPE clause.
    fn unicode_identifier(&mut self, out: &mut ScannedScript, mut loc: TextSpan) -> Symbol {
        let identifier_end = loc.end() as usize;
        let mut escape = '\\';
        let mut rest = self.pos;
        while self.text.get(rest).is_some_and(u8::is_ascii_whitespace) {
            rest += 1;
        }
        if self.text.get(rest..rest + 7).is_some_and(|s| s.eq_ignore_ascii_case(b"uescape")) {
            rest += 7;
            while self.text.get(rest).is_some_and(u8::is_ascii_whitespace) {
                rest += 1;
            }
            if self.text.get(rest) == Some(&b'\'') && self.text.get(rest + 2) == Some(&b'\'') {
                escape = self.text.get(rest + 1).copied().unwrap_or(b'\\') as char;
                self.pos = rest + 3;
                loc.length = (self.pos - loc.offset as usize) as u32;
            }
        }
        let inner = utf8(self.text.get(loc.offset as usize + 3..identifier_end.saturating_sub(1)).unwrap_or_default());
        let mut name = String::new();
        let mut chars = inner.chars().peekable();
        let mut valid = true;
        while let Some(c) = chars.next() {
            if c == '"' && chars.peek() == Some(&'"') {
                chars.next();
            } else if c == escape {
                if chars.peek() == Some(&escape) {
                    chars.next();
                } else {
                    let digits = if chars.peek() == Some(&'+') {
                        chars.next();
                        6
                    } else {
                        4
                    };
                    let hex: String = chars.by_ref().take(digits).collect();
                    let decoded = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32);
                    if hex.len() == digits {
                        if let Some(c) = decoded {
                            name.push(c);
                            continue;
                        }
                    }
                    valid = false;
                    break;
                }
            }
            name.push(c);
        }
        if !valid || name.is_empty() {
            out.errors
                .push(ScannerError { location: loc, message: "invalid Unicode delimited identifier".to_string() });
        }
        let id = out.names.register(&name, loc);
        Symbol { kind: S_IDENT, location: loc, value: SymbolValue::Name(id) }
    }

    /// The token kind of the literal that the current start condition scans
    fn literal_kind(&self) -> SymbolKind {
        match self.state {
            State::Xb => S_BCONST,
            State::Xh => S_XCONST,
            _ => S_SCONST,
        }
    }

    fn read_quoted_identifier(&mut self, out: &mut ScannedScript, loc: TextSpan, quote: u8) -> Symbol {
        let text = self.text.get(loc.offset as usize..loc.end() as usize).unwrap_or_default();
        // The text between the quotes
        let inner = text.get(1..text.len().saturating_sub(1)).unwrap_or_default();
        self.quoted_identifier(out, inner, loc, quote)
    }

    /// An unterminated quoted identifier, its name is the text after the opening quote
    fn unterminated_identifier(&mut self, out: &mut ScannedScript, loc: TextSpan, quote: u8) -> Symbol {
        let inner = self.text.get(self.ext_begin.end() as usize..loc.end() as usize).unwrap_or_default();
        self.quoted_identifier(out, inner, loc, quote)
    }

    /// An identifier with the text between its quotes, doubled quotes are one
    fn quoted_identifier(&mut self, out: &mut ScannedScript, inner: &'a [u8], loc: TextSpan, quote: u8) -> Symbol {
        let name = if inner.contains(&quote) {
            let name = &mut self.buffer;
            name.clear();
            let mut bytes = inner.iter().peekable();
            while let Some(&c) = bytes.next() {
                name.push(c);
                if c == quote && bytes.peek() == Some(&&quote) {
                    bytes.next();
                }
            }
            &self.buffer[..]
        } else {
            inner
        };
        let id = out.names.register(utf8(name), loc);
        Symbol { kind: S_IDENT, location: loc, value: SymbolValue::Name(id) }
    }

    fn read_identifier(&mut self, out: &mut ScannedScript, loc: TextSpan) -> Symbol {
        let text = self.text.get(loc.offset as usize..loc.end() as usize).unwrap_or_default();
        self.buffer.clear();
        self.buffer.extend(text.iter().map(u8::to_ascii_lowercase));
        let lower = &self.buffer[..];
        if let Some(keyword) = Keyword::find(lower) {
            return Symbol { kind: keyword.symbol, location: loc, value: SymbolValue::Text(keyword.name) };
        }
        let id = out.names.register(utf8(lower), loc);
        Symbol { kind: S_IDENT, location: loc, value: SymbolValue::Name(id) }
    }

    /// The `{operator}` action
    fn operator(&mut self, out: &mut ScannedScript, mut loc: TextSpan) -> Symbol {
        let start = loc.offset as usize;
        let yyleng = loc.length as usize;
        let text = self.text.get(start..start + yyleng).unwrap_or_default();

        // Embedded slash-star or dash-dash start a comment, the operator stops there.
        let find = |pattern: &[u8]| text.windows(2).position(|w| w == pattern);
        let mut nchars = yyleng;
        if let Some(i) = [find(b"/*"), find(b"--")].into_iter().flatten().min() {
            nchars = i;
        }
        // '+' and '-' cannot end a multi-char operator unless it contains chars that are not in
        // SQL operators.
        while nchars > 1 && matches!(text.get(nchars - 1), Some(b'+' | b'-')) {
            if text.get(..nchars - 1).unwrap_or_default().iter().any(|c| b"~!@#^&|?%".contains(c)) {
                break;
            }
            nchars -= 1;
        }
        if nchars < yyleng {
            self.yyless(&mut loc, nchars);
            if nchars == 1 {
                if let Some(kind) = text.first().and_then(|&c| special_character(c)) {
                    return Symbol::new(kind, loc);
                }
            }
            if nchars == 2 {
                if let [first, second, ..] = *text {
                    if let Some(kind) = two_char_operator(first, second) {
                        return Symbol::new(kind, loc);
                    }
                }
            }
        }
        if nchars >= 64 {
            out.errors.push(ScannerError {
                location: loc,
                message: "operator too long: operators longer than 64 bytes are not supported".to_string(),
            });
        }
        Symbol::new(S_Op, loc)
    }
}

/// Derive an executable literal from the hash of a marker. The rule of the marker matches `/*Kind(XXXX)*/` with four
/// hex digits, `None` for another text.
fn obfuscated_literal(text: &[u8], location: TextSpan) -> Option<ObfuscatedLiteral> {
    let marker = text.get(location.offset as usize..location.end() as usize)?;
    let open = marker.iter().position(|&c| c == b'(')?;
    let kind = marker.get(2..open)?;
    let hash = std::str::from_utf8(marker.get(open + 1..open + 5)?).ok()?;
    let value = u32::from_str_radix(hash, 16).ok()?;
    let replacement = match kind {
        b"String" => format!("'{hash}'"),
        b"Integer" => value.to_string(),
        b"Float" => format!("{value}.0"),
        b"HexString" => format!("X'{hash}'"),
        _ => {
            let bits: String = (0..16).rev().map(|bit| if (value >> bit) & 1 == 1 { '1' } else { '0' }).collect();
            format!("B'{bits}'")
        }
    };
    Some(ObfuscatedLiteral { location, replacement })
}

/// Names are cut out of valid UTF-8 at ASCII boundaries, so they are valid UTF-8 themselves, other bytes read as an
/// empty text.
fn utf8(bytes: &[u8]) -> &str {
    std::str::from_utf8(bytes).unwrap_or_default()
}

/// The character that starts the bytes, none if they don't start with valid UTF-8. Decodes only that character: a
/// scan that checked the whole rest of the text before every token would be quadratic in the text.
fn first_char(bytes: &[u8]) -> Option<char> {
    let length = match *bytes.first()? {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf7 => 4,
        _ => return None,
    };
    std::str::from_utf8(bytes.get(..length)?).ok()?.chars().next()
}

/// The non-ASCII whitespace accepted by Hyper, including zero-width separators and a BOM.
fn is_unicode_space(c: char) -> bool {
    matches!(c, '\u{a0}' | '\u{2000}'..='\u{200f}' | '\u{2028}' | '\u{2029}' | '\u{3000}' | '\u{feff}')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(text: &str) -> Vec<SymbolKind> {
        scan(text, 0, 0).symbols.iter().map(|s| s.kind).collect()
    }

    fn spans(text: &str) -> Vec<(u32, u32)> {
        scan(text, 0, 0).symbols.iter().map(|s| (s.location.offset, s.location.length)).collect()
    }

    #[test]
    fn scans_keywords_and_identifiers() {
        let out = scan("SELECT Foo, foo", 0, 0);
        let kinds: Vec<_> = out.symbols.iter().map(|s| s.kind).collect();
        assert_eq!(kinds, vec![S_SELECT, S_IDENT, S_COMMA, S_IDENT, S_YYEOF]);
        assert_eq!(out.symbols[0].value, SymbolValue::Text("select"));
        assert_eq!(out.symbols[1].value, SymbolValue::Name(0));
        assert_eq!(out.symbols[3].value, SymbolValue::Name(0));
        assert_eq!(out.names.get(0).text, "foo");
        assert_eq!(out.names.get(0).occurrences, 2);
        assert_eq!(out.symbols[4].location, TextSpan::new(15, 0));
    }

    #[test]
    fn scans_numbers() {
        assert_eq!(kinds("1..2"), vec![S_ICONST, S_DOT_DOT, S_ICONST, S_YYEOF]);
        assert_eq!(spans("1..2"), vec![(0, 1), (1, 2), (3, 1), (4, 0)]);
        assert_eq!(kinds("1e5 1.5 .5 1. 1e"), vec![S_FCONST, S_FCONST, S_FCONST, S_FCONST, S_ICONST, S_IDENT, S_YYEOF]);
        assert_eq!(kinds("1.5e+"), vec![S_FCONST, S_IDENT, S_PLUS, S_YYEOF]);
        // Integers that do not fit into an i64 are FCONST
        assert_eq!(kinds("9223372036854775807 9223372036854775808"), vec![S_ICONST, S_FCONST, S_YYEOF]);
    }

    #[test]
    fn scans_trailing_dots() {
        assert_eq!(kinds("a. b"), vec![S_IDENT, S_DOT, S_IDENT, S_YYEOF]);
        assert_eq!(spans("a. b")[1], (1, 1));
        assert_eq!(kinds("a. name"), vec![S_IDENT, S_DOT, S_NAME_P, S_YYEOF]);
        assert_eq!(kinds("a.from"), vec![S_IDENT, S_DOT, S_FROM, S_YYEOF]);
        assert_eq!(kinds("a. from"), vec![S_IDENT, S_DOT_TRAILING, S_FROM, S_YYEOF]);
        assert_eq!(kinds("a. ,"), vec![S_IDENT, S_DOT_TRAILING, S_COMMA, S_YYEOF]);
        let out = scan("a.\n", 0, 0);
        assert_eq!(out.line_breaks, vec![TextSpan::new(2, 1)]);
    }

    #[test]
    fn trims_trailing_signs_and_comments_from_operators() {
        // Like Postgres, the operator keeps the characters before the comment start or trailing sign.
        assert_eq!(kinds("+-- foo"), vec![S_PLUS, S_YYEOF]);
        assert_eq!(spans("+-- foo")[0], (0, 1));
        assert_eq!(kinds("=- <=> !="), vec![S_EQUALS, S_MINUS, S_Op, S_NOT_EQUALS, S_YYEOF]);
        assert_eq!(kinds("a>=-1"), vec![S_IDENT, S_GREATER_EQUALS, S_MINUS, S_ICONST, S_YYEOF]);
        assert_eq!(spans("a>=-1")[1], (1, 2));
        assert_eq!(kinds("a=>-1"), vec![S_IDENT, S_EQUALS_GREATER, S_MINUS, S_ICONST, S_YYEOF]);
        assert_eq!(kinds("1 +/* c */ 2"), vec![S_ICONST, S_PLUS, S_ICONST, S_YYEOF]);
        assert_eq!(kinds("*/*"), vec![S_STAR, S_YYEOF]);
    }

    #[test]
    fn applies_the_lookahead_filter() {
        assert_eq!(kinds("not in"), vec![S_NOT_LA, S_IN_P, S_YYEOF]);
        assert_eq!(kinds("not glob"), vec![S_NOT_LA, S_GLOB, S_YYEOF]);
        assert_eq!(kinds("not foo"), vec![S_NOT, S_IDENT, S_YYEOF]);
        assert_eq!(kinds("a.*"), vec![S_IDENT, S_DOT_STAR_LA, S_STAR, S_YYEOF]);
    }

    #[test]
    fn scans_literals_and_comments() {
        let out = scan("'a' --c\n-1", 0, 0);
        assert_eq!(out.symbols[0].location, TextSpan::new(0, 3));
        assert_eq!(out.line_breaks, vec![TextSpan::new(7, 1)]);
        assert_eq!(out.comments, vec![TextSpan::new(4, 3)]);
        let out = scan("'abc'  -- c", 0, 0);
        assert_eq!(out.symbols[0].location, TextSpan::new(0, 5));
        assert_eq!(out.comments, vec![TextSpan::new(7, 4)]);
        let out = scan("'a''b' ", 0, 0);
        assert_eq!(out.symbols[0].location, TextSpan::new(0, 6));
        let out = scan("/* a /* b */ c */ 1", 0, 0);
        assert_eq!(out.comments, vec![TextSpan::new(0, 17)]);
        let out = scan("'unterminated", 0, 0);
        assert_eq!(out.errors[0].location, TextSpan::new(0, 13));
        assert_eq!(out.errors[0].message, "unterminated quoted string");
    }

    #[test]
    fn scans_unterminated_literals_and_identifiers_to_the_end() {
        assert_eq!(kinds("x = 'ab"), vec![S_IDENT, S_EQUALS, S_SCONST, S_YYEOF]);
        assert_eq!(spans("x = 'ab"), vec![(0, 1), (2, 1), (4, 3), (7, 0)]);
        assert_eq!(kinds("x = b'01"), vec![S_IDENT, S_EQUALS, S_BCONST, S_YYEOF]);
        assert_eq!(kinds("x = $$ab"), vec![S_IDENT, S_EQUALS, S_DCONST, S_YYEOF]);
        assert_eq!(kinds("x = $t$ab"), vec![S_IDENT, S_EQUALS, S_DCONST, S_YYEOF]);
        // A comment remains no symbol
        let out = scan("x /* ab", 0, 0);
        assert_eq!(out.symbols.iter().map(|s| s.kind).collect::<Vec<_>>(), vec![S_IDENT, S_YYEOF]);
        assert!(out.comments.is_empty());
        assert_eq!(out.errors[0].message, "unterminated comment");
        // An identifier is named by the text after its quote
        for (text, name, message) in [
            ("from \"my t", "my t", "unterminated delimited identifier"),
            ("from \"a\"\"b", "a\"b", "unterminated delimited identifier"),
            ("from `my t", "my t", "unterminated backtick-quoted identifier"),
        ] {
            let out = scan(text, 0, 0);
            let symbol = out.symbols[1];
            assert_eq!(symbol.kind, S_IDENT, "{text}");
            assert_eq!(symbol.location, TextSpan::new(5, text.len() as u32 - 5), "{text}");
            let SymbolValue::Name(id) = symbol.value else { panic!("{text}") };
            assert_eq!(&*out.names.get(id).text, name, "{text}");
            assert_eq!(out.errors[0].message, message, "{text}");
        }
    }

    #[test]
    fn continues_bit_and_hex_strings() {
        let out = scan("x'AB' -- c\n  'CD' 1", 0, 0);
        assert_eq!(out.symbols.iter().map(|s| s.kind).collect::<Vec<_>>(), vec![S_XCONST, S_ICONST, S_YYEOF]);
        assert_eq!(out.symbols[0].location, TextSpan::new(0, 17));
        assert_eq!(out.comments, vec![TextSpan::new(6, 4)]);
        // Without a line break, the next quote starts another literal
        assert_eq!(kinds("b'01' '1'"), vec![S_BCONST, S_SCONST, S_YYEOF]);
        // Ordinary strings also continue across a line break, following Hyper.
        assert_eq!(kinds("'a'\n'b'"), vec![S_SCONST, S_YYEOF]);
    }

    #[test]
    fn records_line_breaks() {
        let out = scan("a\r\nb\rc\n'd\ne' -- f\n", 0, 0);
        let breaks: Vec<_> = out.line_breaks.iter().map(|s| (s.offset, s.length)).collect();
        assert_eq!(breaks, vec![(1, 2), (4, 1), (6, 1), (9, 1), (17, 1)]);
    }

    #[test]
    fn unescapes_quoted_identifiers() {
        let out = scan(r#"select "trailing""", """leading", "a""b", `trailing```, `` `a``b`"#, 0, 0);
        for name in ["trailing\"", "\"leading", "a\"b", "trailing`", "a`b"] {
            assert!(out.names.find(name).is_some(), "{name}");
        }
    }

    #[test]
    fn records_obfuscated_literals() {
        let out = scan("/*Integer(1A2B)*/", 0, 0);
        assert_eq!(out.symbols[0].kind, S_ICONST);
        assert_eq!(out.obfuscated_literals[0].replacement, "6699");
    }
}
