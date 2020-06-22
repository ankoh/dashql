%{
//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------
%}

%{
// ---------------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------------
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <string>
#include <string_view>
#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/parser/tql/tql_parser.h"

// ISO C++17 does not allow 'register' storage class specifier
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wregister"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wregister"

namespace tigon {
    namespace tql {
        // The location of the current token
        extern tigon::tql::location loc;
        // The input string view
        extern std::string_view in;
        // The reader offset
        extern size_t reader_offset;
        // The parser offset
        extern size_t parser_offset;

        // Get the token text
        inline std::string_view getTokenText() { return in.substr(parser_offset - tql_leng, tql_leng); }

        namespace scanner {
            Location locate(class location location) {
                return {
                    {location.begin.line, location.begin.column},
                    {location.end.line, location.end.column}
                };
            }
        } // namespace scanner
    } // namespace tql
} // namespace tigon

using namespace tigon;
using namespace tigon::tql;
using namespace tigon::tql::scanner;

// Work around an incompatibility in flex (at least versions
// 2.5.31 through 2.5.33): it generates code that does
// not conform to C89.  See Debian bug 333231
// <http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=333231>.
#undef yywrap
#define yywrap() 1

// Declare the tql_lex function
#define YY_DECL Parser::symbol_type tql_lex(tigon::tql::ParseContext& context)
// Configure the scanner to use string views
#define YY_INPUT(buffer, bytes_read, max_bytes) \
    bytes_read = in.copy(buffer, max_bytes, reader_offset); \
    reader_offset += bytes_read;
%}

%{
// ---------------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------------
%}
%{
// noyywrap:    Disable yywrap (EOF == end of parsing)
// nounput:     Disable manipulation of input stream
// noinput:     Disable explicit fetch of the next character
// batch:       Scanner in batch-mode (vs. interactive)
// debug:       Write debug info to stderr
// caseless:    Case-insensitive pattern matching
%}
%option noyywrap
%option nounput
%option noinput
%option batch
%option debug
%option caseless
%option prefix="tql_"

%{
// Code run each time a token is matched.
// We just update the location of the token.
#define YY_USER_ACTION  { loc.columns(tql_leng); parser_offset += tql_leng; }
%}

%%

%{
// Code runs each time tql_lex is called.
// Set the beginning of the token to the end of the previous token.
loc.step();
%}

";" { return Parser::make_SEMICOLON(loc); }
"(" { return Parser::make_LRB(loc); }
")" { return Parser::make_RRB(loc); }
"[" { return Parser::make_LSB(loc); }
"]" { return Parser::make_RSB(loc); }
"=" { return Parser::make_EQUAL(loc); }
"," { return Parser::make_COMMA(loc); }
"/" { return Parser::make_SLASH(loc); }
"*" { return Parser::make_STAR(loc); }

"area"          { return Parser::make_AREA(getTokenText(), loc); }
"as"            { return Parser::make_AS(getTokenText(), loc); }
"axes"          { return Parser::make_AXES(getTokenText(), loc); }
"bar"           { return Parser::make_BAR(getTokenText(), loc); }
"box"           { return Parser::make_BOX(getTokenText(), loc); }
"bubble"        { return Parser::make_BUBBLE(getTokenText(), loc); }
"chart"         { return Parser::make_CHART(getTokenText(), loc); }
"color"         { return Parser::make_COLOR(getTokenText(), loc); }
"column"        { return Parser::make_COLUMN(getTokenText(), loc); }
"csv"           { return Parser::make_CSV(getTokenText(), loc); }
"date"          { return Parser::make_DATE(getTokenText(), loc); }
"datetime"      { return Parser::make_DATETIME(getTokenText(), loc); }
"declare"       { return Parser::make_DECLARE(getTokenText(), loc); }
"extract"       { return Parser::make_EXTRACT(getTokenText(), loc); }
"field"         { return Parser::make_FIELD(getTokenText(), loc); }
"file"          { return Parser::make_FILE(getTokenText(), loc); }
"float"         { return Parser::make_FLOAT(getTokenText(), loc); }
"from"          { return Parser::make_FROM(getTokenText(), loc); }
"get"           { return Parser::make_GET(getTokenText(), loc); }
"grid"          { return Parser::make_GRID(getTokenText(), loc); }
"height"        { return Parser::make_HEIGHT(getTokenText(), loc); }
"histogram"     { return Parser::make_HISTOGRAM(getTokenText(), loc); }
"horizontal"    { return Parser::make_HORIZONTAL(getTokenText(), loc); }
"http"          { return Parser::make_HTTP(getTokenText(), loc); }
"integer"       { return Parser::make_INTEGER(getTokenText(), loc); }
"json"          { return Parser::make_JSON(getTokenText(), loc); }
"lg"            { return Parser::make_LG(getTokenText(), loc); }
"line"          { return Parser::make_LINE(getTokenText(), loc); }
"linear"        { return Parser::make_LINEAR(getTokenText(), loc); }
"load"          { return Parser::make_LOAD(getTokenText(), loc); }
"log"           { return Parser::make_LOG(getTokenText(), loc); }
"md"            { return Parser::make_MD(getTokenText(), loc); }
"method"        { return Parser::make_METHOD(getTokenText(), loc); }
"number"        { return Parser::make_NUMBER(getTokenText(), loc); }
"palette"       { return Parser::make_PALETTE(getTokenText(), loc); }
"parameter"     { return Parser::make_PARAMETER(getTokenText(), loc); }
"parquet"       { return Parser::make_PARQUET(getTokenText(), loc); }
"percent"       { return Parser::make_PERCENT(getTokenText(), loc); }
"pie"           { return Parser::make_PIE(getTokenText(), loc); }
"plot"          { return Parser::make_PLOT(getTokenText(), loc); }
"point"         { return Parser::make_POINT(getTokenText(), loc); }
"post"          { return Parser::make_POST(getTokenText(), loc); }
"put"           { return Parser::make_PUT(getTokenText(), loc); }
"px"            { return Parser::make_PX(getTokenText(), loc); }
"query"         { return Parser::make_QUERY(getTokenText(), loc); }
"rgb"           { return Parser::make_RGB(getTokenText(), loc); }
"scale"         { return Parser::make_SCALE(getTokenText(), loc); }
"scatter"       { return Parser::make_SCATTER(getTokenText(), loc); }
"show"          { return Parser::make_SHOW(getTokenText(), loc); }
"sm"            { return Parser::make_SM(getTokenText(), loc); }
"stacked"       { return Parser::make_STACKED(getTokenText(), loc); }
"table"         { return Parser::make_TABLE(getTokenText(), loc); }
"text"          { return Parser::make_TEXT(getTokenText(), loc); }
"time"          { return Parser::make_TIME(getTokenText(), loc); }
"title"         { return Parser::make_TITLE(getTokenText(), loc); }
"url"           { return Parser::make_URL(getTokenText(), loc); }
"using"         { return Parser::make_USING(getTokenText(), loc); }
"vertical"      { return Parser::make_VERTICAL(getTokenText(), loc); }
"vis"           { return Parser::make_VIS(getTokenText(), loc); }
"visualise"     { return Parser::make_VISUALISE(getTokenText(), loc); }
"visualize"     { return Parser::make_VISUALIZE(getTokenText(), loc); }
"viz"           { return Parser::make_VIZ(getTokenText(), loc); }
"width"         { return Parser::make_WIDTH(getTokenText(), loc); }
"x"             { return Parser::make_X(getTokenText(), loc); }
"xl"            { return Parser::make_XL(getTokenText(), loc); }
"y"             { return Parser::make_Y(getTokenText(), loc); }

select[^;]*     { return Parser::make_SQL_SELECT(getTokenText(), loc); }
with[^;]*       { return Parser::make_SQL_WITH(getTokenText(), loc); }
[a-z][a-z0-9_]* { return Parser::make_IDENTIFIER_LITERAL(getTokenText(), loc); }
['"][^'"]*['"]  {
                    auto text = getTokenText();
                    return Parser::make_STRING_LITERAL(text.substr(1, text.size() - 2), loc);
                }
[0-9]+          {
                    uint32_t value = 0;
                    try {
                        value = std::stoul(tql_text);
                    } catch(const std::invalid_argument &error) {
                        context.Error(locate(loc), "integer is invalid");
                    } catch(const std::out_of_range &error) {
                        context.Error(locate(loc), "integer out of range");
                    }
                    return Parser::make_INTEGER_LITERAL(value, loc);
                }

[ \t]+  { loc.step(); }
\n      { loc.lines(1); loc.step(); }

<<EOF>> { return Parser::make_EOF(loc); }
.       { context.Error(locate(loc), "invalid character"); }

%%

// ---------------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------------

// The input location
tigon::tql::location tigon::tql::loc;
// The input view of the scanner
std::string_view tigon::tql::in;
// The reader offset
size_t tigon::tql::reader_offset;
// The parser offset
size_t tigon::tql::parser_offset;

// Begin a scan
void tigon::tql::ParseContext::beginScan(std::string_view s) {
    tql__flex_debug = trace_scanning;
    in = s;
    reader_offset = 0;
    parser_offset = 0;
}

// End a scan
void tigon::tql::ParseContext::endScan() {
    in = {};
    reader_offset = 0;
    parser_offset = 0;
}
