//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.0.4"

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

// Added to the header file and parser implementation before bison definitions.
// We include string for string tokens and forward declare the parse context.
%code requires {
#include <string>
#include "tigon/parser/tql/tql_parse_context.h"
}

// Import the compiler header in the implementation file
%code {
tigon::tql::Parser::symbol_type yylex(tigon::tql::ParseContext& ctx);
}

%token <std::string_view>   SQL_SELECT          "sql_select"
%token <std::string_view>   SQL_WITH            "sql_with"
%token <std::string_view>   IDENTIFIER_LITERAL  "identifier_literal"
%token <std::string_view>   STRING_LITERAL      "string_literal"
%token <uint32_t>           HEX_COLOR_LITERAL   "hex_color_literal"
%token <int>                INTEGER_LITERAL     "integer_literal"

%token AREA                 "area"
%token AS                   "as"
%token AXES                 "axes"
%token BAR                  "bar"
%token BOX                  "box"
%token BUBBLE               "bubble"
%token CHART                "chart"
%token COLOR                "color"
%token COLUMN               "column"
%token CSV                  "csv"
%token DATE                 "date"
%token DATETIME             "datetime"
%token DECLARE              "declare"
%token DISPLAY              "display"
%token EXTRACT              "extract"
%token FIELD                "field"
%token FILE                 "file"
%token FLOAT                "float"
%token FROM                 "from"
%token GET                  "get"
%token GRID                 "grid"
%token HEIGHT               "height"
%token HISTOGRAM            "histogram"
%token HORIZONTAL           "horizontal"
%token HTTP                 "http"
%token INTEGER              "integer"
%token JSONPATH             "jsonpath"
%token LAYOUT               "layout"
%token LG                   "lg"
%token LINE                 "line"
%token LINEAR               "linear"
%token LOAD                 "load"
%token LOG                  "log"
%token MD                   "md"
%token METHOD               "method"
%token NUMBER               "number"
%token PALETTE              "palette"
%token PARAMETER            "parameter"
%token PERCENT              "percent"
%token PIE                  "pie"
%token PLOT                 "plot"
%token POINT                "point"
%token POST                 "post"
%token PUT                  "put"
%token PX                   "px"
%token RGB                  "rgb"
%token ROW                  "row"
%token SCALE                "scale"
%token SCATTER              "scatter"
%token SM                   "sm"
%token STACKED              "stacked"
%token STAR                 "*"
%token TABLE                "table"
%token TEXT                 "text"
%token TICK                 "'"
%token TIME                 "time"
%token URL                  "url"
%token USING                "using"
%token VERTICAL             "vertical"
%token WIDTH                "width"
%token XL                   "xl"

%token EOF 0                "eof"

// %type <std::vector<tigon::tql::SomeDeclaration>> some_declaration_list;
// %type <tigon::tql::SomeDeclaration> some_declaration;
// %type <tigon::tql::Type> some_type;
// %type <tigon::tql::Type> some_type;

%%

%start statement_list;

statement_list:
    statement_list statement ';'
 |  %empty
    ;

statement:
    extract_statement
 |  display_statement
 |  load_statement
 |  parameter_declaration
 |  sql_statement
    ;

parameter_declaration:
    DECLARE PARAMETER identifier opt_as parameter_type
    ;

identifier:
    IDENTIFIER_LITERAL
 |  '\''  STRING_LITERAL '\''
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
    LOAD identifier FROM load_method
    ;

load_method:
    HTTP '(' load_method_http_arg_list ')'
  | FILE
    ;

load_method_http_arg_list:
    load_method_http_arg_list load_method_http_arg ','
  | %empty
    ;

load_method_http_arg:
    METHOD '=' http_method
  | URL STRING_LITERAL
    ;

http_method:
    GET
 |  PUT
 |  POST
    ;

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method
    ;

extract_method:
    CSV '(' ')'
  | JSONPATH '(' ')'
    ;

display_statement:
    DISPLAY identifier USING display_method_prefix_list display_method
    ;

display_method_prefix_list:
    display_method_prefix_list display_method_prefix
 |  %empty
    ;

display_method_prefix:
    HORIZONTAL
 |  VERTICAL
 |  STACKED
    ;

display_method:
    AREA opt_plot display_args
 |  BAR opt_plot display_args
 |  BOX opt_plot display_args
 |  BUBBLE opt_plot display_args
 |  GRID display_args
 |  HISTOGRAM opt_plot display_args
 |  LINE opt_plot display_args
 |  NUMBER opt_field display_args
 |  PIE opt_plot display_args
 |  POINT opt_plot display_args
 |  SCATTER opt_plot display_args
 |  TABLE display_args
 |  TEXT opt_field display_args
    ;

opt_plot:
    PLOT
 |  CHART
 |  %empty
    ;

opt_field:
    FIELD
 |  %empty
    ;

display_args:
    '(' display_arg_list ')'
 |  %empty
    ;

display_arg_list:
    display_arg_list display_arg
 |  %empty
    ;

display_arg:
    AXES '=' '(' display_axes_arg_list ')'
 |  COLOR '=' '(' display_color_arg_list ')'
 |  LAYOUT '=' '(' display_layout_arg_list ')'
    ;

display_axes_arg_list:
    display_axes_arg_list display_axes_arg ','
 |  %empty
    ;

display_axes_arg:
    'x' '=' display_axis_arg_list
 |  'y' '=' display_axis_arg_list
    ;

display_axis_arg_list:
    display_axis_arg_list display_axis_arg ','
 |  %empty
    ;

display_axis_arg:
    COLUMN '=' identifier
 |  SCALE '=' display_axis_scale

display_axis_scale:
    LINEAR
 |  LOG
    ;

display_color_arg_list:
    display_color_arg_list display_color_arg ','
 |  %empty
    ;

display_color_arg:
    COLUMN '=' identifier
 |  PALETTE '=' '[' display_color_list ']'
    ;

display_color_list:
    display_color_list display_color ','
 |  %empty
    ;

display_color:
    RGB '(' INTEGER_LITERAL ',' INTEGER_LITERAL ',' INTEGER_LITERAL ')'
 |  HEX_COLOR_LITERAL
    ;

display_layout_arg_list:
    display_layout_arg_list display_layout_arg ','
 |  %empty
    ;

display_layout_arg:
    WIDTH '=' '(' display_layout_width_arg_list ')'
 |  HEIGHT '=' '(' display_layout_height_arg_list ')'
    ;

display_layout_class:
    STAR
 |  SM
 |  MD
 |  LG
 |  XL
    ;

display_layout_width_arg_list:
    display_layout_width_arg_list display_layout_width_arg ','
 |  %empty
    ;

display_layout_width_arg:
    display_layout_class '=' INTEGER_LITERAL
    ;

display_layout_height_arg_list:
    display_layout_height_arg_list display_layout_height_arg ','
 |  %empty
    ;

display_layout_height_arg:
    display_layout_class '=' INTEGER_LITERAL opt_display_layout_unit
    ;

opt_display_layout_unit:
    display_layout_unit
 |  %empty
    ;

display_layout_unit:
    PERCENT
 |  PX
    ;

%%

// Define error function
void tigon::tql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

