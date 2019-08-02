//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.2"

%define api.parser.class {Parser}
%define api.namespace {tigon::rpath}
%define api.value.type variant
%define api.token.constructor
%define api.token.prefix {RPATH_}
%define parse.assert
%define parse.trace
%define parse.error verbose
%locations

%param { tigon::rpath::ParseContext &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include "tigon/parser/rpath/rpath_parse_context.h"
}

%code {
tigon::rpath::Parser::symbol_type yylex(tigon::rpath::ParseContext& ctx);

using std::get;
using std::move;
using std::vector;
}

%token <std::string_view>   IDENTIFIER_LITERAL  "identifier_literal"
%token <int>                INTEGER_LITERAL     "integer_literal"

%token LSB                  "left_square_bracket"
%token RSB                  "right_square_bracket"
%token STAR                 "star"

%token EOF 0                "eof"

%%

%start record_path;

record_path:
    %empty
    ;

%%

void tigon::rpath::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

