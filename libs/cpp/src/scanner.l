%{
// Copyright (c) 2020 The DashQL Authors
%}

%{
// Header
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <sstream>
#include <string_view>
#include <string>
#include "dashql/parser/parse_context.h"
#include "dashql/parser/parser.h"

// ISO C++17 does not allow 'register' storage class specifier
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wregister"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wregister"

using namespace dashql;
using namespace dashql::parser;
namespace syntax = dashql::proto::syntax;

namespace dashql {
namespace parser {

// The location of the current token
extern syntax::Location loc;
// The offset the comment (if any)
extern syntax::Location comment_begin;
// The input string view
extern std::string_view in;
// The reader offset
extern size_t scanner_offset;

} // namespace parser
} // namespace dashql

// Work around an incompatibility in flex (at least versions
// 2.5.31 through 2.5.33): it generates code that does
// not conform to C89.  See Debian bug 333231
// <http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=333231>.
#undef yywrap
#define yywrap() 1

// Declare the yylex function
#define YY_DECL Parser::symbol_type yylex(dashql::parser::ParseContext& ctx)
// Init yyloc
#define YY_USER_INIT loc = syntax::Location();
// Configure the scanner to use string views
#define YY_INPUT(buffer, bytes_read, max_bytes) \
    bytes_read = in.copy(buffer, max_bytes, scanner_offset); \
    scanner_offset += bytes_read;
%}

%{
// Options
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

%x C_COMMENT

%{
// Code run each time a token is matched.
// We just update the location of the token.
#define YY_USER_ACTION { \
    loc = syntax::Location(loc.offset() + yyleng, 0); \
}
%}

%%

%{
// Code runs each time yylex is called.
// Start a new token.
loc =  syntax::Location(loc.offset(), 0);
%}

","             { return Parser::make_COMMA(loc); }
";"             { return Parser::make_SEMICOLON(loc); }
"("             { return Parser::make_LRB(loc); }
")"             { return Parser::make_RRB(loc); }
"["             { return Parser::make_LSB(loc); }
"]"             { return Parser::make_RSB(loc); }
"*"             { return Parser::make_STAR(loc); }
"/"             { return Parser::make_SLASH(loc); }
"="             { return Parser::make_EQUAL(loc); }
"$"             { return Parser::make_DOLLAR(loc); }

"area"          { return Parser::make_AREA(loc); }
"as"            { return Parser::make_AS(loc); }
"axes"          { return Parser::make_AXES(loc); }
"bar"           { return Parser::make_BAR(loc); }
"box"           { return Parser::make_BOX(loc); }
"bubble"        { return Parser::make_BUBBLE(loc); }
"chart"         { return Parser::make_CHART(loc); }
"color"         { return Parser::make_COLOR(loc); }
"column"        { return Parser::make_COLUMN(loc); }
"csv"           { return Parser::make_CSV(loc); }
"date"          { return Parser::make_DATE(loc); }
"datetime"      { return Parser::make_DATETIME(loc); }
"declare"       { return Parser::make_DECLARE(loc); }
"delimiter"     { return Parser::make_DELIMITER(loc); }
"encoding"      { return Parser::make_ENCODING(loc); }
"extract"       { return Parser::make_EXTRACT(loc); }
"false"         { return Parser::make_BOOLEAN_LITERAL(false, loc); }
"field"         { return Parser::make_FIELD(loc); }
"file"          { return Parser::make_FILE(loc); }
"float"         { return Parser::make_FLOAT(loc); }
"format"        { return Parser::make_FORMAT(loc); }
"from"          { return Parser::make_FROM(loc); }
"get"           { return Parser::make_GET(loc); }
"grid"          { return Parser::make_GRID(loc); }
"header"        { return Parser::make_HEADER(loc); }
"height"        { return Parser::make_HEIGHT(loc); }
"histogram"     { return Parser::make_HISTOGRAM(loc); }
"horizontal"    { return Parser::make_HORIZONTAL(loc); }
"http"          { return Parser::make_HTTP(loc); }
"integer"       { return Parser::make_INTEGER(loc); }
"json"          { return Parser::make_JSON(loc); }
"lg"            { return Parser::make_LG(loc); }
"line"          { return Parser::make_LINE(loc); }
"linear"        { return Parser::make_LINEAR(loc); }
"load"          { return Parser::make_LOAD(loc); }
"log"           { return Parser::make_LOG(loc); }
"md"            { return Parser::make_MD(loc); }
"method"        { return Parser::make_METHOD(loc); }
"number"        { return Parser::make_NUMBER(loc); }
"palette"       { return Parser::make_PALETTE(loc); }
"parameter"     { return Parser::make_PARAMETER(loc); }
"parquet"       { return Parser::make_PARQUET(loc); }
"percent"       { return Parser::make_PERCENT(loc); }
"pie"           { return Parser::make_PIE(loc); }
"plot"          { return Parser::make_PLOT(loc); }
"point"         { return Parser::make_POINT(loc); }
"post"          { return Parser::make_POST(loc); }
"put"           { return Parser::make_PUT(loc); }
"px"            { return Parser::make_PX(loc); }
"query"         { return Parser::make_QUERY(loc); }
"quote"         { return Parser::make_QUOTE(loc); }
"rgb"           { return Parser::make_RGB(loc); }
"scale"         { return Parser::make_SCALE(loc); }
"scatter"       { return Parser::make_SCATTER(loc); }
"select"        { return Parser::make_SELECT(loc); }
"show"          { return Parser::make_SHOW(loc); }
"sm"            { return Parser::make_SM(loc); }
"stacked"       { return Parser::make_STACKED(loc); }
"table"         { return Parser::make_TABLE(loc); }
"text"          { return Parser::make_TEXT(loc); }
"time"          { return Parser::make_TIME(loc); }
"timestamp"     { return Parser::make_TIMESTAMP(loc); }
"title"         { return Parser::make_TITLE(loc); }
"true"          { return Parser::make_BOOLEAN_LITERAL(true, loc); }
"type"          { return Parser::make_TYPE(loc); }
"url"           { return Parser::make_URL(loc); }
"using"         { return Parser::make_USING(loc); }
"vertical"      { return Parser::make_VERTICAL(loc); }
"vis"           { return Parser::make_VIS(loc); }
"visualise"     { return Parser::make_VISUALISE(loc); }
"visualize"     { return Parser::make_VISUALIZE(loc); }
"viz"           { return Parser::make_VIZ(loc); }
"width"         { return Parser::make_WIDTH(loc); }
"x"             { return Parser::make_X(loc); }
"xl"            { return Parser::make_XL(loc); }
"y"             { return Parser::make_Y(loc); }

select[^;]*         { return Parser::make_SQL_SELECT(loc); }
with[^;]*           { return Parser::make_SQL_WITH(loc); }
[a-z][a-z0-9_]*     { return Parser::make_IDENTIFIER_LITERAL(loc); }
['"][^'"]*['"]      { return Parser::make_STRING_LITERAL(loc); }
[0-9]+              {
                        int64_t value = 0;

                        auto stream = std::stringstream(yytext);
                        stream >> value;

                        if (!stream) {
                            auto message = std::string("Invalid number \"") + yytext + std::string("\"");
                            ctx.AddError(loc, message);
                        }

                        return Parser::make_INTEGER_LITERAL(value, loc);
                    }

--[^\n]*            { ctx.AddComment(loc); }
"/*"                { BEGIN(C_COMMENT); comment_begin = loc; }
<C_COMMENT>[^*\n]+  // eat comment in chunks
<C_COMMENT>"*"      // eat the lone star
<C_COMMENT>\n       { ctx.AddLineBreak(loc); }
<C_COMMENT>"*/"     {
                        BEGIN(INITIAL);
                        ctx.AddComment(syntax::Location(comment_begin.offset(), loc.offset() + loc.length() - comment_begin.offset()));
                    }

[ \t\r]         { ctx.AddLineBreak(loc); }
\n              { ctx.AddLineBreak(loc); }
<<EOF>>         { return Parser::make_EOF(loc); }
.               {
                    auto message = std::string("Invalid character \"") + yytext + std::string("\"");
                    ctx.AddError(loc, message);
                }
%%

// Code

// The input location
syntax::Location dashql::parser::loc;
// The start of the c_comment
syntax::Location dashql::parser::comment_begin;
// The input view of the scanner
std::string_view dashql::parser::in;
// The scanner offset
size_t dashql::parser::scanner_offset;
// Begin a scan
void dashql::parser::ParseContext::beginScan(std::string_view s) {
    yy_flex_debug = _trace_scanning;
    in = s;
    loc = syntax::Location();
    comment_begin = syntax::Location();
    scanner_offset = 0;

}

// End a scan
void dashql::parser::ParseContext::endScan() {
    in = {};
    loc = syntax::Location();
    comment_begin = syntax::Location();
    scanner_offset = 0;
}
