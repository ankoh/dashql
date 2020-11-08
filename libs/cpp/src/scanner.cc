// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"

using Parser = dashql::parser::Parser;

extern Parser::symbol_type dashql_yylex(void* state);

namespace dashql {
namespace parser {

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

/// Add an error
void Scanner::AddError(sx::Location location, const char* message) {
    _errors.push_back({location, message});
}

/// Add an error
void Scanner::AddError(sx::Location location, std::string&& message) {
    _errors.push_back({location, move(message)});
}

/// Add a line break
void Scanner::AddLineBreak(sx::Location location) {
    _line_breaks.push_back(location);
}

/// Add a comment
void Scanner::AddComment(sx::Location location) {
    _comments.push_back(location);
}

/// Read a parameter
Parser::symbol_type Scanner::ReadParameter(sx::Location loc) {
    auto text = TextAt(loc);
    int64_t value;
    auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    if (result.ec == std::errc::invalid_argument) {
        AddError(loc, "invalid parameter");
    }
    return Parser::make_PARAM(loc);
}

/// Read an integer
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

/// Get the next symbole
Parser::symbol_type Scanner::Next() {
    // Have lookahead?
    Parser::symbol_type current_token;
    if (lookahead_token) {
        current_token.move(*lookahead_token);
        lookahead_token.reset();
    } else {
        auto t = dashql_yylex(_scanner_state_ptr);
        current_token.move(t);
    }

    // Requires additional lookahead?
    switch (current_token.kind()) {
        case Parser::symbol_kind::S_NOT:
        case Parser::symbol_kind::S_NULLS_P:
        case Parser::symbol_kind::S_WITH:
            break;
        default:
            return current_token;
    }

    // Get next token
    auto next_token = dashql_yylex(_scanner_state_ptr);
    auto next_token_kind = next_token.kind();
    lookahead_token.emplace(std::move(next_token));

    // Should replace current token?
    switch (current_token.kind()) {
        case Parser::symbol_kind::S_NOT:
            // Replace NOT by NOT_LA if it's followed by BETWEEN, IN, etc
            switch (next_token_kind) {
                case Parser::symbol_kind::S_BETWEEN:
                case Parser::symbol_kind::S_IN_P:
                case Parser::symbol_kind::S_LIKE:
                case Parser::symbol_kind::S_ILIKE:
                case Parser::symbol_kind::S_SIMILAR:
                    return Parser::make_NOT_LA(current_token.location);
                default:
                    break;
            }
            break;

        case Parser::symbol_kind::S_NULLS_P:
            // Replace NULLS_P by NULLS_LA if it's followed by FIRST or LAST
            switch (next_token_kind) {
                case Parser::symbol_kind::S_FIRST_P:
                case Parser::symbol_kind::S_LAST_P:
                    return Parser::make_NULLS_LA(current_token.location);
                default:
                    break;
            }
            break;
        case Parser::symbol_kind::S_WITH:
            // Replace WITH by WITH_LA if it's followed by TIME or ORDINALITY
            switch (next_token_kind) {
                case Parser::symbol_kind::S_TIME:
                case Parser::symbol_kind::S_ORDINALITY:
                    return Parser::make_WITH_LA(current_token.location);
                default:
                    break;
            }
            break;
        default:
            break;
    }
    return current_token;
}

}
}
