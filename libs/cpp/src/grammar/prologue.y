// Copyright (c) 2020 The DashQL Authors

%skeleton "lalr1.cc"
%require "3.3"

%define api.namespace {dashql::parser}
%define api.parser.class {Parser}
%define api.token.constructor
%define api.token.prefix {DQL_}
%define api.value.type variant
%define parse.assert
%define parse.trace
%define parse.error verbose

%locations
%define api.location.type {sx::Location}

%parse-param    { dashql::parser::ParserDriver& ctx }

// ---------------------------------------------------------------------------
// HEADER

%code requires {
#include <string>
#include <cstdlib>
#include <utility>
#include "dashql/parser/parser_driver.h"

#define YYLLOC_DEFAULT(Cur, Rhs, N) { \
    if (N) { \
        uint32_t o = YYRHSLOC(Rhs, 1).offset(); \
        uint32_t l = YYRHSLOC(Rhs, N).offset() + YYRHSLOC(Rhs, N).length() - YYRHSLOC(Rhs, 1).offset(); \
        (Cur) = sx::Location(o, l); \
    } else { \
        uint32_t o = YYRHSLOC(Rhs, 0).offset() + YYRHSLOC(Rhs, 0).length(); \
        uint32_t l = 0; \
        (Cur) = sx::Location(o, l); \
    } \
}
}


// ---------------------------------------------------------------------------
// IMPLEMENTATION

%code {
#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/grammar/nodes.h"
#include "dashql/parser/scanner.h"

#undef yylex
#define yylex ctx.scanner().Next

using namespace dashql::parser;
}

// ---------------------------------------------------------------------------
// TOKENS

/*
 * Non-keyword token types.  These are hard-wired into the "flex" lexer.
 * They must be listed first so that their numeric codes do not depend on
 * the set of keywords.  PL/pgSQL depends on this so that it can share the
 * same lexer.  If you add/change tokens here, fix PL/pgSQL to match!
 *
 * UIDENT and USCONST are reduced to IDENT and SCONST in parser.c, so that
 * they need no productions here; but we must assign token codes to them.
 *
 * DOT_DOT is unused in the core SQL grammar, and so will always provoke
 * parse errors.  It is needed by PL/pgSQL.
 */
%token              IDENT UIDENT FCONST SCONST USCONST BCONST XCONST Op
%token              ICONST PARAM
%token              TYPECAST DOT_DOT COLON_EQUALS EQUALS_GREATER
%token              LESS_EQUALS GREATER_EQUALS NOT_EQUALS

%token<bool> BOOLEAN_LITERAL    "boolean literal"
%token IDENTIFIER               "identifier literal"
%token STRING_LITERAL           "string literal"

%token EOF 0

/*
 * The grammar thinks these are keywords, but they are not in the kwlist.h
 * list and so can never be entered directly.  The filter in parser.c
 * creates these tokens when required (based on looking one token ahead).
 *
 * NOT_LA exists so that productions such as NOT LIKE can be given the same
 * precedence as LIKE; otherwise they'd effectively have the same precedence
 * as NOT, at least with respect to their left-hand subexpression.
 * NULLS_LA and WITH_LA are needed to make the grammar LALR(1).
 */
%token        NOT_LA NULLS_LA WITH_LA
