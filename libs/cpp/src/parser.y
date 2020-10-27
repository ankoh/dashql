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

using AttrKey = syntax::AttributeKey;
using Value = syntax::Value;
using ValueType = syntax::ValueType;
using ParamType = syntax::ParameterType;
using LoadMethodType = syntax::LoadMethodType;

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

%token <std::string_view>   STRING_LITERAL "string literal"

%token COMMA                    ", token"
%token DOLLAR                   "$ token"
%token EQUAL                    "= token"
%token LEFT_ROUND_BRACKETS      "( token"
%token LEFT_SQUARE_BRACKETS     "[ token"
%token RIGHT_ROUND_BRACKETS     ") token"
%token RIGHT_SQUARE_BRACKETS    "] token"
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

%type <syntax::Value> boolean;
%type <syntax::Value> csv_attribute;
%type <syntax::Value> extract_method;
%type <syntax::Value> http_attribute;
%type <syntax::Value> http_method;
%type <syntax::Value> load_method;
%type <syntax::Value> parameter_type;
%type <std::optional<syntax::Value>> opt_alias;
%type <std::optional<syntax::Value>> csv_header_value;
%type <std::vector<syntax::Attribute>> csv_attributes;
%type <std::vector<syntax::Attribute>> csv_attribute_list;
%type <std::vector<syntax::Attribute>> http_attribute_list;
%type <std::vector<syntax::Value>> string_list;
%type <syntax::Value> identifier;
%type <syntax::Value> sql_literal;
%type <syntax::Value> variable;
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
    LOAD identifier FROM load_method load_attributes {
    // XXX
    }
    ;

load_method:
    HTTP    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) LoadMethodType::HTTP); }
  | FILE    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) LoadMethodType::FILE); }
    ;

load_attributes:
    HTTP LEFT_ROUND_BRACKETS http_attribute_list RIGHT_ROUND_BRACKETS   { }
  | FILE variable                                                       { }
    ;

http_attribute_list:
    http_attribute_list COMMA http_attribute    { }
  | http_attribute                              { }
    ;

http_attribute:
    METHOD EQUAL http_method    { }
  | URL EQUAL STRING_LITERAL    { }
    ;

http_method:
    GET     { }
  | PUT     { }
  | POST    { }
    ;

variable:
    DOLLAR identifier   { }

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method { }
    ;

extract_method:
    CSV csv_attributes                              { }
  | JSON LEFT_ROUND_BRACKETS RIGHT_ROUND_BRACKETS   { }
    ;

csv_attributes:
    %empty                                                      { }
  | LEFT_ROUND_BRACKETS csv_attribute_list RIGHT_ROUND_BRACKETS { }
    ;

csv_attribute_list:
    csv_attribute_list COMMA csv_attribute  { }
  | csv_attribute                           { }
    ;

csv_attribute:
    ENCODING EQUAL STRING_LITERAL           { }
  | HEADER EQUAL csv_header_value           { }
  | DELIMITER EQUAL STRING_LITERAL          { }
  | QUOTE EQUAL STRING_LITERAL              { }
  | DATE FORMAT EQUAL STRING_LITERAL        { }
  | TIMESTAMP FORMAT EQUAL STRING_LITERAL   { }
    ;

csv_header_value:
    boolean                                                 { }
  | LEFT_ROUND_BRACKETS string_list RIGHT_ROUND_BRACKETS    { }

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
    AREA        { }
  | BAR         { }
  | BOX         { }
  | BUBBLE      { }
  | GRID        { }
  | HISTOGRAM   { }
  | LINE        { }
  | NUMBER      { }
  | PIE         { }
  | POINT       { }
  | SCATTER     { }
  | TABLE       { }
  | TEXT        { }
    ;

%%
void dashql::parser::Parser::error(const location_type& location, const std::string& message) {
    ctx.AddError(location, message);
}
