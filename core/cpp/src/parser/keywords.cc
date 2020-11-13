#include <unordered_map>
#include "dashql/parser/grammar/keywords.h"

namespace dashql {
namespace parser {

/// The keyword map
static const std::unordered_map<std::string_view, Keyword> KEYWORDS = {
#define X(CATEGORY, NAME, TOKEN) { NAME, Keyword{ NAME, Parser::token::DQL_##TOKEN, KeywordCategory::CATEGORY } },
#include "./grammar/keywords/dashql_keywords.list"
#include "./grammar/keywords/sql_column_name_keywords.list"
#include "./grammar/keywords/sql_reserved_keywords.list"
#include "./grammar/keywords/sql_type_func_keywords.list"
#include "./grammar/keywords/sql_unreserved_keywords.list"
#undef X
};

/// Determine the maximum keyword length
size_t constexpr length(const char* str) { return *str ? 1 + length(str + 1) : 0; }
constexpr size_t MAX_KEYWORD_LENGTH = std::max<size_t>({
#define X(CATEGORY, NAME, TOKEN) length(NAME),
#include "./grammar/keywords/dashql_keywords.list"
#include "./grammar/keywords/sql_column_name_keywords.list"
#include "./grammar/keywords/sql_reserved_keywords.list"
#include "./grammar/keywords/sql_type_func_keywords.list"
#include "./grammar/keywords/sql_unreserved_keywords.list"
#undef X
});

/// Find a keyword
const Keyword* Keyword::Find(std::string_view text) {
    // Abort early if the keyword exceeds the max keyword size
    if (text.size() > MAX_KEYWORD_LENGTH)
        return nullptr;

    // Convert to lowercase
    std::array<char, MAX_KEYWORD_LENGTH + 1> buffer;
    for (unsigned i = 0; i < text.size(); ++i)
        buffer[i] = ::tolower(text[i]);
    std::string_view text_lc{buffer.data(), text.size()};

    // Find the keyword
    if (auto iter = KEYWORDS.find(text_lc); iter != KEYWORDS.end())
        return &iter->second;
    return nullptr;
}

}
}
