void dashql::parser::Parser::error(const location_type& loc, const std::string& message) {
    ctx.AddError(loc, message);
}

#include "dashql/parser/scanner.h"

/// Call the real lexer here
Parser::symbol_type yylex(ParserDriver& ctx) {
    return ctx.scanner().Lex();
}
