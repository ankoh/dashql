// ---------------------------------------------------------------------------------------------------
// Tigon
// ---------------------------------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.0.4"

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
%define api.token.prefix {QL_}
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

// Added to the header file and parser implementation before bison definitions.
// We include string for string tokens and forward declare the parse context.
%code requires {
#include <string>
#include "tigon/parser/ql/ql_parse_context.h"
}

// Import the compiler header in the implementation file
%code {
tigon::ql::Parser::symbol_type yylex(tigon::ql::ParseContext& ctx);
}

%token <std::string_view>   SQL_SELECT          "sql_select"
%token <std::string_view>   SQL_WITH            "sql_with"
%token <std::string_view>   IDENTIFIER_VALUE    "identifier_value"
%token <int>                INTEGER_VALUE       "integer_value"

%token AREA                 "area"
%token AS                   "as"
%token BAR                  "bar"
%token BOX                  "box"
%token BUBBLE               "bubble"
%token COMMA                "comma"
%token DATA                 "data"
%token DATE                 "date"
%token DATETIME             "datetime"
%token DECLARE              "declare"
%token DEFINE               "define"
%token EQUAL                "equal"
%token EXTRACT              "extract"
%token FILE                 "file"
%token FLOAT                "float"
%token FROM                 "from"
%token GRID                 "grid"
%token HISTOGRAM            "histogram"
%token HTTP                 "http"
%token INTEGER              "integer"
%token INTO                 "into"
%token JSONPATH             "jsonpath"
%token LINE                 "line"
%token LOAD                 "load"
%token LRB                  "left_round_bracket"
%token LSB                  "left_square_bracket"
%token NUMBER               "number"
%token PIE                  "pie"
%token POINT                "point"
%token RRB                  "right_round_bracket"
%token RSB                  "right_square_bracket"
%token SCATTER              "scatter"
%token SEMICOLON            "semicolon"
%token TABLE                "table"
%token TEXT                 "text"
%token TIME                 "time"
%token USING                "using"
%token WITH                 "with"

%token EOF 0                "eof"

%type <std::vector<tigon::ql::SomeDeclaration>> some_declaration_list;
%type <tigon::ql::SomeDeclaration> some_declaration;
%type <tigon::ql::Type> some_type;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON
 |  %empty
    ;

statement:
    parameter_declaration
 |  load_statement
 |  extract_statement
 |  vis_statement
    ;

parameter_declaration:
    DECLARE PARAMETER IDENTIFIER_VALUE opt_as parameter_type {
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

sql_statement:
    SQL_SELECT
 |  SQL_WITH
    ;

load_statement:
    LOAD IDENTIFIER_VALUE FROM load_method { $$ = LoadStatement(); }
    ;

load_method:
    HTTP LRB RRB { $$ = HTTPLoader(); }
  | FILE LRB RRB { $$ = FileLoader(); }
    ;

extract_statement:
    EXTRACT IDENTIFIER_VALUE FROM IDENTIFIER_VALUE USING extract_method {
        $$ = ExtractStatement();
    }
    ;

extract_method:
    CSV LRB RRB { $$ = CSVExtractor(); }
  | JSONPATH LRB RRB { $$ = JSONPathExtractor(); }
    ;

vis_statement:
    VISUALIZE IDENTIFIER_VALUE USING vis_method
    ;

vis_method_prefix_list:
    vis_method_prefix_list vis_method_prefix
 |  %empty
    ;

vis_method_prefix:
    HORIZONTAL
 |  VERTICAL
 |  STACKED
    ;

vis_method:
    AREA opt_plot vis_args
 |  BAR opt_plot vis_args
 |  BOX opt_plot vis_args
 |  BUBBLE opt_plot vis_args
 |  GRID vis_args
 |  HISTOGRAM opt_plot vis_args
 |  LINE opt_plot vis_args
 |  NUMBER opt_field vis_args
 |  PIE opt_plot vis_args
 |  POINT opt_plot vis_args
 |  SCATTER opt_plot vis_args
 |  TABLE vis_args
 |  TEXT opt_field vis_args
    ;

opt_plot:
    PLOT
 |  CHART
 |  %empty
    ;

opt_field:
    FIELD
    ;

vis_args:
    LRB vis_arg_list RRB
 |  %empty
    ;

%%

// Define error function
void tigon::ql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

