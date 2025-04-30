#include "dashql/parser/grammar/keywords.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {
namespace parser {
static const buffers::parser::ScannerTokenType MapToken(Parser::symbol_type symbol, std::string_view text) {
    switch (symbol.kind()) {
#define X(CATEGORY, NAME, TOKEN) case Parser::symbol_kind_type::S_##TOKEN:
#include "../../../grammar/lists/sql_column_name_keywords.list"
#include "../../../grammar/lists/sql_reserved_keywords.list"
#include "../../../grammar/lists/sql_type_func_keywords.list"
#include "../../../grammar/lists/sql_unreserved_keywords.list"
#undef X
        case Parser::symbol_kind_type::S_NULLS_LA:
        case Parser::symbol_kind_type::S_NOT_LA:
        case Parser::symbol_kind_type::S_WITH_LA:
            return buffers::parser::ScannerTokenType::KEYWORD;
        case Parser::symbol_kind_type::S_SCONST:
            return buffers::parser::ScannerTokenType::LITERAL_STRING;
        case Parser::symbol_kind_type::S_ICONST:
            return buffers::parser::ScannerTokenType::LITERAL_INTEGER;
        case Parser::symbol_kind_type::S_FCONST:
            return buffers::parser::ScannerTokenType::LITERAL_FLOAT;
        case Parser::symbol_kind_type::S_BCONST:
            return buffers::parser::ScannerTokenType::LITERAL_BINARY;
        case Parser::symbol_kind_type::S_XCONST:
            return buffers::parser::ScannerTokenType::LITERAL_HEX;
        case Parser::symbol_kind_type::S_IDENT:
            return buffers::parser::ScannerTokenType::IDENTIFIER;
        case Parser::symbol_kind_type::S_Op:
        case Parser::symbol_kind_type::S_EQUALS_GREATER:
        case Parser::symbol_kind_type::S_GREATER_EQUALS:
        case Parser::symbol_kind_type::S_LESS_EQUALS:
        case Parser::symbol_kind_type::S_NOT_EQUALS:
            return buffers::parser::ScannerTokenType::OPERATOR;
        case Parser::symbol_kind_type::S_DOT:
            return buffers::parser::ScannerTokenType::DOT;
        case Parser::symbol_kind_type::S_DOT_TRAILING:
            return buffers::parser::ScannerTokenType::DOT_TRAILING;
        default: {
            auto loc = symbol.location;
            if (loc.length() == 1) {
                switch (text[loc.offset()]) {
                    case '=':
                        return buffers::parser::ScannerTokenType::OPERATOR;
                }
            }
            return buffers::parser::ScannerTokenType::NONE;
        }
    };
};
}  // namespace parser

/// Pack the highlighting data
std::unique_ptr<buffers::parser::ScannerTokensT> ScannedScript::PackTokens() {
    std::vector<uint32_t> offsets;
    std::vector<uint32_t> lengths;
    std::vector<buffers::parser::ScannerTokenType> types;
    offsets.reserve(symbols.GetSize() * 3 / 2);
    lengths.reserve(symbols.GetSize() * 3 / 2);
    types.reserve(symbols.GetSize() * 3 / 2);

    auto ci = 0;
    symbols.ForEachIn(0, symbols.GetSize() - 1, [&](size_t symbol_id, parser::Parser::symbol_type symbol) {
        // Emit all comments in between.
        while (ci < comments.size() && comments[ci].offset() < symbol.location.offset()) {
            auto& comment = comments[ci++];
            offsets.push_back(comment.offset());
            lengths.push_back(comment.length());
            types.push_back(buffers::parser::ScannerTokenType::COMMENT);
        }
        // Map as standard token.
        offsets.push_back(symbol.location.offset());
        lengths.push_back(symbol.location.length());
        types.push_back(MapToken(symbol, text_buffer));
    });
    // Emit trailing comments
    for (; ci < comments.size(); ++ci) {
        auto& comment = comments[ci++];
        offsets.push_back(comment.offset());
        lengths.push_back(comment.length());
        types.push_back(buffers::parser::ScannerTokenType::COMMENT);
    }

    // Build the line breaks
    std::vector<uint32_t> breaks;
    breaks.reserve(line_breaks.size());
    auto oi = 0;
    for (auto& lb : line_breaks) {
        while (oi < offsets.size() && offsets[oi] < lb.offset()) ++oi;
        breaks.push_back(oi);
    }

    // Build highlighting
    auto out = std::make_unique<buffers::parser::ScannerTokensT>();
    out->token_offsets = std::move(offsets);
    out->token_lengths = std::move(lengths);
    out->token_types = std::move(types);
    out->token_breaks = std::move(breaks);
    return out;
}

}  // namespace dashql
