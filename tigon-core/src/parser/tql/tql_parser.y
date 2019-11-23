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
%token JSON                 "json"
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
%token PARQUET              "parquet"
%token PERCENT              "percent"
%token PIE                  "pie"
%token PLOT                 "plot"
%token POINT                "point"
%token POST                 "post"
%token PUT                  "put"
%token PX                   "px"
%token QUERY                "query"
%token RGB                  "rgb"
%token SCALE                "scale"
%token SCATTER              "scatter"
%token SHOW                 "show"
%token SM                   "sm"
%token STACKED              "stacked"
%token TABLE                "table"
%token TEXT                 "text"
%token TIME                 "time"
%token TITLE                "title"
%token URL                  "url"
%token USING                "using"
%token VERTICAL             "vertical"
%token VIS                  "vis"
%token VISUALISE            "visualise"
%token VISUALIZE            "visualize"
%token VIZ                  "viz"
%token WIDTH                "width"
%token X                    "x"
%token XL                   "xl"
%token Y                    "y"

%token EOF 0                "eof"

%type <VizStatement::AxisScale> viz_axis_scale;
%type <VizStatement::LengthUnit> viz_layout_unit;
%type <VizStatement::LengthUnit> opt_viz_layout_unit;
%type <VizStatement::RGBColor> viz_color_value;
%type <VizStatement::SizeClass> viz_size_class;
%type <VizStatement::Type> viz_method;
%type <VizStatement::TypeFlag> viz_method_prefix;
%type <LoadStatement::HTTPLoader::Method> http_method;
%type <Statement> statement;
%type <Type> type;
%type <std::string_view> identifier;
%type <std::string_view> sql_literal;
%type <std::tuple<VizStatement::SizeClass, uint32_t, VizStatement::LengthUnit>> viz_layout_length_field;
%type <std::unique_ptr<VizStatement>> viz_statement;
%type <std::unique_ptr<ExtractStatement>> extract_statement;
%type <std::unique_ptr<LoadStatement>> load_statement;
%type <std::unique_ptr<ParameterDeclaration>> parameter_declaration;
%type <std::unique_ptr<QueryStatement>> query_statement;
%type <std::vector<VizStatement::RGBColor>> viz_color_list;
%type <std::vector<VizStatement::RGBColor>> opt_viz_color_list;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { ctx.DefineStatement(move($2)); }
 |  %empty
    ;

statement:
    extract_statement       { $$ = Statement { move($1) }; }
 |  viz_statement          { $$ = Statement { move($1) }; }
 |  load_statement          { $$ = Statement { move($1) }; }
 |  parameter_declaration   { $$ = Statement { move($1) }; }
 |  query_statement           { $$ = Statement { move($1) }; }
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

query_statement:
    QUERY identifier AS sql_literal     { $$ = std::make_unique<QueryStatement>($2, $4); }
 |  sql_literal                         { $$ = std::make_unique<QueryStatement>(std::string_view(), $1); }
    ;

sql_literal:
    SQL_SELECT { $$ = $1; }
 |  SQL_WITH   { $$ = $1; }
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
    METHOD EQUAL http_method { ctx.cached<LoadStatement::HTTPLoader>()->method = $3; }
  | URL EQUAL STRING_LITERAL { ctx.cached<LoadStatement::HTTPLoader>()->url = $3; }
    ;

http_method:
    GET  { $$ = Load::HTTPLoader::Method::Get; }
 |  PUT  { $$ = Load::HTTPLoader::Method::Put; }
 |  POST { $$ = Load::HTTPLoader::Method::Post; }
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
    HORIZONTAL { $$ = Viz::TypeFlag::Horizontal; }
 |  VERTICAL   { $$ = Viz::TypeFlag::Vertical; }
 |  STACKED    { $$ = Viz::TypeFlag::Stacked; }
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
 |  LAYOUT EQUAL LRB viz_layout RRB
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
    LINEAR { $$ = Viz::AxisScale::Linear; }
 |  LOG    { $$ = Viz::AxisScale::Logarithmic; }
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
 |  %empty              { $$ = vector<Viz::RGBColor>(); }
    ;

viz_color_list:
    viz_color_list COMMA viz_color_value { $1.push_back($3); $$ = move($1); }
 |  viz_color_value                          { $$ = vector<Viz::RGBColor>{$1}; }
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

viz_layout:
    viz_layout COMMA viz_layout_field
 |  viz_layout_field
    ;

viz_layout_field:
    WIDTH EQUAL LRB viz_layout_length RRB  {
        ctx.cached<VizStatement>()->layout.width = move(ctx.cached<VizStatement::LayoutLength>());
    }
 |  HEIGHT EQUAL LRB viz_layout_length RRB {
        ctx.cached<VizStatement>()->layout.height = move(ctx.cached<VizStatement::LayoutLength>());
    }
    ;

viz_size_class:
    STAR { $$ = Viz::SizeClass::Wildcard; }
 |  SM   { $$ = Viz::SizeClass::Small; }
 |  MD   { $$ = Viz::SizeClass::Medium; }
 |  LG   { $$ = Viz::SizeClass::Large; }
 |  XL   { $$ = Viz::SizeClass::ExtraLarge; }
    ;

viz_layout_length:
    viz_layout_length COMMA viz_layout_length_field {
        ctx.cached<VizStatement::LayoutLength>()->set(get<0>($3), get<1>($3), get<2>($3));
    }
 |  viz_layout_length_field {
        ctx.cached<VizStatement::LayoutLength>()->set(get<0>($1), get<1>($1), get<2>($1));
    }
    ;

viz_layout_length_field:
    viz_size_class EQUAL INTEGER_LITERAL opt_viz_layout_unit { $$ = {$1, $3, $4}; }
    ;

opt_viz_layout_unit:
    viz_layout_unit { $$ = $1; }
 |  %empty              { $$ = Viz::LengthUnit::Span; }
    ;

viz_layout_unit:
    PERCENT { $$ = Viz::LengthUnit::Percent; }
 |  PX      { $$ = Viz::LengthUnit::Pixel; }
    ;

%%

void tigon::tql::Parser::error(const location_type& l, const std::string& m) {
    ctx.Error(l.begin.line, l.begin.column, m);
}

