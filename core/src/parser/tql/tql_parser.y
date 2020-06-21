//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.3"

%define api.namespace {tigon::tql}
%define api.parser.class {Parser}
%define api.prefix {tql_}
%define api.token.constructor
%define api.token.prefix {TQL_}
%define api.value.type variant
%define parse.assert
%define parse.trace
%define parse.error verbose
%locations

%param { tigon::tql::ParseContext &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include "tigon/parser/tql/tql_parse_context.h"
}

%code {
tigon::tql::Parser::symbol_type tql_lex(tigon::tql::ParseContext& ctx);

using Extract = tigon::tql::LoadStatement;
using Load = tigon::tql::LoadStatement;
using Param = tigon::tql::ParameterDeclaration;
using Viz = tigon::tql::VizStatement;
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

%token SEMICOLON    "semicolon"
%token LRB          "left_round_bracket"
%token RRB          "right_round_bracket"
%token LSB          "left_square_bracket"
%token RSB          "right_square_bracket"
%token EQUAL        "equal"
%token COMMA        "comma"
%token SLASH        "slash"
%token STAR         "star"

%token <std::string_view>   AREA        "area"
%token <std::string_view>   AS          "as"
%token <std::string_view>   AXES        "axes"
%token <std::string_view>   BAR         "bar"
%token <std::string_view>   BOX         "box"
%token <std::string_view>   BUBBLE      "bubble"
%token <std::string_view>   CHART       "chart"
%token <std::string_view>   COLOR       "color"
%token <std::string_view>   COLUMN      "column"
%token <std::string_view>   CSV         "csv"
%token <std::string_view>   DATE        "date"
%token <std::string_view>   DATETIME    "datetime"
%token <std::string_view>   DECLARE     "declare"
%token <std::string_view>   EXTRACT     "extract"
%token <std::string_view>   FIELD       "field"
%token <std::string_view>   FILE        "file"
%token <std::string_view>   FLOAT       "float"
%token <std::string_view>   FROM        "from"
%token <std::string_view>   GET         "get"
%token <std::string_view>   GRID        "grid"
%token <std::string_view>   HEIGHT      "height"
%token <std::string_view>   HISTOGRAM   "histogram"
%token <std::string_view>   HORIZONTAL  "horizontal"
%token <std::string_view>   HTTP        "http"
%token <std::string_view>   INTEGER     "integer"
%token <std::string_view>   JSON        "json"
%token <std::string_view>   LG          "lg"
%token <std::string_view>   LINE        "line"
%token <std::string_view>   LINEAR      "linear"
%token <std::string_view>   LOAD        "load"
%token <std::string_view>   LOG         "log"
%token <std::string_view>   MD          "md"
%token <std::string_view>   METHOD      "method"
%token <std::string_view>   NUMBER      "number"
%token <std::string_view>   PALETTE     "palette"
%token <std::string_view>   PARAMETER   "parameter"
%token <std::string_view>   PARQUET     "parquet"
%token <std::string_view>   PERCENT     "percent"
%token <std::string_view>   PIE         "pie"
%token <std::string_view>   PLOT        "plot"
%token <std::string_view>   POINT       "point"
%token <std::string_view>   POST        "post"
%token <std::string_view>   PUT         "put"
%token <std::string_view>   PX          "px"
%token <std::string_view>   QUERY       "query"
%token <std::string_view>   RGB         "rgb"
%token <std::string_view>   SCALE       "scale"
%token <std::string_view>   SCATTER     "scatter"
%token <std::string_view>   SHOW        "show"
%token <std::string_view>   SM          "sm"
%token <std::string_view>   STACKED     "stacked"
%token <std::string_view>   TABLE       "table"
%token <std::string_view>   TEXT        "text"
%token <std::string_view>   TIME        "time"
%token <std::string_view>   TITLE       "title"
%token <std::string_view>   URL         "url"
%token <std::string_view>   USING       "using"
%token <std::string_view>   VERTICAL    "vertical"
%token <std::string_view>   VIS         "vis"
%token <std::string_view>   VISUALISE   "visualise"
%token <std::string_view>   VISUALIZE   "visualize"
%token <std::string_view>   VIZ         "viz"
%token <std::string_view>   WIDTH       "width"
%token <std::string_view>   X           "x"
%token <std::string_view>   XL          "xl"
%token <std::string_view>   Y           "y"

%token EOF 0    "eof"

%type <LoadStatement::HTTPLoader::Method>                   http_method;
%type <Statement>                                           statement;
%type <Type>                                                type;
%type <VizStatement::AxisScale>                             viz_axis_scale;
%type <VizStatement::GridArea>                              viz_area_spec;
%type <VizStatement::RGBColor>                              viz_color_value;
%type <VizStatement::SizeClass>                             viz_size_class;
%type <VizStatement::Type>                                  viz_method;
%type <VizStatement::TypeFlag>                              viz_method_prefix;
%type <std::string_view>                                    identifier;
%type <std::string_view>                                    keyword;
%type <std::string_view>                                    sql_literal;
%type <std::unique_ptr<ExtractStatement>>                   extract_statement;
%type <std::unique_ptr<LoadStatement>>                      load_statement;
%type <std::unique_ptr<ParameterDeclaration>>               parameter_declaration;
%type <std::unique_ptr<QueryStatement>>                     query_statement;
%type <std::unique_ptr<VizStatement::ResponsiveGridArea>>   viz_area;
%type <std::unique_ptr<VizStatement>>                       viz_statement;
%type <std::vector<VizStatement::RGBColor>>                 opt_viz_color_list;
%type <std::vector<VizStatement::RGBColor>>                 viz_color_list;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { ctx.DefineStatement(move($2)); }
 |  statement_list error SEMICOLON      { yyclearin; }
 |  %empty
    ;

statement:
    extract_statement       { $$ = Statement { move($1) }; }
 |  viz_statement           { $$ = Statement { move($1) }; }
 |  load_statement          { $$ = Statement { move($1) }; }
 |  parameter_declaration   { $$ = Statement { move($1) }; }
 |  query_statement         { $$ = Statement { move($1) }; }
    ;

parameter_declaration:
    DECLARE PARAMETER identifier opt_as type {
        auto& p = ctx.cached<ParameterDeclaration>();
        p->parameter_id = $3;
        p->type = $5;
        $$ = move(p);
    }
    ;

identifier:
    IDENTIFIER_LITERAL  { $$ = $1; }
 |  STRING_LITERAL      { $$ = $1; }
 |  keyword             { $$ = $1; }
    ;

keyword:
    AREA        { $$ = $1; }
 |  AS          { $$ = $1; }
 |  AXES        { $$ = $1; }
 |  BAR         { $$ = $1; }
 |  BOX         { $$ = $1; }
 |  BUBBLE      { $$ = $1; }
 |  CHART       { $$ = $1; }
 |  COLOR       { $$ = $1; }
 |  COLUMN      { $$ = $1; }
 |  CSV         { $$ = $1; }
 |  DATE        { $$ = $1; }
 |  DATETIME    { $$ = $1; }
 |  DECLARE     { $$ = $1; }
 |  EXTRACT     { $$ = $1; }
 |  FIELD       { $$ = $1; }
 |  FILE        { $$ = $1; }
 |  FLOAT       { $$ = $1; }
 |  FROM        { $$ = $1; }
 |  GET         { $$ = $1; }
 |  GRID        { $$ = $1; }
 |  HEIGHT      { $$ = $1; }
 |  HISTOGRAM   { $$ = $1; }
 |  HORIZONTAL  { $$ = $1; }
 |  HTTP        { $$ = $1; }
 |  INTEGER     { $$ = $1; }
 |  JSON        { $$ = $1; }
 |  LG          { $$ = $1; }
 |  LINE        { $$ = $1; }
 |  LINEAR      { $$ = $1; }
 |  LOAD        { $$ = $1; }
 |  LOG         { $$ = $1; }
 |  MD          { $$ = $1; }
 |  METHOD      { $$ = $1; }
 |  NUMBER      { $$ = $1; }
 |  PALETTE     { $$ = $1; }
 |  PARAMETER   { $$ = $1; }
 |  PARQUET     { $$ = $1; }
 |  PERCENT     { $$ = $1; }
 |  PIE         { $$ = $1; }
 |  PLOT        { $$ = $1; }
 |  POINT       { $$ = $1; }
 |  POST        { $$ = $1; }
 |  PUT         { $$ = $1; }
 |  PX          { $$ = $1; }
 |  QUERY       { $$ = $1; }
 |  RGB         { $$ = $1; }
 |  SCALE       { $$ = $1; }
 |  SCATTER     { $$ = $1; }
 |  SHOW        { $$ = $1; }
 |  SM          { $$ = $1; }
 |  STACKED     { $$ = $1; }
 |  TABLE       { $$ = $1; }
 |  TEXT        { $$ = $1; }
 |  TIME        { $$ = $1; }
 |  TITLE       { $$ = $1; }
 |  URL         { $$ = $1; }
 |  USING       { $$ = $1; }
 |  VERTICAL    { $$ = $1; }
 |  VIS         { $$ = $1; }
 |  VISUALISE   { $$ = $1; }
 |  VISUALIZE   { $$ = $1; }
 |  VIZ         { $$ = $1; }
 |  WIDTH       { $$ = $1; }
 |  X           { $$ = $1; }
 |  XL          { $$ = $1; }
 |  Y           { $$ = $1; }
    ;

opt_as:
    AS
 |  %empty
    ;

type:
    INTEGER     { $$ = Type::Integer; }
 |  FLOAT       { $$ = Type::Float; }
 |  TEXT        { $$ = Type::Text; }
 |  DATE        { $$ = Type::Date; }
 |  DATETIME    { $$ = Type::DateTime; }
 |  TIME        { $$ = Type::Time; }
    ;

query_statement:
    QUERY identifier AS sql_literal { $$ = std::make_unique<QueryStatement>($2, $4); }
 |  sql_literal                     { $$ = std::make_unique<QueryStatement>(std::string_view(), $1); }
    ;

sql_literal:
    SQL_SELECT  { $$ = $1; }
 |  SQL_WITH    { $$ = $1; }
    ;

load_statement:
    LOAD identifier FROM load_method {
        auto& l = ctx.cached<LoadStatement>();
        l->data_id = $2;
        $$ = move(l);
    }
    ;

load_method:
    HTTP LRB load_method_http_field_list RRB {
        ctx.cached<LoadStatement>()->method = move(ctx.cached<LoadStatement::HTTPLoader>());
    }
  | FILE {
        ctx.cached<LoadStatement>()->method = move(ctx.cached<LoadStatement::FileLoader>());
    }
    ;

load_method_http_field_list:
    load_method_http_field_list COMMA load_method_http_field
  | load_method_http_field
    ;

load_method_http_field:
    METHOD EQUAL http_method    { ctx.cached<LoadStatement::HTTPLoader>()->method = $3; }
  | URL EQUAL STRING_LITERAL    { ctx.cached<LoadStatement::HTTPLoader>()->url = $3; }
    ;

http_method:
    GET     { $$ = Load::HTTPLoader::Method::Get; }
 |  PUT     { $$ = Load::HTTPLoader::Method::Put; }
 |  POST    { $$ = Load::HTTPLoader::Method::Post; }
    ;

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method {
        auto& e = ctx.cached<ExtractStatement>();
        e->extract_id = $2;
        e->data_id = $4;
        $$ = move(e);
    }
    ;

extract_method:
    CSV LRB RRB
  | JSON LRB RRB
  | PARQUET LRB RRB
    ;

viz_statement:
    viz_statement_prefix identifier FROM identifier USING viz_method_prefix_list viz_method {
        auto& d = ctx.cached<VizStatement>();
        d->viz_id = $2;
        d->query_id = $4;
        d->type = $7;
        $$ = move(d);
    }
    ;

viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

viz_method_prefix_list:
    viz_method_prefix_list viz_method_prefix {
        ctx.cached<VizStatement>()->type_flags |= static_cast<uint64_t>($2);
    }
 |  %empty
    ;

viz_method_prefix:
    HORIZONTAL  { $$ = Viz::TypeFlag::Horizontal; }
 |  VERTICAL    { $$ = Viz::TypeFlag::Vertical; }
 |  STACKED     { $$ = Viz::TypeFlag::Stacked; }
    ;

viz_method:
    AREA opt_chart opt_viz_fields       { $$ = Viz::Type::Area; }
 |  BAR opt_chart opt_viz_fields        { $$ = Viz::Type::Bar; }
 |  BOX opt_chart opt_viz_fields        { $$ = Viz::Type::Box; }
 |  BUBBLE opt_chart opt_viz_fields     { $$ = Viz::Type::Bubble; }
 |  GRID opt_viz_fields                 { $$ = Viz::Type::Grid; }
 |  HISTOGRAM opt_chart opt_viz_fields  { $$ = Viz::Type::Histogram; }
 |  LINE opt_chart opt_viz_fields       { $$ = Viz::Type::Line; }
 |  NUMBER opt_field opt_viz_fields     { $$ = Viz::Type::Number; }
 |  PIE opt_chart opt_viz_fields        { $$ = Viz::Type::Pie; }
 |  POINT opt_chart opt_viz_fields      { $$ = Viz::Type::Point; }
 |  SCATTER opt_chart opt_viz_fields    { $$ = Viz::Type::Scatter; }
 |  TABLE opt_viz_fields                { $$ = Viz::Type::Table; }
 |  TEXT opt_chart opt_viz_fields       { $$ = Viz::Type::Text; }
    ;

opt_chart:
    CHART
 |  VIZ
 |  %empty
    ;

opt_field:
    FIELD
 |  %empty
    ;

opt_viz_fields:
    LRB viz_fields RRB
 |  %empty
    ;

viz_fields:
    viz_fields COMMA viz_field
 |  viz_field
    ;

viz_field:
    AXES EQUAL LRB viz_axes RRB
 |  COLOR EQUAL LRB viz_color RRB
 |  AREA EQUAL viz_area {
        ctx.cached<VizStatement>()->area = std::move($3);
    }
 |  TITLE EQUAL identifier {
        ctx.cached<VizStatement>()->title = $3;
    }
    ;

viz_axes:
    viz_axes COMMA viz_axes_field
 |  viz_axes_field
    ;

viz_axes_field:
    X EQUAL LRB viz_axis RRB {
        ctx.cached<VizStatement>()->axes.x = move(ctx.cached<VizStatement::Axis>());   }
 |  Y EQUAL LRB viz_axis RRB {
        ctx.cached<VizStatement>()->axes.y = move(ctx.cached<VizStatement::Axis>());
    }
    ;

viz_axis:
    viz_axis COMMA viz_axis_field
 |  viz_axis_field
    ;

viz_axis_field:
    COLUMN EQUAL identifier {
        ctx.cached<VizStatement::Axis>()->column = move($3);
    }
 |  SCALE EQUAL viz_axis_scale {
        ctx.cached<VizStatement::Axis>()->scale = move($3);
    }
    ;

viz_axis_scale:
    LINEAR  { $$ = Viz::AxisScale::Linear; }
 |  LOG     { $$ = Viz::AxisScale::Logarithmic; }
    ;

viz_color:
    viz_color COMMA viz_color_field
 |  viz_color_field
    ;

viz_color_field:
    COLUMN EQUAL identifier {
        ctx.cached<VizStatement>()->color.column = move($3);
    }
 |  PALETTE EQUAL LSB opt_viz_color_list RSB {
        ctx.cached<VizStatement>()->color.palette = move($4);
    }
    ;

opt_viz_color_list:
    viz_color_list  { $$ = move($1); }
 |  %empty          { $$ = vector<Viz::RGBColor>(); }
    ;

viz_color_list:
    viz_color_list COMMA viz_color_value    { $1.push_back($3); $$ = move($1); }
 |  viz_color_value                         { $$ = vector<Viz::RGBColor>{$1}; }
    ;

viz_color_value:
    RGB LRB INTEGER_LITERAL COMMA INTEGER_LITERAL COMMA INTEGER_LITERAL RRB {
        $$ = Viz::RGBColor{
            static_cast<uint8_t>($3),
            static_cast<uint8_t>($5),
            static_cast<uint8_t>($7)
        };
    }
 |  HEX_COLOR_LITERAL { $$ = Viz::RGBColor{$1}; }
    ;

viz_area:
    viz_area_spec {
        auto a = std::make_unique<VizStatement::ResponsiveGridArea>();
        a->set(Viz::SizeClass::Wildcard, $1);
        $$ = move(a);
    }
 |  LRB viz_area_responsive_list RRB {
        $$ = move(ctx.cached<VizStatement::ResponsiveGridArea>());
    }
    ;

viz_area_spec:
    INTEGER_LITERAL                     { $$ = VizStatement::GridArea($1); }
 |  viz_area_spec SLASH INTEGER_LITERAL { $1.push($3); $$ = $1; } 
    ;

viz_area_responsive_list:
    viz_area_responsive
 |  viz_area_responsive_list COMMA viz_area_responsive
    ;

viz_area_responsive:
    viz_size_class EQUAL viz_area_spec {
        ctx.cached<VizStatement::ResponsiveGridArea>()->set($1, $3);
    }
    ;

viz_size_class:
    STAR    { $$ = Viz::SizeClass::Wildcard; }
 |  SM      { $$ = Viz::SizeClass::Small; }
 |  MD      { $$ = Viz::SizeClass::Medium; }
 |  LG      { $$ = Viz::SizeClass::Large; }
 |  XL      { $$ = Viz::SizeClass::ExtraLarge; }
    ;

%%

void tigon::tql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}
