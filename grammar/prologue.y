// The grammar of DashQL, assembled by grammar/assemble_grammar.py.
// Emitted through //grammar/rust:tables.rs.m4, the actions run in dashql_parser::parser.

%code use {
use crate::parser::actions::*;
}

%define api.token.raw true
%define api.rust.context {ParseContext}
%define api.rust.location {SymbolSpan}

%require "3.3"

// ---------------------------------------------------------------------------
// TOKENS

// The tokens that are no keywords, the scanner emits them. They come first, so their symbol kinds don't depend on the
// keyword lists.

%token<NameId> IDENT   "identifier literal"
%token         SCONST  "string literal"
%token         DCONST  "dollar-quoted string"
%token         Op
%token         FCONST BCONST XCONST
%token         ICONST PARAM
%token         TYPECAST DOT DOT_DOT DOT_TRAILING COLON_EQUALS EQUALS_GREATER
%token         LESS_EQUALS GREATER_EQUALS NOT_EQUALS
%token         COMPLETE_HERE

%token         LRB RRB LSB RSB LCB RCB STAR COMMA COLON QUESTION_MARK DOLLAR SEMICOLON
%token         MINUS PLUS DIVIDE MODULO
%token         LESS_THAN GREATER_THAN EQUALS
%token         CIRCUMFLEX AMPERSAND PIPE EXCLAMATION_MARK
%token         RAW_CHAR

%token EOF 0


// The lookahead tokens: no keyword list has them, the lookahead filter of the scanner (`next_symbol` in scanner.rs)
// emits them for a keyword or a dot by the tokens after it, and `classify_quantified_operators` emits QUANTIFIED_OP and
// QUANTIFIED_OPERATOR for the operator of a quantified comparison, `a ~ any (...)`. See "Lookahead rewrites" in
// docs/design/core_parser.md.
//
// NOT_LA exists so that productions such as NOT LIKE can be given the same precedence as LIKE; otherwise they'd
// effectively have the same precedence as NOT, at least with respect to their left-hand subexpression. The others make
// the grammar LALR(1).
%token        NOT_LA NULLS_LA WITH_LA DOT_STAR_LA

%token ARRAY_LA WITHOUT_LA WITH_OPTIONS_LA SEMI_JOIN_LA ANTI_JOIN_LA

%token QUANTIFIED_OP QUANTIFIED_OPERATOR
