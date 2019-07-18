// ---------------------------------------------------------------------------------------------------
// Tigon
// ---------------------------------------------------------------------------------------------------
%skeleton "lalr1.cc"
%require "3.0.4"
// ---------------------------------------------------------------------------------------------------
// Write a parser header file
%defines
// Define the parser class name
%define parser_class_name {Parser}
// Create the parser in our namespace
%define api.namespace {tigon::ql}
// Use C++ variant to store the values and get better type warnings (compared to "union")
%define api.value.type variant
// With variant-based values, symbols are handled as a whole in the scanner
%define api.token.constructor
// Prefix all tokens
%define api.token.prefix {TQL_}
// Check if variants are constructed and destroyed properly
%define parse.assert
// Trace the parser
%define parse.trace
// Use verbose parser errors
%define parse.error verbose
// Enable location tracking.
%locations
// Pass the compiler as parameter to yylex/yyparse.
%param { tigon::ql::ParseContext &ctx }
// ---------------------------------------------------------------------------------------------------
// Added to the header file and parser implementation before bison definitions.
// We include string for string tokens and forward declare the parse context.
%code requires {
#include <string>
#include "tigon/parser/ql/ql_parse_context.h"
}
// ---------------------------------------------------------------------------------------------------
// Import the compiler header in the implementation file
%code {
tigon::ql::Parser::symbol_type yylex(tigon::ql::ParseContext& ctx);
}
// ---------------------------------------------------------------------------------------------------
// Token definitions
%token <std::string_view>   SQL_STATEMENT "sql_statement"
%token <std::string_view>   IDENTIFIER    "identifier"

%token SEMICOLON            "semicolon"

%token LRB                  "left_round_brackets"
%token RRB                  "right_round_brackets"
%token LOAD                 "load"
%token EXTRACT              "extract"
%token AS                   "as"
%token INTO                 "into"
%token FROM                 "from"
%token JSONPATH             "jsonpath"
%token HTTP                 "http"
%token FILE                 "file"
%token DATA                 "data"
%token WITH                 "with"
%token USING                "using"
%token DECLARE              "declare"
%token DEFINE               "define"

%token <int>                INTEGER_VALUE    "integer_value"
%token INTEGER              "integer"
%token CHAR                 "char"
%token COMMA                "comma"
%token FOO                  "foo"
%token BAR                  "bar"

%token EOF 0                "eof"
// ---------------------------------------------------------------------------------------------------
%type <std::vector<tigon::ql::SomeDeclaration>> some_declaration_list;
%type <tigon::ql::SomeDeclaration> some_declaration;
%type <tigon::ql::Type> some_type;
// ---------------------------------------------------------------------------------------------------
%%

%start ql_statement_list;

ql_statement_list:
    ql_statement_list ql_statement SEMICOLON
 |  %empty
    ;

ql_statement:
    declaration         { std::swap($$, $1); }
 |  definition          { std::swap($$, $1); }
 |  load_statement      { std::swap($$, $1); }
 |  extract_statement   { std::swap($$, $1); }
    ;

declaration:
    DECLARE PARAMETER IDENTIFIER opt_as parameter_type {
        $$ = Declaration()
    }
    ;

opt_as:
    AS
 |  %empty
    ;

parameter_type:
    INTEGER
 |  FLOAT
 |  TEXT
 |  DATE
 |  DATETIME
 |  TIME
    ;

definition:
    DEFINE OUTPUT AS SQL_STATEMENT
    ;

load_statement:
    LOAD IDENTIFIER FROM load_method { $$ = LoadStatement(); }
    ;

load_method:
    HTTP LRB RRB { $$ = HTTPLoader(); }
  | FILE LRB RRB { $$ = FileLoader(); }
    ;

extract_statement:
    EXTRACT IDENTIFIER FROM IDENTIFIER USING extract_method {
        $$ = ExtractStatement();
    }
    ;

extract_method:
    CSV LRB RRB { $$ = CSVExtractor(); }
  | JSONPATH LRB RRB { $$ = JSONPathExtractor(); }
    ;

%%
// ---------------------------------------------------------------------------------------------------
// Define error function
void tigon::ql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}
// ---------------------------------------------------------------------------------------------------

