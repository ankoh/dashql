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
%define api.location.type {Location}

%lex-param      { dashql::parser::ParserDriver& ctx }
%parse-param    { dashql::parser::ParserDriver &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include <utility>
#include "dashql/parser/parser_driver.h"

#define YYLLOC_DEFAULT(Cur, Rhs, N) { \
    if (N) { \
        (Cur).offset = YYRHSLOC(Rhs, 1).offset; \
        (Cur).length = YYRHSLOC(Rhs, N).offset - YYRHSLOC(Rhs, 1).offset + YYRHSLOC(Rhs, N).length; \
    } else { \
        (Cur).offset = YYRHSLOC(Rhs, 0).offset + YYRHSLOC(Rhs, 0).length; \
        (Cur).length = 0; \
    } \
}

namespace syntax = dashql::proto::syntax;

using Attr = syntax::Attribute;
using AttrKey = syntax::AttributeKey;
using Value = syntax::Value;
using ValueType = syntax::ValueType;
using ParamType = syntax::ParameterType;
using LoadMethodType = syntax::LoadMethodType;
using HTTPVerb = syntax::HTTPVerb;
using HTTP = syntax::HTTPVerb;
using VizType = syntax::VizType;

}

%code {
using namespace dashql::parser;

Parser::symbol_type yylex(ParserDriver& ctx);
}

