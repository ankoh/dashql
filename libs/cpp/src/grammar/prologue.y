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
%define api.location.type {syntax::Location}

%lex-param      { dashql::parser::ParseContext& ctx }
%parse-param    { dashql::parser::ParseContext &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include <utility>
#include "dashql/parser/parse_context.h"

#define YYLLOC_DEFAULT(Cur, Rhs, N) { \
    if (N) { \
        uint32_t o = YYRHSLOC(Rhs, 1).offset(); \
        uint32_t l = YYRHSLOC(Rhs, N).offset() - YYRHSLOC(Rhs, 1).offset() + YYRHSLOC(Rhs, N).length(); \
        (Cur) = syntax::Location(o, l); \
    } else { \
        uint32_t o = YYRHSLOC(Rhs, 0).offset() + YYRHSLOC(Rhs, 0).length(); \
        uint32_t l = 0; \
        (Cur) = syntax::Location(o, l); \
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

Parser::symbol_type yylex(ParseContext& ctx);
}
