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
using L = tigon::tql::LoadStatement;
using P = tigon::tql::ParameterDeclaration;
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

%token SEMICOLON            "semicolon"
%token LRB                  "left_round_bracket"
%token RRB                  "right_round_bracket"
%token LSB                  "left_square_bracket"
%token RSB                  "right_square_bracket"
%token EQUAL                "equal"
%token COMMA                "comma"
%token STAR                 "star"

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
%token SCALE                "scale"
%token SCATTER              "scatter"
%token SM                   "sm"
%token STACKED              "stacked"
%token TABLE                "table"
%token TEXT                 "text"
%token TIME                 "time"
%token URL                  "url"
%token USING                "using"
%token VERTICAL             "vertical"
%token WIDTH                "width"
%token X                    "x"
%token XL                   "xl"
%token Y                    "y"

%token EOF 0                "eof"

%type <DisplayStatement::AxisScale> display_axis_scale;
%type <DisplayStatement::LengthUnit> display_layout_unit;
%type <DisplayStatement::LengthUnit> opt_display_layout_unit;
%type <DisplayStatement::RGBColor> display_color_value;
%type <DisplayStatement::SizeClass> display_size_class;
%type <DisplayStatement::Type> display_method;
%type <DisplayStatement::TypeFlag> display_method_prefix;
%type <LoadStatement::HTTPLoader::Method> http_method;
%type <Statement> statement;
%type <Type> type;
%type <std::string_view> identifier;
%type <std::string_view> sql_statement;
%type <std::tuple<DisplayStatement::SizeClass, uint32_t, DisplayStatement::LengthUnit>> display_layout_length_field;
%type <std::unique_ptr<DisplayStatement>> display_statement;
%type <std::unique_ptr<LoadStatement>> load_statement;
%type <std::unique_ptr<ParameterDeclaration>> parameter_declaration;
%type <std::vector<DisplayStatement::RGBColor>> display_color_list;
%type <std::vector<DisplayStatement::RGBColor>> opt_display_color_list;
%type <std::vector<Statement>> statement_list;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { $$ = move($1); $$.push_back(move($2)); }
 |  %empty                              { $$ = vector<Statement>{}; }
    ;

statement:
    extract_statement     { $$ = Statement { std::make_unique<ExtractStatement>() }; }
 |  display_statement     { $$ = Statement { move($1) }; }
 |  load_statement        { $$ = Statement { move($1) }; }
 |  parameter_declaration { $$ = Statement { move($1) }; }
 |  sql_statement         { $$ = Statement { std::make_unique<SQLStatement>() }; }
    ;

parameter_declaration:
    DECLARE PARAMETER identifier opt_as type {
        auto& p = ctx.cached<P>();
        p->name = $3;
        p->type = $5;
        $$ = move(p);
    }
    ;

identifier:
    IDENTIFIER_LITERAL  { $$ = $1; }
 |  STRING_LITERAL      { $$ = $1; }
    ;

opt_as:
    AS
 |  %empty
    ;

type:
    INTEGER   { $$ = Type::Integer; }
 |  FLOAT     { $$ = Type::Float; }
 |  TEXT      { $$ = Type::Text; }
 |  DATE      { $$ = Type::Date; }
 |  DATETIME  { $$ = Type::DateTime; }
 |  TIME      { $$ = Type::Time; }
    ;

sql_statement:
    SQL_SELECT { $$ = $1; }
 |  SQL_WITH   { $$ = $1; }
    ;

load_statement:
    LOAD identifier FROM load_method {
        auto& l = ctx.cached<L>();
        l->name = $2;
        $$ = move(l);
    }
    ;

load_method:
    HTTP LRB load_method_http_field_list RRB { ctx.cached<L>()->method = move(ctx.cached<L::HTTPLoader>()); }
  | FILE { ctx.cached<L>()->method = move(ctx.cached<L::FileLoader>()); }
    ;

load_method_http_field_list:
    load_method_http_field_list COMMA load_method_http_field
  | load_method_http_field
    ;

load_method_http_field:
    METHOD EQUAL http_method { ctx.cached<L::HTTPLoader>()->method = $3; }
  | URL EQUAL STRING_LITERAL { ctx.cached<L::HTTPLoader>()->url = $3; }
    ;

http_method:
    GET  { $$ = L::HTTPLoader::Method::Get; }
 |  PUT  { $$ = L::HTTPLoader::Method::Put; }
 |  POST { $$ = L::HTTPLoader::Method::Post; }
    ;

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method
    ;

extract_method:
    CSV LRB RRB
  | JSONPATH LRB RRB
    ;

display_statement:
    DISPLAY identifier USING display_method_prefix_list display_method {
        auto& d = ctx.cached<D>();
        d->target = $2;
        d->type = $5;
        $$ = move(d);
    }
    ;

display_method_prefix_list:
    display_method_prefix_list display_method_prefix {
        ctx.cached<D>()->type_flags |= static_cast<uint64_t>($2);
    }
 |  %empty
    ;

display_method_prefix:
    HORIZONTAL { $$ = D::TypeFlag::Horizontal; }
 |  VERTICAL   { $$ = D::TypeFlag::Vertical; }
 |  STACKED    { $$ = D::TypeFlag::Stacked; }
    ;

display_method:
    AREA opt_plot opt_display_fields      { $$ = D::Type::Area; }
 |  BAR opt_plot opt_display_fields       { $$ = D::Type::Bar; }
 |  BOX opt_plot opt_display_fields       { $$ = D::Type::Box; }
 |  BUBBLE opt_plot opt_display_fields    { $$ = D::Type::Bubble; }
 |  GRID opt_display_fields               { $$ = D::Type::Grid; }
 |  HISTOGRAM opt_plot opt_display_fields { $$ = D::Type::Histogram; }
 |  LINE opt_plot opt_display_fields      { $$ = D::Type::Line; }
 |  NUMBER opt_field opt_display_fields   { $$ = D::Type::Number; }
 |  PIE opt_plot opt_display_fields       { $$ = D::Type::Pie; }
 |  POINT opt_plot opt_display_fields     { $$ = D::Type::Point; }
 |  SCATTER opt_plot opt_display_fields   { $$ = D::Type::Scatter; }
 |  TABLE opt_display_fields              { $$ = D::Type::Table; }
 |  TEXT opt_field opt_display_fields     { $$ = D::Type::Text; }
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

opt_display_fields:
    LRB display_fields RRB
 |  %empty
    ;

display_fields:
    display_fields COMMA display_field
 |  display_field
    ;

display_field:
    AXES EQUAL LRB display_axes RRB
 |  COLOR EQUAL LRB display_color RRB
 |  LAYOUT EQUAL LRB display_layout RRB
    ;

display_axes:
    display_axes COMMA display_axes_field
 |  display_axes_field
    ;

display_axes_field:
    X EQUAL LRB display_axis RRB { ctx.cached<D>()->axes.x = move(ctx.cached<D::Axis>()); }
 |  Y EQUAL LRB display_axis RRB { ctx.cached<D>()->axes.y = move(ctx.cached<D::Axis>()); }
    ;

display_axis:
    display_axis COMMA display_axis_field
 |  display_axis_field
    ;

display_axis_field:
    COLUMN EQUAL identifier        { ctx.cached<D::Axis>()->column = move($3); }
 |  SCALE EQUAL display_axis_scale { ctx.cached<D::Axis>()->scale = move($3); }
    ;

display_axis_scale:
    LINEAR { $$ = D::AxisScale::Linear; }
 |  LOG    { $$ = D::AxisScale::Logarithmic; }
    ;

display_color:
    display_color COMMA display_color_field
 |  display_color_field
    ;

display_color_field:
    COLUMN EQUAL identifier                      { ctx.cached<D>()->color.column = move($3); }
 |  PALETTE EQUAL LSB opt_display_color_list RSB { ctx.cached<D>()->color.palette = move($4); }
    ;

opt_display_color_list:
    display_color_list  { $$ = move($1); }
 |  %empty              { $$ = vector<D::RGBColor>(); }
    ;

display_color_list:
    display_color_list COMMA display_color_value { $1.push_back($3); $$ = move($1); }
 |  display_color_value                          { $$ = vector<D::RGBColor>{$1}; }
    ;

display_color_value:
    RGB LRB INTEGER_LITERAL COMMA INTEGER_LITERAL COMMA INTEGER_LITERAL RRB {
        $$ = D::RGBColor{
            static_cast<uint8_t>($3),
            static_cast<uint8_t>($5),
            static_cast<uint8_t>($7)
        };
    }
 |  HEX_COLOR_LITERAL { $$ = D::RGBColor{$1}; }
    ;

display_layout:
    display_layout COMMA display_layout_field
 |  display_layout_field
    ;

display_layout_field:
    WIDTH EQUAL LRB display_layout_length RRB  { ctx.cached<D>()->layout.width = move(ctx.cached<D::LayoutLength>()); }
 |  HEIGHT EQUAL LRB display_layout_length RRB { ctx.cached<D>()->layout.height = move(ctx.cached<D::LayoutLength>()); }
    ;

display_size_class:
    STAR { $$ = D::SizeClass::Wildcard; }
 |  SM   { $$ = D::SizeClass::Small; }
 |  MD   { $$ = D::SizeClass::Medium; }
 |  LG   { $$ = D::SizeClass::Large; }
 |  XL   { $$ = D::SizeClass::ExtraLarge; }
    ;

display_layout_length:
    display_layout_length COMMA display_layout_length_field {
        ctx.cached<D::LayoutLength>()->set(get<0>($3), get<1>($3), get<2>($3));
    }
 |  display_layout_length_field {
        ctx.cached<D::LayoutLength>()->set(get<0>($1), get<1>($1), get<2>($1));
    }
    ;

display_layout_length_field:
    display_size_class EQUAL INTEGER_LITERAL opt_display_layout_unit { $$ = {$1, $3, $4}; }
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

