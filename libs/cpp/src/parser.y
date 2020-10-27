// Copyright (c) 2020 The DashQL Authors

%skeleton "lalr1.cc"
%require "3.3"

%define api.namespace {dashql::parser}
%define api.parser.class {Parser}
%define api.token.constructor
%define api.token.prefix {DQL_}
%define api.value.type variant
%define parse.assert
%define parse.trace
%define parse.error verbose

%locations
%define api.location.type {Location}

%lex-param      { dashql::parser::ParseContext& ctx }
%parse-param    { dashql::parser::ParseContext &ctx }

%code requires {
#include <string>
#include <cstdlib>
#include <utility>
#include "dashql/parser/parse_context.h"

#define YYLLOC_DEFAULT(Cur, Rhs, N) { \
    if (N) { \
        (Cur).offset = YYRHSLOC(Rhs, 1).offset; \
        (Cur).length = YYRHSLOC(Rhs, N).offset - YYRHSLOC(Rhs, 1).offset + YYRHSLOC(Rhs, N).length; \
    } else { \
        (Cur).offset = YYRHSLOC(Rhs, 0).offset + YYRHSLOC(Rhs, 0).length; \
        (Cur).length = 0; \
    } \
}

namespace syntax = dashql::proto::syntax;

using Attr = syntax::Attribute;
using AttrKey = syntax::AttributeKey;
using Value = syntax::Value;
using ValueType = syntax::ValueType;
using ParamType = syntax::ParameterType;
using LoadMethodType = syntax::LoadMethodType;
using HTTPVerb = syntax::HTTPVerb;
using HTTP = syntax::HTTPVerb;
using VizType = syntax::VizType;

}

%code {
using namespace dashql::parser;

Parser::symbol_type yylex(ParseContext& ctx);
}

%token <int64_t>    INTEGER_LITERAL     "integer literal"
%token <uint32_t>   HEX_COLOR_LITERAL   "hex color literal"

%token IDENTIFIER_LITERAL   "identifier literal"
%token PLACEHOLDER_LITERAL  "placeholder literal"
%token SQL_SELECT           "SQL select query"
%token SQL_WITH             "SQL with clause"
%token STRING_LITERAL       "string literal"

%token COMMA                    ", token"
%token DOLLAR                   "$ token"
%token EQUAL                    "= token"
%token LRB                      "( token"
%token LSB                      "[ token"
%token RRB                      ") token"
%token RSB                      "] token"
%token SEMICOLON                "; token"
%token SLASH                    "/ token"
%token STAR                     "* token"

%token AREA                     "AREA keyword"
%token AS                       "AS keyword"
%token AXES                     "AXES keyword"
%token BAR                      "BAR keyword"
%token BOX                      "BOX keyword"
%token BUBBLE                   "BUBBLE keyword"
%token CHART                    "CHART keyword"
%token COLOR                    "COLOR keyword"
%token COLUMN                   "COLUMN keyword"
%token CSV                      "CSV keyword"
%token DATE                     "DATE keyword"
%token DATETIME                 "DATETIME keyword"
%token DECLARE                  "DECLARE keyword"
%token DELIMITER                "DELIMITER keyword"
%token ENCODING                 "ENCODING keyword"
%token EXTRACT                  "EXTRACT keyword"
%token FALSE                    "FALSE keyword"
%token FIELD                    "FIELD keyword"
%token FILE                     "FILE keyword"
%token FLOAT                    "FLOAT keyword"
%token FORMAT                   "FORMAT keyword"
%token FROM                     "FROM keyword"
%token GET                      "GET keyword"
%token GRID                     "GRID keyword"
%token HEADER                   "HEADER keyword"
%token HEIGHT                   "HEIGHT keyword"
%token HISTOGRAM                "HISTOGRAM keyword"
%token HORIZONTAL               "HORIZONTAL keyword"
%token HTTP                     "HTTP keyword"
%token INTEGER                  "INTEGER keyword"
%token JSON                     "JSON keyword"
%token LG                       "LG keyword"
%token LINE                     "LINE keyword"
%token LINEAR                   "LINEAR keyword"
%token LOAD                     "LOAD keyword"
%token LOG                      "LOG keyword"
%token MD                       "MD keyword"
%token METHOD                   "METHOD keyword"
%token NUMBER                   "NUMBER keyword"
%token PALETTE                  "PALETTE keyword"
%token PARAMETER                "PARAMETER keyword"
%token PARQUET                  "PARQUET keyword"
%token PERCENT                  "PERCENT keyword"
%token PIE                      "PIE keyword"
%token PLOT                     "PLOT keyword"
%token POINT                    "POINT keyword"
%token POST                     "POST keyword"
%token PUT                      "PUT keyword"
%token PX                       "PX keyword"
%token QUERY                    "QUERY keyword"
%token QUOTE                    "QUOTE keyword"
%token RGB                      "RGB keyword"
%token SCALE                    "SCALE keyword"
%token SCATTER                  "SCATTER keyword"
%token SHOW                     "SHOW keyword"
%token SM                       "SM keyword"
%token STACKED                  "STACKED keyword"
%token TABLE                    "TABLE keyword"
%token TEXT                     "TEXT keyword"
%token TIME                     "TIME keyword"
%token TIMESTAMP                "TIMESTAMP keyword"
%token TITLE                    "TITLE keyword"
%token TRUE                     "TRUE keyword"
%token TYPE                     "TYPE keyword"
%token URL                      "URL keyword"
%token USING                    "USING keyword"
%token VERTICAL                 "VERTICAL keyword"
%token VIS                      "VIS keyword"
%token VISUALISE                "VISUALISE keyword"
%token VISUALIZE                "VISUALIZE keyword"
%token VIZ                      "VIZ keyword"
%token WIDTH                    "WIDTH keyword"
%token X                        "X keyword"
%token XL                       "XL keyword"
%token Y                        "Y keyword"

%token EOF 0                    "end of file"


%type <std::vector<syntax::Object>> statement_list;
%type <syntax::Object> parameter_declaration;
%type <syntax::Object> extract_statement;
%type <syntax::Object> query_statement;
%type <syntax::Object> statement;
%type <syntax::Object> viz_statement;
%type <syntax::Object> load_statement;

%type <std::optional<syntax::Value>> opt_alias;
%type <std::vector<syntax::Attribute>> csv_attribute_list;
%type <std::vector<syntax::Attribute>> extract_method;
%type <std::vector<syntax::Attribute>> http_attribute_list;
%type <std::vector<syntax::Attribute>> load_attributes;
%type <std::vector<syntax::Attribute>> opt_csv_attribute_list;
%type <std::vector<syntax::Value>> string_list;
%type <syntax::Attribute> csv_attribute;
%type <syntax::Attribute> http_attribute;
%type <syntax::Value> boolean;
%type <syntax::Value> csv_header_value;
%type <syntax::Value> http_verb;
%type <syntax::Value> identifier;
%type <syntax::Value> parameter_type;
%type <syntax::Value> sql_literal;
%type <syntax::Value> string_value;
%type <syntax::Value> viz_type;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { $1.push_back($2); $$ = std::move($1); }
  | statement_list error SEMICOLON      { yyclearin; yyerrok; $$ = std::move($1); }
  | %empty                              { $$ = std::vector<syntax::Object>(); }
    ;

statement:
    parameter_declaration   { $$ = $1; }
  | load_statement          { $$ = $1; }
  | extract_statement       { $$ = $1; }
  | query_statement         { $$ = $1; }
  | viz_statement           { $$ = $1; }
    ;

parameter_declaration:
    DECLARE PARAMETER identifier opt_alias TYPE parameter_type  {
        $$ = ctx.AddObject(@$, syntax::ObjectType::PARAMETER_DECLARATION, {
            {@3.encode(), AttrKey::PARAMETER_IDENTIFIER, $3},
            {@4.encode(), AttrKey::PARAMETER_ALIAS, $4},
            {@6.encode(), AttrKey::PARAMETER_TYPE, $6},
        });
    }
    ;

identifier:
    IDENTIFIER_LITERAL  { $$ = ctx.AddString(@1); }
  | STRING_LITERAL      { $$ = ctx.AddString(@1); }
  | PLACEHOLDER_LITERAL { $$ = ctx.AddString(@1); }
    ;

string_value:
    STRING_LITERAL { $$ = Value(@1.encode(), ValueType::STRING, 0); }
    ;

opt_alias:
    %empty        { $$ = std::nullopt; }
  | AS identifier { $$ = $2; }
    ;

parameter_type:
    INTEGER     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::INTEGER); }
  | FLOAT       { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::FLOAT); }
  | TEXT        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::TEXT); }
  | DATE        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::DATE); }
  | DATETIME    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::DATETIME); }
  | TIME        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::TIME); }
  | FILE        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) ParamType::FILE); }
    ;

load_statement:
    LOAD identifier FROM load_attributes {
        $4.push_back(Attr(@2.encode(), AttrKey::LOAD_NAME, $2));
        $$ = ctx.AddObject(@$, syntax::ObjectType::LOAD_STATEMENT, move($4));
    }
    ;

load_attributes:
    HTTP LRB http_attribute_list RRB    { $$ = move($3); }
  | FILE string_value                   { $$ = std::vector<Attr>{ Attr(@$.encode(), AttrKey::FILE_LABEL, $2) };  }
    ;

http_attribute_list:
    http_attribute_list COMMA http_attribute    { $1.push_back($3); $$ = move($1); }
  | %empty                                      { $$ = std::vector<Attr>(); }
    ;

http_attribute:
    METHOD EQUAL http_verb  { $$ = Attr(@$.encode(), AttrKey::HTTP_LOAD_VERB, $3); }
  | URL EQUAL string_value  { $$ = Attr(@$.encode(), AttrKey::HTTP_LOAD_URL, $3); }
    ;

http_verb:
    GET     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::GET); }
  | PUT     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::PUT); }
  | POST    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::POST); }
    ;

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method {
        $6.push_back(Attr(@2.encode(), AttrKey::EXTRACT_STATEMENT_NAME, $2));
        $6.push_back(Attr(@4.encode(), AttrKey::EXTRACT_STATEMENT_DATA, $4));
        $$ = ctx.AddObject(@$, syntax::ObjectType::EXTRACT_STATEMENT, move($6));
    }
    ;

extract_method:
    CSV opt_csv_attribute_list  { }
  | JSON LRB RRB                { }
    ;

opt_csv_attribute_list:
    LRB csv_attribute_list RRB  { $$ = move($2); }
 |  %empty                      { $$ = std::vector<Attr>(); }
    ;

csv_attribute_list:
    csv_attribute_list COMMA csv_attribute  { $1.push_back($3); $$ = move($1); }
  | csv_attribute                           { $$ = std::vector<Attr>{ $1 }; }
    ;

csv_attribute:
    ENCODING EQUAL string_value             { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_ENCODING, $3); }
  | HEADER EQUAL csv_header_value           { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_HEADER, $3); }
  | DELIMITER EQUAL string_value            { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_DELIMITER, $3); }
  | QUOTE EQUAL string_value                { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_QUOTE, $3); }
  | DATE FORMAT EQUAL string_value          { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_DATE_FORMAT, $4); }
  | TIMESTAMP FORMAT EQUAL string_value     { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_TIMESTAMP_FORMAT, $4); }
    ;

csv_header_value:
    boolean                                                 { }
  | LRB string_list RRB    { }

boolean:
    TRUE    { }
  | FALSE   { }
    ;

string_list:
    string_list COMMA STRING_LITERAL    { }
  | STRING_LITERAL                      { }
    ;

query_statement:
    QUERY identifier AS sql_literal { }
  | sql_literal                     { }
    ;

sql_literal:
    SQL_SELECT  { }
  | SQL_WITH    { }
    ;

viz_statement:
    viz_statement_prefix identifier FROM identifier USING viz_type  { }
    ;

viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

viz_type:
    AREA        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::AREA); }
  | BAR         { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::BAR); }
  | BOX         { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::BOX); }
  | BUBBLE      { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::BUBBLE); }
  | GRID        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::GRID); }
  | HISTOGRAM   { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::HISTOGRAM); }
  | LINE        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::LINE); }
  | NUMBER      { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::NUMBER); }
  | PIE         { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::PIE); }
  | POINT       { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::POINT); }
  | SCATTER     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::SCATTER); }
  | TABLE       { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::TABLE); }
  | TEXT        { $$ = Value(@$.encode(), ValueType::NUMBER, (int) VizType::TEXT); }
    ;

%%
void dashql::parser::Parser::error(const location_type& location, const std::string& message) {
    ctx.AddError(location, message);
}
