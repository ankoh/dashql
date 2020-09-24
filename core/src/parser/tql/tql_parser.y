//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

%skeleton "lalr1.cc"
%require "3.3"

%define api.namespace {dashql::tql}
%define api.parser.class {Parser}
%define api.prefix {tql_}
%define api.token.constructor
%define api.token.prefix {TQL_}
%define api.value.type variant
%define parse.assert
%define parse.trace
%define parse.error verbose
%locations

%param { dashql::tql::ParseContext &context }

%code requires {
#include <string>
#include <cstdlib>
#include <utility>
#include "dashql/parser/tql/tql_parse_context.h"
}

%code {
using namespace dashql::tql;

namespace dashql {
    namespace tql {
        namespace parser {
            Location locate(location location) {
                return {
                    {static_cast<uint32_t>(location.begin.line), static_cast<uint32_t>(location.begin.column)},
                    {static_cast<uint32_t>(location.end.line), static_cast<uint32_t>(location.end.column)}
                };
            }

            Location locate(location begin, location end) {
                return {
                    {static_cast<uint32_t>(begin.begin.line), static_cast<uint32_t>(begin.begin.column)},
                    {static_cast<uint32_t>(end.end.line), static_cast<uint32_t>(end.end.column)}
                };
            }
        } // namespace parser
    } // namespace tql
} // namespace dashql

using namespace dashql::tql::parser;

Parser::symbol_type tql_lex(ParseContext& context);
}

%token <int>                INTEGER_LITERAL     "integer literal"
%token <std::string_view>   IDENTIFIER_LITERAL  "identifier literal"
%token <std::string_view>   PLACEHOLDER_LITERAL "placeholder literal"
%token <std::string_view>   SQL_SELECT          "SQL select query"
%token <std::string_view>   SQL_WITH            "SQL with clause"
%token <std::string_view>   STRING_LITERAL      "string literal"
%token <uint32_t>           HEX_COLOR_LITERAL   "hex color literal"

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

%token <std::string_view>   AREA        "AREA keyword"
%token <std::string_view>   AS          "AS keyword"
%token <std::string_view>   AXES        "AXES keyword"
%token <std::string_view>   BAR         "BAR keyword"
%token <std::string_view>   BOX         "BOX keyword"
%token <std::string_view>   BUBBLE      "BUBBLE keyword"
%token <std::string_view>   CHART       "CHART keyword"
%token <std::string_view>   COLOR       "COLOR keyword"
%token <std::string_view>   COLUMN      "COLUMN keyword"
%token <std::string_view>   CSV         "CSV keyword"
%token <std::string_view>   DATE        "DATE keyword"
%token <std::string_view>   DATETIME    "DATETIME keyword"
%token <std::string_view>   DECLARE     "DECLARE keyword"
%token <std::string_view>   DELIMITER   "DELIMITER keyword"
%token <std::string_view>   ENCODING    "ENCODING keyword"
%token <std::string_view>   EXTRACT     "EXTRACT keyword"
%token <std::string_view>   FALSE       "FALSE keyword"
%token <std::string_view>   FIELD       "FIELD keyword"
%token <std::string_view>   FILE        "FILE keyword"
%token <std::string_view>   FLOAT       "FLOAT keyword"
%token <std::string_view>   FORMAT      "FORMAT keyword"
%token <std::string_view>   FROM        "FROM keyword"
%token <std::string_view>   GET         "GET keyword"
%token <std::string_view>   GRID        "GRID keyword"
%token <std::string_view>   HEADER      "HEADER keyword"
%token <std::string_view>   HEIGHT      "HEIGHT keyword"
%token <std::string_view>   HISTOGRAM   "HISTOGRAM keyword"
%token <std::string_view>   HORIZONTAL  "HORIZONTAL keyword"
%token <std::string_view>   HTTP        "HTTP keyword"
%token <std::string_view>   INTEGER     "INTEGER keyword"
%token <std::string_view>   JSON        "JSON keyword"
%token <std::string_view>   LG          "LG keyword"
%token <std::string_view>   LINE        "LINE keyword"
%token <std::string_view>   LINEAR      "LINEAR keyword"
%token <std::string_view>   LOAD        "LOAD keyword"
%token <std::string_view>   LOG         "LOG keyword"
%token <std::string_view>   MD          "MD keyword"
%token <std::string_view>   METHOD      "METHOD keyword"
%token <std::string_view>   NUMBER      "NUMBER keyword"
%token <std::string_view>   PALETTE     "PALETTE keyword"
%token <std::string_view>   PARAMETER   "PARAMETER keyword"
%token <std::string_view>   PARQUET     "PARQUET keyword"
%token <std::string_view>   PERCENT     "PERCENT keyword"
%token <std::string_view>   PIE         "PIE keyword"
%token <std::string_view>   PLOT        "PLOT keyword"
%token <std::string_view>   POINT       "POINT keyword"
%token <std::string_view>   POST        "POST keyword"
%token <std::string_view>   PUT         "PUT keyword"
%token <std::string_view>   PX          "PX keyword"
%token <std::string_view>   QUERY       "QUERY keyword"
%token <std::string_view>   QUOTE       "QUOTE keyword"
%token <std::string_view>   RGB         "RGB keyword"
%token <std::string_view>   SCALE       "SCALE keyword"
%token <std::string_view>   SCATTER     "SCATTER keyword"
%token <std::string_view>   SHOW        "SHOW keyword"
%token <std::string_view>   SM          "SM keyword"
%token <std::string_view>   STACKED     "STACKED keyword"
%token <std::string_view>   TABLE       "TABLE keyword"
%token <std::string_view>   TEXT        "TEXT keyword"
%token <std::string_view>   TIME        "TIME keyword"
%token <std::string_view>   TIMESTAMP   "TIMESTAMP keyword"
%token <std::string_view>   TITLE       "TITLE keyword"
%token <std::string_view>   TRUE        "TRUE keyword"
%token <std::string_view>   TYPE        "TYPE keyword"
%token <std::string_view>   URL         "URL keyword"
%token <std::string_view>   USING       "USING keyword"
%token <std::string_view>   VERTICAL    "VERTICAL keyword"
%token <std::string_view>   VIS         "VIS keyword"
%token <std::string_view>   VISUALISE   "VISUALISE keyword"
%token <std::string_view>   VISUALIZE   "VISUALIZE keyword"
%token <std::string_view>   VIZ         "VIZ keyword"
%token <std::string_view>   WIDTH       "WIDTH keyword"
%token <std::string_view>   X           "X keyword"
%token <std::string_view>   XL          "XL keyword"
%token <std::string_view>   Y           "Y keyword"

%token EOF 0    "end of file"

%type <Boolean>                                                 boolean;
%type <ExtractStatement::CSVExtract::Attribute>                 csv_attribute;
%type <ExtractStatement::ExtractMethod>                         extract_method;
%type <ExtractStatement>                                        extract_statement;
%type <LoadStatement::HTTPLoader::Attribute>                    load_method_http_attribute;
%type <LoadStatement::HTTPLoader::Method>                       http_method;
%type <LoadStatement::LoadMethod>                               load_method;
%type <LoadStatement>                                           load_statement;
%type <ParameterDeclaration>                                    parameter_declaration;
%type <ParameterType>                                           parameter_type;
%type <QueryStatement>                                          query_statement;
%type <Statement>                                               statement;
%type <std::optional<ExtractStatement::CSVExtract::Attributes>> csv_attributes;
%type <std::optional<String>>                                   alias;
%type <std::variant<Boolean, std::vector<String>>>              csv_header_value;
%type <std::vector<ExtractStatement::CSVExtract::Attribute>>    csv_attribute_list;
%type <std::vector<LoadStatement::HTTPLoader::Attribute>>       load_method_http_attribute_list;
%type <std::vector<String>>                                     string_list;
%type <String>                                                  identifier;
%type <String>                                                  keyword;
%type <String>                                                  sql_literal;
%type <Variable>                                                variable;
%type <VizStatement::VizType>                                   viz_type;
%type <VizStatement>                                            viz_statement;

%%

%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { context.DefineStatement(std::move($2), locate(@2, @3)); }
  | statement_list error SEMICOLON      { yyclearin; yyerrok; }
  | %empty
    ;

statement:
    parameter_declaration   { $$ = $1; }
  | load_statement          { $$ = $1; }
  | extract_statement       { $$ = $1; }
  | query_statement         { $$ = $1; }
  | viz_statement           { $$ = $1; }
    ;

parameter_declaration:
    DECLARE PARAMETER identifier alias TYPE parameter_type  { $$ = ParameterDeclaration { locate(@1, @6), $4.value_or($3), $3, $6 }; }
    ;

identifier:
    IDENTIFIER_LITERAL  { $$ = String { locate(@1), std::string($1) }; }
  | STRING_LITERAL      { $$ = String { locate(@1), std::string($1) }; }
  | PLACEHOLDER_LITERAL { $$ = String { locate(@1), std::string($1) }; }
  | keyword             { $$ = $1; }
    ;

keyword:
    AREA        { $$ = String { locate(@1), std::string($1) }; }
  | AS          { $$ = String { locate(@1), std::string($1) }; }
  | AXES        { $$ = String { locate(@1), std::string($1) }; }
  | BAR         { $$ = String { locate(@1), std::string($1) }; }
  | BOX         { $$ = String { locate(@1), std::string($1) }; }
  | BUBBLE      { $$ = String { locate(@1), std::string($1) }; }
  | CHART       { $$ = String { locate(@1), std::string($1) }; }
  | COLOR       { $$ = String { locate(@1), std::string($1) }; }
  | COLUMN      { $$ = String { locate(@1), std::string($1) }; }
  | CSV         { $$ = String { locate(@1), std::string($1) }; }
  | DATE        { $$ = String { locate(@1), std::string($1) }; }
  | DATETIME    { $$ = String { locate(@1), std::string($1) }; }
  | DECLARE     { $$ = String { locate(@1), std::string($1) }; }
  | DELIMITER   { $$ = String { locate(@1), std::string($1) }; }
  | ENCODING    { $$ = String { locate(@1), std::string($1) }; }
  | EXTRACT     { $$ = String { locate(@1), std::string($1) }; }
  | FALSE       { $$ = String { locate(@1), std::string($1) }; }
  | FIELD       { $$ = String { locate(@1), std::string($1) }; }
  | FILE        { $$ = String { locate(@1), std::string($1) }; }
  | FLOAT       { $$ = String { locate(@1), std::string($1) }; }
  | FORMAT      { $$ = String { locate(@1), std::string($1) }; }
  | FROM        { $$ = String { locate(@1), std::string($1) }; }
  | GET         { $$ = String { locate(@1), std::string($1) }; }
  | GRID        { $$ = String { locate(@1), std::string($1) }; }
  | HEADER      { $$ = String { locate(@1), std::string($1) }; }
  | HEIGHT      { $$ = String { locate(@1), std::string($1) }; }
  | HISTOGRAM   { $$ = String { locate(@1), std::string($1) }; }
  | HORIZONTAL  { $$ = String { locate(@1), std::string($1) }; }
  | HTTP        { $$ = String { locate(@1), std::string($1) }; }
  | INTEGER     { $$ = String { locate(@1), std::string($1) }; }
  | JSON        { $$ = String { locate(@1), std::string($1) }; }
  | LG          { $$ = String { locate(@1), std::string($1) }; }
  | LINE        { $$ = String { locate(@1), std::string($1) }; }
  | LINEAR      { $$ = String { locate(@1), std::string($1) }; }
  | LOAD        { $$ = String { locate(@1), std::string($1) }; }
  | LOG         { $$ = String { locate(@1), std::string($1) }; }
  | MD          { $$ = String { locate(@1), std::string($1) }; }
  | METHOD      { $$ = String { locate(@1), std::string($1) }; }
  | NUMBER      { $$ = String { locate(@1), std::string($1) }; }
  | PALETTE     { $$ = String { locate(@1), std::string($1) }; }
  | PARAMETER   { $$ = String { locate(@1), std::string($1) }; }
  | PARQUET     { $$ = String { locate(@1), std::string($1) }; }
  | PERCENT     { $$ = String { locate(@1), std::string($1) }; }
  | PIE         { $$ = String { locate(@1), std::string($1) }; }
  | PLOT        { $$ = String { locate(@1), std::string($1) }; }
  | POINT       { $$ = String { locate(@1), std::string($1) }; }
  | POST        { $$ = String { locate(@1), std::string($1) }; }
  | PUT         { $$ = String { locate(@1), std::string($1) }; }
  | PX          { $$ = String { locate(@1), std::string($1) }; }
  | QUERY       { $$ = String { locate(@1), std::string($1) }; }
  | QUOTE       { $$ = String { locate(@1), std::string($1) }; }
  | RGB         { $$ = String { locate(@1), std::string($1) }; }
  | SCALE       { $$ = String { locate(@1), std::string($1) }; }
  | SCATTER     { $$ = String { locate(@1), std::string($1) }; }
  | SHOW        { $$ = String { locate(@1), std::string($1) }; }
  | SM          { $$ = String { locate(@1), std::string($1) }; }
  | STACKED     { $$ = String { locate(@1), std::string($1) }; }
  | TABLE       { $$ = String { locate(@1), std::string($1) }; }
  | TEXT        { $$ = String { locate(@1), std::string($1) }; }
  | TIME        { $$ = String { locate(@1), std::string($1) }; }
  | TIMESTAMP   { $$ = String { locate(@1), std::string($1) }; }
  | TITLE       { $$ = String { locate(@1), std::string($1) }; }
  | TRUE        { $$ = String { locate(@1), std::string($1) }; }
  | TYPE        { $$ = String { locate(@1), std::string($1) }; }
  | URL         { $$ = String { locate(@1), std::string($1) }; }
  | USING       { $$ = String { locate(@1), std::string($1) }; }
  | VERTICAL    { $$ = String { locate(@1), std::string($1) }; }
  | VIS         { $$ = String { locate(@1), std::string($1) }; }
  | VISUALISE   { $$ = String { locate(@1), std::string($1) }; }
  | VISUALIZE   { $$ = String { locate(@1), std::string($1) }; }
  | VIZ         { $$ = String { locate(@1), std::string($1) }; }
  | WIDTH       { $$ = String { locate(@1), std::string($1) }; }
  | X           { $$ = String { locate(@1), std::string($1) }; }
  | XL          { $$ = String { locate(@1), std::string($1) }; }
  | Y           { $$ = String { locate(@1), std::string($1) }; }
    ;

alias:
    %empty        { $$ = std::nullopt; }
  | AS identifier { $$ = $2; }
    ;

parameter_type:
    INTEGER     { $$ = ParameterType { locate(@1), ParameterType::Type::Integer }; }
  | FLOAT       { $$ = ParameterType { locate(@1), ParameterType::Type::Float }; }
  | TEXT        { $$ = ParameterType { locate(@1), ParameterType::Type::Text }; }
  | DATE        { $$ = ParameterType { locate(@1), ParameterType::Type::Date }; }
  | DATETIME    { $$ = ParameterType { locate(@1), ParameterType::Type::DateTime }; }
  | TIME        { $$ = ParameterType { locate(@1), ParameterType::Type::Time }; }
  | FILE        { $$ = ParameterType { locate(@1), ParameterType::Type::File }; }
    ;

load_statement:
    LOAD identifier FROM load_method    { $$ = LoadStatement { locate(@1, @4), $2, $4 }; }
    ;

load_method:
    HTTP LEFT_ROUND_BRACKETS load_method_http_attribute_list RIGHT_ROUND_BRACKETS   { $$ = LoadStatement::HTTPLoader { locate(@1, @4), LoadStatement::HTTPLoader::Attributes { locate(@3), $3 } }; }
  | FILE variable                                                                   { $$ = LoadStatement::FileLoader { locate(@1, @2), $2 }; }
    ;

load_method_http_attribute_list:
    load_method_http_attribute_list COMMA load_method_http_attribute    { $1.push_back($3); $$ = $1; }
  | load_method_http_attribute                                          { $$ = std::vector<LoadStatement::HTTPLoader::Attribute> { $1 }; }
    ;

load_method_http_attribute:
    METHOD EQUAL http_method    { $$ = $3; }
  | URL EQUAL STRING_LITERAL    { $$ = LoadStatement::HTTPLoader::URL { locate(@3), String { locate(@3), std::string($3) } }; }
    ;

http_method:
    GET     { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Get }; }
  | PUT     { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Put }; }
  | POST    { $$ = LoadStatement::HTTPLoader::Method { locate(@1), LoadStatement::HTTPLoader::Method::Verb::Post }; }
    ;

variable:
    DOLLAR identifier   { $$ = Variable { locate(@1, @2), $2 }; }

extract_statement:
    EXTRACT identifier FROM identifier USING extract_method { $$ = ExtractStatement { locate(@1, @6), $2, $4, $6 }; }
    ;

extract_method:
    CSV csv_attributes                              { $$ = ExtractStatement::CSVExtract { locate(@1, @2), $2 }; }
  | JSON LEFT_ROUND_BRACKETS RIGHT_ROUND_BRACKETS   { $$ = ExtractStatement::JSONPathExtract { locate(@1, @3) }; }
    ;

csv_attributes:
    %empty                                                      { $$ = std::nullopt; }
  | LEFT_ROUND_BRACKETS csv_attribute_list RIGHT_ROUND_BRACKETS { $$ = ExtractStatement::CSVExtract::Attributes { locate(@1, @3), $2 }; }
    ;

csv_attribute_list:
    csv_attribute_list COMMA csv_attribute  { $1.push_back($3); $$ = $1; }
  | csv_attribute                           { $$ = std::vector<ExtractStatement::CSVExtract::Attribute> { $1 }; }
    ;

csv_attribute:
    ENCODING EQUAL STRING_LITERAL           { $$ = ExtractStatement::CSVExtract::Encoding { locate(@1, @3), String { locate(@3), std::string($3) } }; }
  | HEADER EQUAL csv_header_value           { $$ = ExtractStatement::CSVExtract::Header { locate(@1, @3), $3 }; }
  | DELIMITER EQUAL STRING_LITERAL          { $$ = ExtractStatement::CSVExtract::Delimiter { locate(@1, @3), String { locate(@3), std::string($3) } }; }
  | QUOTE EQUAL STRING_LITERAL              { $$ = ExtractStatement::CSVExtract::Quote { locate(@1, @3), String { locate(@3), std::string($3) } }; }
  | DATE FORMAT EQUAL STRING_LITERAL        { $$ = ExtractStatement::CSVExtract::DateFormat { locate(@1, @4), String { locate(@4), std::string($4) } }; }
  | TIMESTAMP FORMAT EQUAL STRING_LITERAL   { $$ = ExtractStatement::CSVExtract::TimestampFormat { locate(@1, @4), String { locate(@4), std::string($4) } }; }
    ;

csv_header_value:
    boolean                                                 { $$ = $1; }
  | LEFT_ROUND_BRACKETS string_list RIGHT_ROUND_BRACKETS    { $$ = $2; }

boolean:
    TRUE    { $$ = Boolean { locate(@1), true }; }
  | FALSE   { $$ = Boolean { locate(@1), false }; }
    ;

string_list:
    string_list COMMA STRING_LITERAL    { $1.push_back(String { locate(@3), std::string($3) }); $$ = $1; }
  | STRING_LITERAL                      { $$ = std::vector<String> { String { locate(@1), std::string($1) } }; }
    ;

query_statement:
    QUERY identifier AS sql_literal { $$ = QueryStatement { locate(@1, @4), $2, $4 }; }
  | sql_literal                     { $$ = QueryStatement { locate(@1, @1), {}, $1 }; }
    ;

sql_literal:
    SQL_SELECT  { $$ = String { locate(@1), std::string($1) }; }
  | SQL_WITH    { $$ = String { locate(@1), std::string($1) }; }
    ;

viz_statement:
    viz_statement_prefix identifier FROM identifier USING viz_type  { $$ = VizStatement { locate(@1, @6), $2, $4, $6 }; }
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

void dashql::tql::Parser::error(const location_type& location, const std::string& message) {
    context.Error(locate(location), message);
}
