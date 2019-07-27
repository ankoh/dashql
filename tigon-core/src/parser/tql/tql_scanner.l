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
#include <istream>
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
// The input stream of the scanner
extern std::istream *in;

}  // namespace tql
}  // namespace tigon

using namespace tigon;
using namespace tigon::tql;

// Work around an incompatibility in flex (at least versions
// 2.5.31 through 2.5.33): it generates code that does
// not conform to C89.  See Debian bug 333231
// <http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=333231>.
#undef yywrap
#define yywrap() 1

// Declare the yylex function
#define YY_DECL Parser::symbol_type yylex(ParseContext& ctx)
// Configure the scanner to use istreams
#define YY_INPUT(buffer, result, max_size)  \
    result = 0; \
    while (true) { \
        int c = in->get(); \
        if (in->eof()) break; \
        buffer[result++] = c; \
        if (result == max_size || c == '\n') break; \
    }
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

%{
// Code run each time a token is matched.
// We just update the location of the token.
#define YY_USER_ACTION  { loc.columns(yyleng); }
%}

%%

%{
// Code runs each time yylex is called.
// Set the beginning of the token to the end of the previous token.
loc.step ();
%}

";"                 { return Parser::make_SEMICOLON(loc); }
"("                 { return Parser::make_LRB(loc); }
")"                 { return Parser::make_RRB(loc); }
"["                 { return Parser::make_LSB(loc); }
"]"                 { return Parser::make_RSB(loc); }
"="                 { return Parser::make_EQUAL(loc); }
","                 { return Parser::make_COMMA(loc); }
"*"                 { return Parser::make_STAR(loc); }

"area"              { return Parser::make_AREA(loc); }
"as"                { return Parser::make_AS(loc); }
"axes"              { return Parser::make_AXES(loc); }
"bar"               { return Parser::make_BAR(loc); }
"box"               { return Parser::make_BOX(loc); }
"bubble"            { return Parser::make_BUBBLE(loc); }
"chart"             { return Parser::make_CHART(loc); }
"color"             { return Parser::make_COLOR(loc); }
"column"            { return Parser::make_COLUMN(loc); }
"csv"               { return Parser::make_CSV(loc); }
"date"              { return Parser::make_DATE(loc); }
"datetime"          { return Parser::make_DATETIME(loc); }
"declare"           { return Parser::make_DECLARE(loc); }
"display"           { return Parser::make_DISPLAY(loc); }
"extract"           { return Parser::make_EXTRACT(loc); }
"field"             { return Parser::make_FIELD(loc); }
"file"              { return Parser::make_FILE(loc); }
"float"             { return Parser::make_FLOAT(loc); }
"from"              { return Parser::make_FROM(loc); }
"get"               { return Parser::make_GET(loc); }
"grid"              { return Parser::make_GRID(loc); }
"height"            { return Parser::make_HEIGHT(loc); }
"histogram"         { return Parser::make_HISTOGRAM(loc); }
"horizontal"        { return Parser::make_HORIZONTAL(loc); }
"http"              { return Parser::make_HTTP(loc); }
"integer"           { return Parser::make_INTEGER(loc); }
"jsonpath"          { return Parser::make_JSONPATH(loc); }
"layout"            { return Parser::make_LAYOUT(loc); }
"lg"                { return Parser::make_LG(loc); }
"line"              { return Parser::make_LINE(loc); }
"linear"            { return Parser::make_LINEAR(loc); }
"load"              { return Parser::make_LOAD(loc); }
"log"               { return Parser::make_LOG(loc); }
"md"                { return Parser::make_MD(loc); }
"method"            { return Parser::make_METHOD(loc); }
"number"            { return Parser::make_NUMBER(loc); }
"palette"           { return Parser::make_PALETTE(loc); }
"parameter"         { return Parser::make_PARAMETER(loc); }
"percent"           { return Parser::make_PERCENT(loc); }
"pie"               { return Parser::make_PIE(loc); }
"plot"              { return Parser::make_PLOT(loc); }
"point"             { return Parser::make_POINT(loc); }
"post"              { return Parser::make_POST(loc); }
"put"               { return Parser::make_PUT(loc); }
"px"                { return Parser::make_PX(loc); }
"rgb"               { return Parser::make_RGB(loc); }
"scale"             { return Parser::make_SCALE(loc); }
"scatter"           { return Parser::make_SCATTER(loc); }
"sm"                { return Parser::make_SM(loc); }
"stacked"           { return Parser::make_STACKED(loc); }
"table"             { return Parser::make_TABLE(loc); }
"text"              { return Parser::make_TEXT(loc); }
"time"              { return Parser::make_TIME(loc); }
"url"               { return Parser::make_URL(loc); }
"using"             { return Parser::make_USING(loc); }
"vertical"          { return Parser::make_VERTICAL(loc); }
"width"             { return Parser::make_WIDTH(loc); }
"x"                 { return Parser::make_X(loc); }
"xl"                { return Parser::make_XL(loc); }
"y"                 { return Parser::make_Y(loc); }

select[^;]*         { return Parser::make_SQL_SELECT(yytext, loc); }
with[^;]*           { return Parser::make_SQL_WITH(yytext, loc); }
[a-z][a-z0-9_]*     { return Parser::make_IDENTIFIER_LITERAL(yytext, loc); }
'[^']*'             { return Parser::make_STRING_LITERAL(yytext, loc); }
[0-9]+              {
                        uint32_t value = 0;
                        try {
                            value = std::stoul(yytext);
                        } catch(const std::invalid_argument &err) {
                            ctx.Error(loc.begin.line, loc.begin.column, "integer is invalid");
                        } catch(const std::out_of_range &err) {
                            ctx.Error(loc.begin.line, loc.begin.column, "integer out of range");
                        }
                        return Parser::make_INTEGER_LITERAL(value, loc);
                    }

[ \t]+              { loc.step(); }
\n                  { loc.lines (yyleng); loc.step (); }

<<EOF>>             { return Parser::make_EOF(loc); }
.                   { ctx.Error(loc.begin.line, loc.begin.column, "invalid character"); }

%%

// ---------------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------------

// The input stream
tigon::tql::location tigon::tql::loc;
// The input stream of the scanner
std::istream *tigon::tql::in = nullptr;

// Begin a scan
void tigon::tql::ParseContext::beginScan(std::istream &is) {
    yy_flex_debug = trace_scanning;
    in = &is;
}

// End a scan
void tigon::tql::ParseContext::endScan() {
    in = nullptr;
}

