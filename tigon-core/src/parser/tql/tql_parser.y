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
tigon::ql::Parser::symbol_type yylex(tigon::tql::ParseContext& ctx);
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
%token COMMA                "comma"
%token CSV                  "csv"
%token DATA                 "data"
%token DATE                 "date"
%token DATETIME             "datetime"
%token DECLARE              "declare"
%token DEFINE               "define"
%token DISPLAY              "display"
%token EQUAL                "equal"
%token EXTRACT              "extract"
%token FIELD                "field"
%token FILE                 "file"
%token FLOAT                "float"
%token FROM                 "from"
%token GET                  "get"
%token GRID                 "grid"
%token HASH                 "hash"
%token HEIGHT               "height"
%token HISTOGRAM            "histogram"
%token HORIZONTAL           "horizontal"
%token HTTP                 "http"
%token INTEGER              "integer"
%token INTO                 "into"
%token JSONPATH             "jsonpath"
%token LAYOUT               "layout"
%token LG                   "lg"
%token LINE                 "line"
%token LINEAR               "linear"
%token LOAD                 "load"
%token LOG                  "log"
%token LRB                  "left_round_bracket"
%token LSB                  "left_square_bracket"
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
%token RRB                  "right_round_bracket"
%token RSB                  "right_square_bracket"
%token SCALE                "scale"
%token SCATTER              "scatter"
%token SEMICOLON            "semicolon"
%token SM                   "sm"
%token STACKED              "stacked"
%token STAR                 "*"
%token TABLE                "table"
%token TEXT                 "text"
%token TIME                 "time"
%token URL                  "url"
%token USING                "using"
%token VERTICAL             "vertical"
%token WIDTH                "width"
%token WITH                 "with"
%token X                    "x"
%token XL                   "xl"
%token Y                    "y"

%token EOF 0                "eof"

// %type <std::vector<tigon::ql::SomeDeclaration>> some_declaration_list;
// %type <tigon::ql::SomeDeclaration> some_declaration;
// %type <tigon::ql::Type> some_type;
// %type <tigon::ql::Type> some_type;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON
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
    DECLARE PARAMETER IDENTIFIER_LITERAL opt_as parameter_type
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
    LOAD IDENTIFIER_LITERAL FROM load_method
    ;

load_method:
    HTTP LRB load_method_http_arg_list RRB
  | FILE
    ;

load_method_http_arg_list:
    load_method_http_arg_list load_method_http_arg COMMA
  | %empty
    ;

load_method_http_arg:
    METHOD EQUAL http_method
  | URL STRING_LITERAL
    ;

http_method:
    GET
 |  PUT
 |  POST
    ;

extract_statement:
    EXTRACT IDENTIFIER_LITERAL FROM IDENTIFIER_LITERAL USING extract_method
    ;

extract_method:
    CSV LRB RRB
  | JSONPATH LRB RRB
    ;

display_statement:
    DISPLAY IDENTIFIER_LITERAL USING display_method_prefix_list display_method
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
    LRB display_arg_list RRB
 |  %empty
    ;

display_arg_list:
    display_arg_list display_arg
 |  %empty
    ;

display_arg:
    AXES EQUAL LRB display_axes_arg_list RRB
 |  COLOR EQUAL LRB display_color_arg_list RRB
 |  LAYOUT EQUAL LRB display_layout_arg_list RRB
    ;

display_axes_arg_list:
    display_axes_arg_list display_axes_arg COMMA
 |  %empty
    ;

display_axes_arg:
    X EQUAL display_axis_arg_list
 |  Y EQUAL display_axis_arg_list
    ;

display_axis_arg_list:
    display_axis_arg_list display_axis_arg COMMA
 |  %empty
    ;

display_axis_arg:
    COLUMN EQUAL IDENTIFIER_LITERAL
 |  SCALE EQUAL display_axis_scale

display_axis_scale:
    LINEAR
 |  LOG
    ;

display_color_arg_list:
    display_color_arg_list display_color_arg COMMA
 |  %empty
    ;

display_color_arg:
    COLUMN EQUAL IDENTIFIER_LITERAL
 |  PALETTE EQUAL LSB display_color_list RSB
    ;

display_color_list:
    display_color_list display_color COMMA
 |  %empty
    ;

display_color:
    RGB LRB INTEGER_LITERAL COMMA INTEGER_LITERAL COMMA INTEGER_LITERAL RRB
 |  HEX_COLOR_LITERAL
    ;

display_layout_arg_list:
    display_layout_arg_list display_layout_arg COMMA
 |  %empty
    ;

display_layout_arg:
    WIDTH EQUAL LRB display_layout_width_arg_list RRB
 |  HEIGHT EQUAL LRB display_layout_height_arg_list RRB
    ;

display_layout_class:
    STAR
 |  SM
 |  MD
 |  LG
 |  XL
    ;

display_layout_width_arg_list:
    display_layout_width_arg_list display_layout_width_arg COMMA
 |  %empty
    ;

display_layout_width_arg:
    display_layout_class EQUAL INTEGER_LITERAL
    ;

display_layout_height_arg_list:
    display_layout_height_arg_list display_layout_height_arg COMMA
 |  %empty
    ;

display_layout_height_arg:
    display_layout_class EQUAL INTEGER_LITERAL opt_display_layout_unit
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

