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
#include "tigon/parser/rpath/rpath_parse_context.h"
#include "tigon/parser/rpath/rpath_parser.h"

// ISO C++17 does not allow 'register' storage class specifier
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wregister"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wregister"

namespace tigon {
namespace rpath {

// The location of the current token
extern tigon::rpath::location loc;
// The input string view
extern std::string_view in;
// The reader offset
extern size_t reader_offset;
// The parser offset
extern size_t parser_offset;

}  // namespace rpath
}  // namespace tigon

using namespace tigon;
using namespace tigon::rpath;

// Work around an incompatibility in flex (at least versions
// 2.5.31 through 2.5.33): it generates code that does
// not conform to C89.  See Debian bug 333231
// <http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=333231>.
#undef yywrap
#define yywrap() 1

// Declare the rpath_lex function
#define YY_DECL Parser::symbol_type rpath_lex(ParseContext& ctx)
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
%option prefix="rpath_"

%{
// Code run each time a token is matched.
// We just update the location of the token.
#define YY_USER_ACTION  { loc.columns(rpath_leng); }
%}

%%

%{
// Code runs each time rpath_lex is called.
// Set the beginning of the token to the end of the previous token.
loc.step ();
%}

"["                 { return Parser::make_LSB(loc); }
"]"                 { return Parser::make_RSB(loc); }
"*"                 { return Parser::make_STAR(loc); }
".."                { return Parser::make_DOT_DOT(loc); }
"."                 { return Parser::make_DOT(loc); }
":"                 { return Parser::make_COLON(loc); }
","                 { return Parser::make_COMMA(loc); }
"$"                 { return Parser::make_DOLLAR(loc); }

[a-z][a-z0-9_]*     { return Parser::make_IDENTIFIER_LITERAL(rpath_text, loc); }
[0-9]+              {
                        uint32_t value = 0;
                        try {
                            value = std::stoul(rpath_text);
                        } catch(const std::invalid_argument &err) {
                            ctx.Error(loc.begin.line, loc.begin.column, "integer is invalid");
                        } catch(const std::out_of_range &err) {
                            ctx.Error(loc.begin.line, loc.begin.column, "integer out of range");
                        }
                        return Parser::make_INTEGER_LITERAL(value, loc);
                    }

[ \t]+              { loc.step(); }
\n                  { loc.lines (1); loc.step(); }

<<EOF>>             { return Parser::make_EOF(loc); }
.                   { ctx.Error(loc.begin.line, loc.begin.column, "invalid character"); }

%%

// ---------------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------------

// The input stream
tigon::rpath::location tigon::rpath::loc;
// The input view of the scanner
std::string_view tigon::rpath::in;
// The reader offset
size_t tigon::rpath::reader_offset;
// The parser offset
size_t tigon::rpath::parser_offset;

// Begin a scan
void tigon::rpath::ParseContext::beginScan(std::string_view s) {
    rpath__flex_debug = trace_scanning;
    loc = location();
    in = s;
    reader_offset = 0;
    parser_offset = 0;
}

// End a scan
void tigon::rpath::ParseContext::endScan() {
    loc = location();
    in = {};
    reader_offset = 0;
    parser_offset = 0;
}

