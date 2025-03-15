#pragma once

#include <string_view>

#include "dashql/parser/parser.h"

namespace dashql {
namespace parser {

/// A keyword category
enum class KeywordCategory { FLATSQL, SQL_COLUMN_NAME, SQL_RESERVED, SQL_TYPE_FUNC, SQL_UNRESERVED };

/// A keyword
struct Keyword {
    /// The name
    std::string_view name;
    /// The scanner token
    Parser::token::token_kind_type scanner_token;
    /// The parser symbol
    Parser::symbol_kind_type parser_symbol;
    /// The category
    KeywordCategory category;

    /// Get a span with all keywords
    static std::span<const Keyword> GetKeywords();
    /// Get a symbol name
    static std::string_view GetKeywordName(Parser::symbol_kind_type sym);
    /// Find a keyword
    static const Keyword* Find(std::string_view text);
    /// Get the length of a keyword known at compile-time
    static constexpr size_t ConstLength(const char* str) { return *str ? 1 + ConstLength(str + 1) : 0; }
};

}  // namespace parser
}  // namespace dashql
