#include <unordered_map>
#include "dashql/parser/grammar/keywords.h"

namespace dashql {
namespace parser {

/// The keyword map
static const std::unordered_map<std::string_view, Keyword> keywords = {
#define X(CATEGORY, NAME, TOKEN) { NAME, Keyword{ NAME, Parser::token::DQL_##TOKEN, KeywordCategory::CATEGORY } },
#include "./grammar/keywords/dashql_keywords.list"
#include "./grammar/keywords/sql_column_name_keywords.list"
#include "./grammar/keywords/sql_reserved_keywords.list"
#include "./grammar/keywords/sql_type_func_keywords.list"
#include "./grammar/keywords/sql_unreserved_keywords.list"
#undef X
};

/// Find a keyword
const Keyword* Keyword::Find(std::string_view text) {
    if (auto iter = keywords.find(text); iter != keywords.end())
        return &iter->second;
    return nullptr;
}

}
}
