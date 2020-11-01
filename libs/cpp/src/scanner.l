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
#include <charconv>
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/grammar/keywords.h"


// ISO C++17 does not allow 'register' storage class specifier
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wregister"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wregister"

using namespace dashql;
using namespace dashql::parser;
namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
namespace sxs = proto::syntax_sql;

namespace dashql {
namespace parser {

// The location of the current token
extern sx::Location loc;
// The offset the comment (if any)
extern sx::Location comment_begin;
// The comment depth (to match the appropriate */)
extern int comment_depth;
// The offset the literal (if any)
extern sx::Location literal_begin;
// The input string view
extern std::string_view in;
// The reader offset
extern size_t scanner_offset;
// The parser offset
extern size_t parser_offset;

// Put back characters
void PutBack(ParserDriver& ctx, size_t n);
// Read an integer
Parser::symbol_type ReadInteger(ParserDriver& ctx, sx::Location loc);
// Read a parameter
Parser::symbol_type ReadParameter(ParserDriver& ctx, sx::Location loc);
// Begin a literal
void BeginLiteral(ParserDriver& ctx, sx::Location loc);
// End a literal
sx::Location EndLiteral(ParserDriver& ctx, sx::Location loc);

} // namespace parser
} // namespace dashql

// Work around an incompatibility in flex (at least versions
// 2.5.31 through 2.5.33): it generates code that does
// not conform to C89.  See Debian bug 333231
// <http://bugs.debian.org/cgi-bin/bugreport.cgi?bug=333231>.
#undef yywrap
#define yywrap() 1

// Declare the yylex function
#define YY_DECL Parser::symbol_type yylex(dashql::parser::ParserDriver& ctx)
// Init yyloc
#define YY_USER_INIT loc = sx::Location();
// Configure the scanner to use string views
#define YY_INPUT(buffer, bytes_read, max_bytes) \
    bytes_read = in.copy(buffer, max_bytes, scanner_offset); \
    scanner_offset += bytes_read;
// The user action is run whenever a token is matched
#define YY_USER_ACTION { \
    auto token_text = in.substr(parser_offset, yyleng); \
    for (unsigned i = 0; i < yyleng; ++i) { \
        if (token_text[i] == '\n') { \
            ctx.AddLineBreak(sx::Location(parser_offset + i, 1)); \
        } \
    } \
    loc = sx::Location(parser_offset, yyleng); \
    parser_offset += yyleng; \
}
// Return EOF token in yyterminate
#define yyterminate() return Parser::make_EOF(loc)

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

/*
 * OK, here is a short description of lex/flex rules behavior.
 * The longest pattern which matches an input string is always chosen.
 * For equal-length patterns, the first occurring in the rules list is chosen.
 * INITIAL is the starting state, to which all non-conditional rules apply.
 * Exclusive states change parsing rules while the state is active.  When in
 * an exclusive state, only those rules defined for that state apply.
 *
 * Exclusive states:
 *  <xb> bit string literal
 *  <xc> extended C-style comments
 *  <xd> delimited identifiers (double-quoted identifiers)
 *  <xh> hexadecimal numeric string
 *  <xq> standard quoted strings
 *
 * Remember to add an <<EOF>> case whenever you add a new exclusive state!
 * The default one is probably not the right thing.
 */

%x xb
%x xc
%x xd
%x xh
%x xq

/*
 * In order to make the world safe for Windows and Mac clients as well as
 * Unix ones, we accept either \n or \r as a newline.  A DOS-style \r\n
 * sequence will be seen as two successive newlines, but that doesn't cause '
 * any problems.  Comments that start with -- and extend to the next
 * newline are treated as equivalent to a single whitespace character.
 *
 * NOTE a fine point: if there is no newline following --, we will absorb
 * everything to the end of the input as a comment.  This is correct.  Older
 * versions of Postgres failed to recognize -- as a comment if the input
 * did not end with a newline.
 *
 * XXX perhaps \f (formfeed) should be treated as a newline as well?
 *
 * XXX if you change the set of whitespace characters, fix scanner_isspace()
 * to agree, and see also the plpgsql lexer.
 */

space           [ \t\n\r\f]
horiz_space     [ \t\f]
newline         [\n\r]
non_newline     [^\n\r]

comment         ("--"{non_newline}*)

whitespace      ({space}+|{comment})

/*
 * SQL requires at least one newline in the whitespace separating
 * string literals that are to be concatenated.  Silly, but who are we
 * to argue?  Note that {whitespace_with_newline} should not have * after
 * it, whereas {whitespace} should generally have a * after it...
 */

special_whitespace      ({space}+|{comment}{newline})
horiz_whitespace        ({horiz_space}|{comment})
whitespace_with_newline ({horiz_whitespace}*{newline}{special_whitespace}*)

/*
 * To ensure that {quotecontinue} can be scanned without having to back up
 * if the full pattern isn't matched, we include trailing whitespace in
 * {quotestop}.  This matches all cases where {quotecontinue} fails to match,
 * except for {quote} followed by whitespace and just one "-" (not two,
 * which would start a {comment}).  To cover that we have {quotefail}.
 * The actions for {quotestop} and {quotefail} must throw back characters
 * beyond the quote proper.
 */

quote           '
quotestop       {quote}{whitespace}*
quotecontinue   {quote}{whitespace_with_newline}{quote}
quotefail       {quote}{whitespace}*"-"

/* Bit string
 * It is tempting to scan the string for only those characters
 * which are allowed. However, this leads to silently swallowed
 * characters if illegal characters are included in the string.
 * For example, if xbinside is [01] then B'ABCD' is interpreted
 * as a zero-length string, and the ABCD' is lost!
 * Better to pass the string forward and let the input routines
 * validate the contents.
 */

xbstart         [bB]{quote}
xbinside        [^']*

/* Hexadecimal number */
xhstart         [xX]{quote}
xhinside        [^']*

/* Extended quote
 * xqdouble implements embedded quote, ''''
 */
xqstart         {quote}
xqdouble        {quote}{quote}
xqinside        [^']+

/* Double quote
 * Allows embedded spaces and other special characters into identifiers.
 */
dquote          \"
xdstart         {dquote}
xdstop          {dquote}
xddouble        {dquote}{dquote}
xdinside        [^"]+

/* C-style comments
 *
 * The "extended comment" syntax closely resembles allowable operator syntax.
 * The tricky part here is to get lex to recognize a string starting with
 * slash-star as a comment, when interpreting it as an operator would produce
 * a longer match --- remember lex will prefer a longer match!  Also, if we
 * have something like plus-slash-star, lex will think this is a 3-character
 * operator whereas we want to see it as a + operator and a comment start.
 * The solution is two-fold:
 * 1. append {op_chars}* to xcstart so that it matches as much text as
 *    {operator} would. Then the tie-breaker (first matching rule of same
 *    length) ensures xcstart wins.  We put back the extra stuff with yyless()
 *    in case it contains a star-slash that should terminate the comment.
 * 2. In the operator rule, check for slash-star within the operator, and
 *    if found throw it back with yyless().  This handles the plus-slash-star
 *    problem.
 * Dash-dash comments have similar interactions with the operator rule.
 */
xcstart         \/\*{op_chars}*
xcstop          \*+\/
xcinside        [^*/]+

digit           [0-9]
ident_start     [A-Za-z\200-\377_]
ident_cont      [A-Za-z\200-\377_0-9\$]

identifier      {ident_start}{ident_cont}*

/* Assorted special-case operators and operator-like tokens */
typecast        "::"
dot_dot         \.\.
colon_equals    ":="

/*
 * These operator-like tokens (unlike the above ones) also match the {operator}
 * rule, which means that they might be overridden by a longer match if they
 * are followed by a comment start or a + or - character. Accordingly, if you
 * add to this list, you must also add corresponding code to the {operator}
 * block to return the correct token in such cases. (This is not needed in
 * psqlscan.l since the token value is ignored there.)
 */
equals_greater  "=>"
less_equals     "<="
greater_equals  ">="
less_greater    "<>"
not_equals      "!="

/*
 * "self" is the set of chars that should be returned as single-character
 * tokens.  "op_chars" is the set of chars that can make up "Op" tokens,
 * which can be one or more characters long (but if a single-char token
 * appears in the "self" set, it is not to be returned as an Op).  Note
 * that the sets overlap, but each has some chars that are not in the other.
 *
 * If you change either set, adjust the character lists appearing in the
 * rule for "operator"!
 */
self            [,()\[\].;\:\+\-\*\/\%\^\<\>\=]
op_chars        [\~\!\@\#\^\&\|\`\+\-\*\/\%\<\>\=]
operator        {op_chars}+

/* we no longer allow unary minus in numbers.
 * instead we pass it separately to parser. there it gets
 * coerced via doNegate() -- Leon aug 20 1999
 *
 * {decimalfail} is used because we would like "1..10" to lex as 1, dot_dot, 10.
 *
 * {realfail1} and {realfail2} are added to prevent the need for scanner
 * backup when the {real} rule fails to match completely.
 */
integer         {digit}+
decimal         (({digit}*\.{digit}+)|({digit}+\.{digit}*))
decimalfail     {digit}+\.\.
real            ({integer}|{decimal})[Ee][-+]?{digit}+
realfail1       ({integer}|{decimal})[Ee]
realfail2       ({integer}|{decimal})[Ee][-+]

param           \${integer}
param2          \?{integer}

other           .

/*
 * Dollar quoted strings are totally opaque, and no escaping is done on them.
 * Other quoted strings must allow some special characters such as single-quote
 *  and newline.
 * Embedded single-quotes are implemented both in the SQL standard
 *  style of two adjacent single quotes "''" and in the Postgres/Java style
 *  of escaped-quote "\'".
 * Other embedded escaped characters are matched explicitly and the leading
 *  backslash is dropped from the string.
 * Note that xcstart must appear before operator, as explained above!
 *  Also whitespace (comment) must appear before operator.
 */

%%

%{
// Code runs each time yylex is called.
// Start a new token at the end of the previous token.
loc =  sx::Location(loc.offset() + loc.length(), 0);
%}

{whitespace}    {}


{xcstart}       { BEGIN(xc); comment_begin = loc; comment_depth = 0; }
<xc>{xcstart}   { ++comment_depth; }
<xc>{xcstop}    { 
                    if (comment_depth-- <= 0) {
                        BEGIN(INITIAL);
                        ctx.AddComment(sx::Location(comment_begin.offset(), loc.offset() + loc.length() - comment_begin.offset()));
                    }
                }
<xc>{xcinside}  {}
<xc>{op_chars}  {}
<xc>\*+         {}
<xc><<EOF>>     { ctx.AddError(EndLiteral(ctx, loc), "unterminated bit string literal"); }


{xbstart}       { BEGIN(xb); BeginLiteral(ctx, loc); }
<xb>{quotestop} |
<xb>{quotefail} { BEGIN(INITIAL); return Parser::make_BCONST(EndLiteral(ctx, loc)); }
<xh>{xhinside}  |
<xb>{xbinside}  {}
<xh>{quotecontinue} |
<xb>{quotecontinue} {}
<xb><<EOF>>     { ctx.AddError(EndLiteral(ctx, loc), "unterminated bit string literal"); }


{xhstart}       { BEGIN(xh); BeginLiteral(ctx, loc); }
<xh>{quotestop} |
<xh>{quotefail} { BEGIN(INITIAL); return Parser::make_XCONST(EndLiteral(ctx, loc)); }
<xh><<EOF>>     { ctx.AddError(EndLiteral(ctx, loc), "unterminated hexadecimal bit string literal"); }


{xqstart}       { BEGIN(xq); BeginLiteral(ctx, loc); }
<xq>{quotestop} |
<xq>{quotefail} { BEGIN(INITIAL); return Parser::make_SCONST(EndLiteral(ctx, loc)); }
<xq>{xqdouble}  {}
<xq>{xqinside}  {}
<xq><<EOF>>     { ctx.AddError(EndLiteral(ctx, loc), "unterminated quoted string"); }


{xdstart}       { BEGIN(xd); BeginLiteral(ctx, loc); }
<xd>{xddouble}  {}
<xd>{xdinside}  {}
<xd>{xdstop}    { 
                    BEGIN(INITIAL); 
                    auto l = EndLiteral(ctx, loc);
                    if (l.length() == 2)
                        ctx.AddError(l, "zero-length delimited identifier");
                    return Parser::make_IDENT(l);
                }
<xd><<EOF>>     { ctx.AddError(EndLiteral(ctx, loc), "unterminated delimited identifier"); }

{typecast}          { return Parser::make_TYPECAST(loc); }
{dot_dot}           { return Parser::make_DOT_DOT(loc); }
{colon_equals}      { return Parser::make_COLON_EQUALS(loc); }
{equals_greater}    { return Parser::make_EQUALS_GREATER(loc); }
{less_equals}       { return Parser::make_LESS_EQUALS(loc); }
{greater_equals}    { return Parser::make_GREATER_EQUALS(loc); }
{less_greater}      { return Parser::make_NOT_EQUALS(loc); }
{not_equals}        { return Parser::make_NOT_EQUALS(loc); }
{self}              { /* XXX how to forward self? */ }

{operator}      { /* TODO */ }

{param}         { return ReadParameter(ctx, loc); }
{param2}        { return ReadParameter(ctx, loc); }
{integer}       { return ReadInteger(ctx, loc); }
{decimal}       { return Parser::make_FCONST(loc); }
{decimalfail}   { PutBack(ctx, 2); return Parser::make_FCONST(loc); }
{real}          { return Parser::make_FCONST(loc); }
{realfail1}     { PutBack(ctx, 1); return Parser::make_FCONST(loc); }
{realfail2}     { PutBack(ctx, 2); return Parser::make_FCONST(loc); }

{identifier}    {
                    if (auto k = Keyword::Find(ctx.TextAt(loc)); !!k) {
                        return Parser::symbol_type(k->token, loc);
                    }
                    return Parser::make_IDENT(loc);
                }

{other}         { /* TODO */ }
%%

// Code

namespace dashql {
namespace parser {

sx::Location loc;
sx::Location comment_begin;
int comment_depth;
sx::Location literal_begin;
std::string_view in;
size_t scanner_offset;
size_t parser_offset;

void ParserDriver::BeginScan() {
    yy_flex_debug = _trace_scanning;
    loc = sx::Location();
    in = _input;
    scanner_offset = 0;
    parser_offset = 0;
}

void ParserDriver::EndScan() {
    loc = sx::Location();
    in = _input;
    scanner_offset = 0;
    parser_offset = 0;
}

void PutBack(ParserDriver& ctx, size_t n) {
    yyless(loc.length() - n);
    parser_offset -= n;
    loc = sx::Location(loc.offset(), loc.length() - n);
}

Parser::symbol_type ReadParameter(ParserDriver& ctx, sx::Location loc) {
    auto text = ctx.TextAt(loc);
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        ctx.AddError(loc, "invalid parameter");
    }
    return Parser::make_PARAM(value, loc);
}

Parser::symbol_type ReadInteger(ParserDriver& ctx, sx::Location loc) {
    auto text = ctx.TextAt(loc);
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        return Parser::make_FCONST(loc);
    } else {
        return Parser::make_ICONST(value, loc);
    }
}

void BeginLiteral(ParserDriver& ctx, sx::Location loc) {
    literal_begin = loc;
}

sx::Location EndLiteral(ParserDriver& ctx, sx::Location loc) {
    return sx::Location(literal_begin.offset(), loc.offset() + loc.length() - literal_begin.offset());
}

}
}
