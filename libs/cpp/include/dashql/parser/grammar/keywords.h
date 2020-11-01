// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_KEYWORDS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_KEYWORDS_H_

#include <string_view>

#include "dashql/parser/parser.h"

namespace dashql {
namespace parser {

/// A keyword category
enum class KeywordCategory { DASHQL, SQL_COLUMN_NAME, SQL_RESERVED, SQL_TYPE_FUNC, SQL_UNRESERVED };

/// A keyword
struct Keyword {
    /// The name
    std::string_view name;
    /// The token
    Parser::token::token_kind_type token;
    /// The category
    KeywordCategory category;
};

}  // namespace parser
}  // namespace dashql

#endif
