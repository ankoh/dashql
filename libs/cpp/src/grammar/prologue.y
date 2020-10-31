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

%lex-param      { dashql::parser::ParserDriver& ctx }
%parse-param    { dashql::parser::ParserDriver &ctx }

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

%code {
using namespace dashql::parser;

Parser::symbol_type yylex(ParserDriver& ctx);
}
