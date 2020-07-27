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

%param { tigon::tql::ParseContext &context }

%code requires {
#include <string>
#include <cstdlib>
#include "tigon/parser/tql/tql_parse_context.h"
}

%code {
using namespace tigon::tql;

namespace tigon {
    namespace tql {
        namespace parser {
            Location locate(location location) {
                return {
                    {location.begin.line, location.begin.column},
                    {location.end.line, location.end.column}
                };
            }

            Location locate(location begin, location end) {
                return {
                    {begin.begin.line, begin.begin.column},
                    {end.end.line, end.end.column}
                };
            }
        } // namespace parser
    } // namespace tql
} // namespace tigon

using namespace tigon::tql::parser;

Parser::symbol_type tql_lex(ParseContext& context);
}

%token <int>                INTEGER_LITERAL     "integer literal"
%token <std::string_view>   IDENTIFIER_LITERAL  "identifier literal"
%token <std::string_view>   PLACEHOLDER_LITERAL "placeholder literal"
%token <std::string_view>   SQL_SELECT          "SQL select query"
%token <std::string_view>   SQL_WITH            "SQL with clause"
%token <std::string_view>   STRING_LITERAL      "string literal"
%token <uint32_t>           HEX_COLOR_LITERAL   "hex color literal"

%token COMMA                    ","
%token EQUAL                    "="
%token LEFT_ROUND_BRACKETS      "("
%token LEFT_SQUARE_BRACKETS     "["
%token RIGHT_ROUND_BRACKETS     ")"
%token RIGHT_SQUARE_BRACKETS    "]"
%token SEMICOLON                ";"
%token SLASH                    "/"
%token STAR                     "*"

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

%token EOF 0    "end of file"

%type <DataType>                                            type;
%type <ExtractStatement::ExtractMethod>                     extract_method;
%type <ExtractStatement>                                    extract_statement;
%type <LoadStatement::HTTPLoader::Attribute>                load_method_http_attribute;
%type <LoadStatement::HTTPLoader::Method>                   http_method;
%type <LoadStatement::LoadMethod>                           load_method;
%type <LoadStatement>                                       load_statement;
%type <ParameterDeclaration>                                parameter_declaration;
%type <QueryStatement>                                      query_statement;
%type <Statement>                                           statement;
%type <String>                                              keyword;
%type <std::vector<LoadStatement::HTTPLoader::Attribute>>   load_method_http_attribute_list;
%type <String>                                              identifier;
%type <String>                                              sql_literal;
%type <VizStatement::VizType>                               viz_type;
%type <VizStatement>                                        viz_statement;

%%

%start statement_list;

statement_list:
    statement_list statement  { context.DefineStatement(std::move($2)); }
  | statement_list error      { yyclearin; }
  | %empty
    ;

statement:
    extract_statement       { $$ = $1; }
  | viz_statement           { $$ = $1; }
  | load_statement          { $$ = $1; }
  | parameter_declaration   { $$ = $1; }
  | query_statement         { $$ = $1; }
    ;

parameter_declaration:
    DECLARE PARAMETER identifier opt_as type SEMICOLON  { $$ = ParameterDeclaration { locate(@1, @6), $3, $5 }; }
    ;

identifier:
    IDENTIFIER_LITERAL  { $$ = String { locate(@1), $1 }; }
  | STRING_LITERAL      { $$ = String { locate(@1), $1 }; }
  | PLACEHOLDER_LITERAL { $$ = String { locate(@1), $1 }; }
  | keyword             { $$ = $1; }
    ;

keyword:
    AREA        { $$ = String { locate(@1), $1 }; }
  | AS          { $$ = String { locate(@1), $1 }; }
  | AXES        { $$ = String { locate(@1), $1 }; }
  | BAR         { $$ = String { locate(@1), $1 }; }
  | BOX         { $$ = String { locate(@1), $1 }; }
  | BUBBLE      { $$ = String { locate(@1), $1 }; }
  | CHART       { $$ = String { locate(@1), $1 }; }
  | COLOR       { $$ = String { locate(@1), $1 }; }
  | COLUMN      { $$ = String { locate(@1), $1 }; }
  | CSV         { $$ = String { locate(@1), $1 }; }
  | DATE        { $$ = String { locate(@1), $1 }; }
  | DATETIME    { $$ = String { locate(@1), $1 }; }
  | DECLARE     { $$ = String { locate(@1), $1 }; }
  | EXTRACT     { $$ = String { locate(@1), $1 }; }
  | FIELD       { $$ = String { locate(@1), $1 }; }
  | FILE        { $$ = String { locate(@1), $1 }; }
  | FLOAT       { $$ = String { locate(@1), $1 }; }
  | FROM        { $$ = String { locate(@1), $1 }; }
  | GET         { $$ = String { locate(@1), $1 }; }
  | GRID        { $$ = String { locate(@1), $1 }; }
  | HEIGHT      { $$ = String { locate(@1), $1 }; }
  | HISTOGRAM   { $$ = String { locate(@1), $1 }; }
  | HORIZONTAL  { $$ = String { locate(@1), $1 }; }
  | HTTP        { $$ = String { locate(@1), $1 }; }
  | INTEGER     { $$ = String { locate(@1), $1 }; }
  | JSON        { $$ = String { locate(@1), $1 }; }
  | LG          { $$ = String { locate(@1), $1 }; }
  | LINE        { $$ = String { locate(@1), $1 }; }
  | LINEAR      { $$ = String { locate(@1), $1 }; }
  | LOAD        { $$ = String { locate(@1), $1 }; }
  | LOG         { $$ = String { locate(@1), $1 }; }
  | MD          { $$ = String { locate(@1), $1 }; }
  | METHOD      { $$ = String { locate(@1), $1 }; }
  | NUMBER      { $$ = String { locate(@1), $1 }; }
  | PALETTE     { $$ = String { locate(@1), $1 }; }
  | PARAMETER   { $$ = String { locate(@1), $1 }; }
  | PARQUET     { $$ = String { locate(@1), $1 }; }
  | PERCENT     { $$ = String { locate(@1), $1 }; }
  | PIE         { $$ = String { locate(@1), $1 }; }
  | PLOT        { $$ = String { locate(@1), $1 }; }
  | POINT       { $$ = String { locate(@1), $1 }; }
  | POST        { $$ = String { locate(@1), $1 }; }
  | PUT         { $$ = String { locate(@1), $1 }; }
  | PX          { $$ = String { locate(@1), $1 }; }
  | QUERY       { $$ = String { locate(@1), $1 }; }
  | RGB         { $$ = String { locate(@1), $1 }; }
  | SCALE       { $$ = String { locate(@1), $1 }; }
  | SCATTER     { $$ = String { locate(@1), $1 }; }
  | SHOW        { $$ = String { locate(@1), $1 }; }
  | SM          { $$ = String { locate(@1), $1 }; }
  | STACKED     { $$ = String { locate(@1), $1 }; }
  | TABLE       { $$ = String { locate(@1), $1 }; }
  | TEXT        { $$ = String { locate(@1), $1 }; }
  | TIME        { $$ = String { locate(@1), $1 }; }
  | TITLE       { $$ = String { locate(@1), $1 }; }
  | URL         { $$ = String { locate(@1), $1 }; }
  | USING       { $$ = String { locate(@1), $1 }; }
  | VERTICAL    { $$ = String { locate(@1), $1 }; }
  | VIS         { $$ = String { locate(@1), $1 }; }
  | VISUALISE   { $$ = String { locate(@1), $1 }; }
  | VISUALIZE   { $$ = String { locate(@1), $1 }; }
  | VIZ         { $$ = String { locate(@1), $1 }; }
  | WIDTH       { $$ = String { locate(@1), $1 }; }
  | X           { $$ = String { locate(@1), $1 }; }
  | XL          { $$ = String { locate(@1), $1 }; }
  | Y           { $$ = String { locate(@1), $1 }; }
    ;

opt_as:
    AS
  | %empty
    ;

type:
    INTEGER     { $$ = DataType { locate(@1), DataType::Type::Integer }; }
  | FLOAT       { $$ = DataType { locate(@1), DataType::Type::Float }; }
  | TEXT        { $$ = DataType { locate(@1), DataType::Type::Text }; }
  | DATE        { $$ = DataType { locate(@1), DataType::Type::Date }; }
  | DATETIME    { $$ = DataType { locate(@1), DataType::Type::DateTime }; }
  | TIME        { $$ = DataType { locate(@1), DataType::Type::Time }; }
    ;

query_statement:
    QUERY identifier AS sql_literal SEMICOLON { $$ = QueryStatement { locate(@1, @5), $2, $4 }; }
  | sql_literal SEMICOLON                     { $$ = QueryStatement { locate(@1, @2), {}, $1 }; }
    ;

sql_literal:
    SQL_SELECT  { $$ = String { locate(@1), $1 }; }
  | SQL_WITH    { $$ = String { locate(@1), $1 }; }
    ;

load_statement:
    LOAD identifier FROM load_method SEMICOLON  { $$ = LoadStatement { locate(@1, @5), $2, $4 }; }
    ;

load_method:
    HTTP LEFT_ROUND_BRACKETS load_method_http_attribute_list RIGHT_ROUND_BRACKETS   { $$ = LoadStatement::HTTPLoader { locate(@1, @4), LoadStatement::HTTPLoader::Attributes { locate(@3), $3 } }; }
  | FILE                                                                            { $$ = LoadStatement::FileLoader { locate(@1) }; }
    ;

load_method_http_attribute_list:
    load_method_http_attribute_list COMMA load_method_http_attribute    { $1.push_back($3); $$ = $1; }
  | load_method_http_attribute                                          { $$ = std::vector<LoadStatement::HTTPLoader::Attribute> { $1 }; }
    ;

load_method_http_attribute:
    METHOD EQUAL http_method    { $$ = $3; }
  | URL EQUAL STRING_LITERAL    { $$ = LoadStatement::HTTPLoader::URL { locate(@3), $3 }; }
    ;

http_method:
    GET     { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Get }; }
  | PUT     { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Put }; }
  | POST    { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Post }; }
    ;

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method SEMICOLON { $$ = ExtractStatement { locate(@1, @7), $2, $4, $6 }; }
    ;

extract_method:
    CSV LEFT_ROUND_BRACKETS RIGHT_ROUND_BRACKETS    { $$ = ExtractStatement::CSVExtract { locate(@1, @3) }; }
  | JSON LEFT_ROUND_BRACKETS RIGHT_ROUND_BRACKETS   { $$ = ExtractStatement::JSONPathExtract { locate(@1, @3) }; }
    ;

viz_statement:
    viz_statement_prefix identifier FROM identifier USING viz_type SEMICOLON  { $$ = VizStatement { locate(@1, @7), $2, $4, $6 }; }
    ;

viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

viz_type:
    AREA        { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Area }; }
  | BAR         { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Bar }; }
  | BOX         { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Box }; }
  | BUBBLE      { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Bubble }; }
  | GRID        { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Grid }; }
  | HISTOGRAM   { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Histogram }; }
  | LINE        { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Line }; }
  | NUMBER      { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Number }; }
  | PIE         { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Pie }; }
  | POINT       { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Point }; }
  | SCATTER     { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Scatter }; }
  | TABLE       { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Table }; }
  | TEXT        { $$ = VizStatement::VizType { locate(@1), VizStatement::VizType::Type::Text }; }
    ;

%%

void tigon::tql::Parser::error(const location_type& location, const std::string& message) {
    context.Error(locate(location), message);
}
