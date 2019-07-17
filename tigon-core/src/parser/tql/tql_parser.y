// ---------------------------------------------------------------------------------------------------
// TIGON
// ---------------------------------------------------------------------------------------------------
%skeleton "lalr1.cc"
%require "3.0.4"
// ---------------------------------------------------------------------------------------------------
// Write a parser header file
%defines
// Define the parser class name
%define parser_class_name {Parser}
// Create the parser in our namespace
%define api.namespace {tigon::tql}
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
%param { tigon::tql::ParseContext &ctx }
// ---------------------------------------------------------------------------------------------------
// Added to the header file and parser implementation before bison definitions.
// We include string for string tokens and forward declare the parse context.
%code requires {
#include <string>
#include "tigon/parser/tql/tql_parse_context.h"
}
// ---------------------------------------------------------------------------------------------------
// Import the compiler header in the implementation file
%code {
tigon::tql::Parser::symbol_type yylex(tigon::tql::ParseContext& ctx);
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
%type <std::vector<tigon::tql::SomeDeclaration>> some_declaration_list;
%type <tigon::tql::SomeDeclaration> some_declaration;
%type <tigon::tql::Type> some_type;
// ---------------------------------------------------------------------------------------------------
%%

%start tql_statement_list;

tql_statement_list:
    tql_statement_list tql_statement SEMICOLON
 |  %empty
    ;

tql_statement:
    SQL_STATEMENT       { std::swap($$, $1); }
 |  declaration         { std::swap($$, $1); }
 |  load_statement      { std::swap($$, $1); }
 |  extract_statement   { std::swap($$, $1); }
    ;

parameter_type:
    INTEGER
 |  FLOAT
 |  TEXT
 |  DATE
 |  DATETIME
 |  TIME
    ;

declaration:
    DECLARE input_or_output_declaration
    ;

input_or_output_declaration:
    INPUT input_declaration
 |  OUTPUT output_declaration
    ;

input_declaration:
    PARAMETER IDENTIFIER opt_as parameter_type { $$ = Declaration() }
 |  DATA IDENTIFIER { $$ = Declaration() }
    ;

output_declaration:
    VIEW IDENTIFIER
    ;

opt_as:
    AS
 |  %empty
    ;

load_statement:
    LOAD IDENTIFIER FROM load_method { $$ = LoadStatement(); }
    ;

load_method:
    HTTP LRB RRB { $$ = LoadMethod(); }
  | FILE LRB RRB { $$ = LoadMethod(); }
    ;

extract_statement:
    EXTRACT IDENTIFIER extract_argument_list { $$ = ExtractStatement(); }
    ;

extract_argument_list:
    extract_argument_list extract_argument
  | %empty
    ;

extract_argument:
    INTO IDENTIFIER { $$ = ExtractIdentifier() }
  | USING extract_method { std::swap($$, $1); }
    ;

extract_method:
    CSV LRB RRB { $$ = CSVExtraction(); }
  | JSONPATH LRB RRB { $$ = JSONPathExtraction(); }
    ;

%%
// ---------------------------------------------------------------------------------------------------
// Define error function
void tigon::tql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}
// ---------------------------------------------------------------------------------------------------

