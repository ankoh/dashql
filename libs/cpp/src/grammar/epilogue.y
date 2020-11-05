void dashql::parser::Parser::error(const location_type& loc, const std::string& message) {
    ctx.AddError(loc, message);
}

/// Declare the real lexer
Parser::symbol_type dashql_yylex(ParserDriver& ctx);
/// Call the real lexer here
Parser::symbol_type yylex(ParserDriver& ctx) {
    /// XXX Proof-of-concept, use postgres scanner middleware
    return dashql_yylex(ctx);
}
