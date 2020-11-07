// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/scanner.h"
#include "dashql/parser/parser_driver.h"


namespace dashql {
namespace parser {

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
