//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.2"

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
#include <cstdlib>
#include "tigon/parser/tql/tql_parse_context.h"
}

// Import the compiler header in the implementation file
%code {
tigon::tql::Parser::symbol_type yylex(tigon::tql::ParseContext& ctx);

using D = tigon::tql::DisplayStatement;
using std::get;
using std::move;
using std::vector;
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

%type <DisplayStatement::AxisScale> display_axis_scale;
%type <std::string_view> identifier;
%type <std::vector<DisplayStatement::RGBColor>> display_color_list;
%type <DisplayStatement::RGBColor> display_color_value;
%type <DisplayStatement::SizeClass> display_size_class;
%type <std::tuple<DisplayStatement::SizeClass, uint32_t, DisplayStatement::LengthUnit>> display_layout_length_field;
%type <DisplayStatement::LengthUnit> opt_display_layout_unit;
%type <DisplayStatement::LengthUnit> display_layout_unit;

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
    IDENTIFIER_LITERAL  { $$ = $1; }
 |  STRING_LITERAL      { $$ = $1; }
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
    HTTP '(' load_method_http_field_list ')'
  | FILE
    ;

load_method_http_field_list:
    load_method_http_field_list load_method_http_field ','
  | %empty
    ;

load_method_http_field:
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
    AREA opt_plot display_fields
 |  BAR opt_plot display_fields
 |  BOX opt_plot display_fields
 |  BUBBLE opt_plot display_fields
 |  GRID display_fields
 |  HISTOGRAM opt_plot display_fields
 |  LINE opt_plot display_fields
 |  NUMBER opt_field display_fields
 |  PIE opt_plot display_fields
 |  POINT opt_plot display_fields
 |  SCATTER opt_plot display_fields
 |  TABLE display_fields
 |  TEXT opt_field display_fields
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

display_fields:
    '(' display_field_list ')'
 |  %empty
    ;

display_field_list:
    display_field_list display_field
 |  %empty
    ;

display_field:
    AXES '=' '(' display_axes ')'
 |  COLOR '=' '(' display_color ')'
 |  LAYOUT '=' '(' display_layout ')'
    ;

display_axes:
    display_axes ',' display_axes_field
 |  display_axes_field
    ;

display_axes_field:
    'x' '=' '(' display_axis ')' { ctx.cache<D>()->axes.x = move(ctx.cache<D::Axis>()); }
 |  'y' '=' '(' display_axis ')' { ctx.cache<D>()->axes.y = move(ctx.cache<D::Axis>()); }
    ;

display_axis:
    display_axis ',' display_axis_field
 |  display_axis_field
    ;

display_axis_field:
    COLUMN '=' identifier        { ctx.cache<D::Axis>()->column = move($3); }
 |  SCALE '=' display_axis_scale { ctx.cache<D::Axis>()->scale = move($3); }
    ;

display_axis_scale:
    LINEAR { $$ = D::AxisScale::Linear; }
 |  LOG    { $$ = D::AxisScale::Logarithmic; }
    ;

display_color:
    display_color ',' display_color_field
 |  %empty
    ;

display_color_field:
    COLUMN '=' identifier                  { ctx.cache<D>()->color.column = move($3); }
 |  PALETTE '=' '[' display_color_list ']' { ctx.cache<D>()->color.palette = move($4); }
    ;

display_color_list:
    display_color_list display_color_value ',' { $1.push_back($2); $$ = move($1); }
 |  %empty { $$ = vector<D::RGBColor>(); }
    ;

display_color_value:
    RGB '(' INTEGER_LITERAL ',' INTEGER_LITERAL ',' INTEGER_LITERAL ')' {
        $$ = D::RGBColor{
            static_cast<uint8_t>($3),
            static_cast<uint8_t>($5),
            static_cast<uint8_t>($7)
        };
    }
 |  HEX_COLOR_LITERAL { $$ = D::RGBColor{$1}; }
    ;

display_layout:
    display_layout ',' display_layout_field
 |  display_layout_field
    ;

display_layout_field:
    WIDTH '=' '(' display_layout_length ')'  { ctx.cache<D>()->layout.width = move(ctx.cache<D::LayoutLength>()); }
 |  HEIGHT '=' '(' display_layout_length ')' { ctx.cache<D>()->layout.height = move(ctx.cache<D::LayoutLength>()); }
    ;

display_size_class:
    '*' { $$ = D::SizeClass::Wildcard; }
 |  SM  { $$ = D::SizeClass::Small; }
 |  MD  { $$ = D::SizeClass::Medium; }
 |  LG  { $$ = D::SizeClass::Large; }
 |  XL  { $$ = D::SizeClass::ExtraLarge; }
    ;

display_layout_length:
    display_layout_length ',' display_layout_length_field {
        ctx.setLayoutLengthField(get<0>($3), get<1>($3), get<2>($3));
    }
 |  display_layout_length_field {
        ctx.setLayoutLengthField(get<0>($1), get<1>($1), get<2>($1));
    }
    ;

display_layout_length_field:
    display_size_class '=' INTEGER_LITERAL opt_display_layout_unit { $$ = {$1, $3, $4}; }
    ;

opt_display_layout_unit:
    display_layout_unit { $$ = $1; }
 |  %empty              { $$ = D::LengthUnit::Span; }
    ;

display_layout_unit:
    PERCENT { $$ = D::LengthUnit::Percent; }
 |  PX      { $$ = D::LengthUnit::Pixel; }
    ;

%%

// Define error function
void tigon::tql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

