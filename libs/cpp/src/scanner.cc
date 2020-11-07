// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"

using Parser = dashql::parser::Parser;

extern Parser::symbol_type dashql_yylex(void* state);

namespace dashql {
namespace parser {

Parser::symbol_type Scanner::Next() {
    return dashql_yylex(_scanner_state_ptr);
}

/// Get the text at location
std::string_view Scanner::TextAt(sx::Location loc) {
    return input_text().substr(loc.offset(), loc.length());
}
/// Begin a literal
void Scanner::BeginLiteral(sx::Location loc) { _literal_begin = loc; }

/// End a literal
sx::Location Scanner::EndLiteral(sx::Location loc) {
    return sx::Location(_literal_begin.offset(), loc.offset() + loc.length() - _literal_begin.offset());
}
/// Begin a comment
void Scanner::BeginComment(sx::Location loc) {
    if (_comment_depth++ == 0) {
        _comment_begin = loc;
    }
}
/// End a comment
std::optional<sx::Location> Scanner::EndComment(sx::Location loc) {
    if (--_comment_depth == 0) {
        return sx::Location(_literal_begin.offset(), loc.offset() + loc.length() - _literal_begin.offset());
    }
    return std::nullopt;
}

void Scanner::AddError(sx::Location location, const char* message) {
    _errors.push_back({location, message});
}

void Scanner::AddError(sx::Location location, std::string&& message) {
    _errors.push_back({location, move(message)});
}

void Scanner::AddLineBreak(sx::Location location) {
    _line_breaks.push_back(location);
}

void Scanner::AddComment(sx::Location location) {
    _comments.push_back(location);
}

Parser::symbol_type Scanner::ReadParameter(sx::Location loc) {
    auto text = TextAt(loc);
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        AddError(loc, "invalid parameter");
    }
    return Parser::make_PARAM(loc);
}

Parser::symbol_type Scanner::ReadInteger(sx::Location loc) {
    auto text = TextAt(loc);
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        return Parser::make_FCONST(loc);
    } else {
        return Parser::make_ICONST(loc);
    }
}

}
}
