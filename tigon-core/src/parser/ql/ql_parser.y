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
%token <uint32_t>           HEX_COLOR_VALUE     "hex_color_value"
%token <int>                INTEGER_VALUE       "integer_value"

%token AREA                 "area"
%token AS                   "as"
%token BAR                  "bar"
%token BOX                  "box"
%token BUBBLE               "bubble"
%token COLUMN               "column"
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
%token GET                  "get"
%token GRID                 "grid"
%token HASH                 "hash"
%token HISTOGRAM            "histogram"
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
%token PERCENT              "percent"
%token PIE                  "pie"
%token POINT                "point"
%token POST                 "post"
%token PUT                  "put"
%token PX                   "px"
%token RGB                  "rgb"
%token RRB                  "right_round_bracket"
%token RSB                  "right_square_bracket"
%token SCALE                "scale"
%token SCATTER              "scatter"
%token SEMICOLON            "semicolon"
%token SM                   "sm"
%token STAR                 "*"
%token TABLE                "table"
%token TEXT                 "text"
%token TIME                 "time"
%token URL                  "url"
%token USING                "using"
%token WITH                 "with"
%token X                    "x"
%token XL                   "xl"
%token Y                    "y"

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
    extract_statement
 |  load_statement
 |  parameter_declaration
 |  sql_statment
 |  vis_statement
    ;

parameter_declaration:
    DECLARE PARAMETER IDENTIFIER_VALUE opt_as parameter_type {
        $$ = ParameterDeclaration()
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
    HTTP LRB load_method_http_arg_list RRB { $$ = HTTPLoader(); }
  | FILE { $$ = FileLoader(); }
    ;

load_method_http_arg_list:
    load_method_http_arg_list load_method_http_arg COMMA
  | %empty
    ;

load_method_http_arg:
    METHOD EQUAL http_method
  | URL STRING_VALUE
    ;

http_method:
    GET
 |  PUT
 |  POST
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
 |  %empty
    ;

vis_args:
    LRB vis_arg_list RRB
 |  %empty
    ;

vis_arg_list:
    vis_arg_list vis_arg
 |  %empty
    ;

vis_arg:
    AXES EQUAL LRB vis_axes_arg_list RRB
 |  COLOR EQUAL LRB vis_color_arg_list RRB
 |  LAYOUT EQUAL LRB vis_layout_arg_list RRB
    ;

vis_axes_arg_list:
    vis_axes_arg_list vis_axes_arg COMMA
 |  %empty
    ;

vis_axes_arg:
    X EQUAL vis_axis_arg_list
 |  Y EQUAL vis_axis_arg_list
    ;

vis_axis_arg_list:
    vis_axis_arg_list vis_axis_arg COMMA
 |  %empty
    ;

vis_axis_arg:
    COLUMN EQUAL IDENTIFIER_VALUE
 |  SCALE EQUAL vis_axis_scale

vis_axis_scale:
    LINEAR
 |  LOG
    ;

vis_color_arg_list:
    vis_color_arg_list vis_color_arg COMMA
 |  %empty
    ;

vis_color_arg:
    COLUMN EQUAL IDENTIFIER_VALUE
 |  PALETTE EQUAL LSB vis_color_list RSB
    ;

vis_color_list:
    vis_color_list vis_color COMMA
 |  %empty
    ;

vis_color:
    RGB LRB NUMBER_VALUE COMMA NUMBER_VALUE COMMA NUMBER_VALUE RRB
 |  HEX_COLOR_VALUE
    ;

vis_layout_arg_list:
    vis_layout_arg_list vis_layout_arg COMMA
 |  %empty
    ;

vis_layout_arg:
    ROW EQUAL NUMBER_VALUE
 |  WIDTH EQUAL LRB vis_layout_width_arg_list RRB
 |  HEIGHT EQUAL LRB vis_layout_height_arg_list RRB
    ;

vis_layout_class:
    STAR
 |  SM
 |  MD
 |  LG
 |  XL
    ;

vis_layout_width_arg_list:
    vis_layout_width_arg_list vis_layout_width_arg COMMA
 |  %empty
    ;

vis_layout_width_arg:
    vis_layout_class EQUAL NUMBER_VALUE
    ;

vis_layout_height_arg_list:
    vis_layout_height_arg_list vis_layout_height_arg COMMA
 |  %empty
    ;

vis_layout_height_arg:
    vis_layout_class EQUAL NUMBER_VALUE opt_vis_layout_unit
    ;

opt_vis_layout_unit:
    vis_layout_unit
 |  %empty
    ;

vis_layout_unit:
    PERCENT
 |  PX
    ;

%%

// Define error function
void tigon::ql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

