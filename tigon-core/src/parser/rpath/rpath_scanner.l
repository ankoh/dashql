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
// The input stream of the scanner
extern std::istream *in;

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

"["                 { return Parser::make_LSB(loc); }
"]"                 { return Parser::make_RSB(loc); }
"*"                 { return Parser::make_STAR(loc); }

[a-z][a-z0-9_]*     { return Parser::make_IDENTIFIER_LITERAL(yytext, loc); }
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
tigon::rpath::location tigon::rpath::loc;
// The input stream of the scanner
std::istream *tigon::rpath::in = nullptr;

// Begin a scan
void tigon::rpath::ParseContext::beginScan(std::istream &is) {
    yy_flex_debug = trace_scanning;
    in = &is;
}

// End a scan
void tigon::rpath::ParseContext::endScan() {
    in = nullptr;
}

