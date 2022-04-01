#include <unordered_map>

#include "dashql/parser/grammar/keywords.h"
#include "dashql/parser/scanner.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

static const sx::HighlightingTokenType MapToken(Parser::symbol_kind_type symbol) {
    switch (symbol) {
#define X(CATEGORY, NAME, TOKEN)              \
    case Parser::symbol_kind_type::S_##TOKEN: \
        return proto::syntax::HighlightingTokenType::KEYWORD;
#include "./grammar/lists/dashql_keywords.list"
#include "./grammar/lists/sql_column_name_keywords.list"
#include "./grammar/lists/sql_reserved_keywords.list"
#include "./grammar/lists/sql_type_func_keywords.list"
#include "./grammar/lists/sql_unreserved_keywords.list"
#undef X
        case Parser::symbol_kind_type::S_STRING_LITERAL:
        case Parser::symbol_kind_type::S_SCONST:
        case Parser::symbol_kind_type::S_USCONST:
            return proto::syntax::HighlightingTokenType::LITERAL_STRING;
        case Parser::symbol_kind_type::S_ICONST:
            return proto::syntax::HighlightingTokenType::LITERAL_INTEGER;
        case Parser::symbol_kind_type::S_FCONST:
            return proto::syntax::HighlightingTokenType::LITERAL_FLOAT;
        case Parser::symbol_kind_type::S_BCONST:
            return proto::syntax::HighlightingTokenType::LITERAL_BINARY;
        case Parser::symbol_kind_type::S_XCONST:
            return proto::syntax::HighlightingTokenType::LITERAL_HEX;
        case Parser::symbol_kind_type::S_BOOLEAN_LITERAL:
            return proto::syntax::HighlightingTokenType::LITERAL_BOOLEAN;
        case Parser::symbol_kind_type::S_Op:
            return proto::syntax::HighlightingTokenType::OPERATOR;
        case Parser::symbol_kind_type::S_IDENT:
        case Parser::symbol_kind_type::S_UIDENT:
        case Parser::symbol_kind_type::S_IDENTIFIER:
            return proto::syntax::HighlightingTokenType::IDENTIFIER;
        default:
            return proto::syntax::HighlightingTokenType::NONE;
    };
};

/// Collect syntax highlighting information
std::unique_ptr<sx::HighlightingT> Scanner::BuildHighlighting() {
    std::vector<uint32_t> offsets;
    std::vector<sx::HighlightingTokenType> types;

    // Emit highlighting tokens at a location.
    // We emit 2 tokens at the begin and the end of every location and overwrite types if the offsets equal.
    // That allows us to capture whitespace accurately for Monaco.
    auto emit = [&](sx::Location loc, sx::HighlightingTokenType type) {
        if (!offsets.empty() && offsets.back() == loc.offset()) {
            types.back() = type;
        } else {
            offsets.push_back(loc.offset());
            types.push_back(type);
        }
        offsets.push_back(loc.offset() + loc.length());
        types.push_back(sx::HighlightingTokenType::NONE);
    };

    auto ci = 0;
    for (auto& symbol : symbols_) {
        // Emit all comments in between.
        while (ci < comments_.size() && comments_[ci].offset() < symbol.location.offset()) {
            emit(comments_[ci++], sx::HighlightingTokenType::COMMENT);
        }
        // Is option key?
        if (dson_key_offsets_.count(symbol.location.offset())) {
            emit(symbol.location, sx::HighlightingTokenType::DSON_KEY);
            continue;
        }
        // Map as standard token.
        emit(symbol.location, MapToken(symbol.kind()));
    }

    // Build the line breaks
    std::vector<uint32_t> breaks;
    auto oi = 0;
    for (auto& lb : line_breaks_) {
        while (oi < offsets.size() && offsets[oi] < lb.offset()) ++oi;
        breaks.push_back(oi);
    }

    // Build highlighting
    auto hl = std::make_unique<sx::HighlightingT>();
    hl->token_offsets = std::move(offsets);
    hl->token_types = std::move(types);
    hl->token_breaks = std::move(breaks);
    return hl;
}

}  // namespace parser
}  // namespace dashql
