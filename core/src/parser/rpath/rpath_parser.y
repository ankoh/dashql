//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.3"

%define api.namespace {dashql::rpath}
%define api.parser.class {Parser}
%define api.prefix {rpath_}
%define api.token.constructor
%define api.token.prefix {RPATH_}
%define api.value.type variant
%define parse.assert
%define parse.trace
%define parse.error verbose
%locations

%param { dashql::rpath::ParseContext &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include "dashql/parser/rpath/rpath_parse_context.h"
}

%code {
dashql::rpath::Parser::symbol_type rpath_lex(dashql::rpath::ParseContext& ctx);

using std::get;
using std::move;
using std::vector;
}

%token <std::string_view>   IDENTIFIER_LITERAL  "identifier_literal"
%token <int>                INTEGER_LITERAL     "integer_literal"

%token INTEGER              "integer"
%token LSB                  "left_square_bracket"
%token RSB                  "right_square_bracket"
%token STAR                 "star"

%token COLON                "colon"
%token COMMA                "comma"
%token DOLLAR               "dollar"
%token DOT                  "dot"
%token DOT_DOT              "two_dots"

%token EOF 0                "eof"

%%

%start path;

path:
    DOLLAR path_component_list
 |  path_component_list
    ;

path_component_list:
    path_component_list path_component
 |  %empty
    ;

path_component:
    DOT_DOT member_access
 |  DOT member_access
 |  LSB array_access RSB
    ;

member_access:
    STAR
 |  IDENTIFIER_LITERAL
    ;

array_access:
    STAR
 |  INTEGER_LITERAL array_slice_or_indexes
 |  COLON opt_integer
 |  %empty
    ;

array_slice_or_indexes:
    COLON opt_integer
 |  COMMA integer_list
    ;

integer_list:
    integer_list INTEGER_LITERAL COMMA
 |  %empty
    ;

opt_integer:
    INTEGER_LITERAL
 |  %empty
    ;

%%

void dashql::rpath::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

