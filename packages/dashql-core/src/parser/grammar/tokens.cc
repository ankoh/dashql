#include "dashql/parser/grammar/keywords.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {

static const buffers::parser::ScannerTokenType MapToken(parser::Parser::symbol_type symbol, std::string_view text) {
    switch (symbol.kind()) {
#define X(CATEGORY, NAME, TOKEN) case parser::Parser::symbol_kind_type::S_##TOKEN:
#include "grammar_lists/sql_column_name_keywords.list"
#include "grammar_lists/sql_reserved_keywords.list"
#include "grammar_lists/sql_type_func_keywords.list"
#include "grammar_lists/sql_unreserved_keywords.list"
#include "grammar_lists/vis_unreserved_keywords.list"
#undef X
        case parser::Parser::symbol_kind_type::S_NULLS_LA:
        case parser::Parser::symbol_kind_type::S_NOT_LA:
        case parser::Parser::symbol_kind_type::S_WITH_LA:
            return buffers::parser::ScannerTokenType::KEYWORD;
        case parser::Parser::symbol_kind_type::S_SCONST:
            return buffers::parser::ScannerTokenType::LITERAL_STRING;
        case parser::Parser::symbol_kind_type::S_ICONST:
            return buffers::parser::ScannerTokenType::LITERAL_INTEGER;
        case parser::Parser::symbol_kind_type::S_FCONST:
            return buffers::parser::ScannerTokenType::LITERAL_FLOAT;
        case parser::Parser::symbol_kind_type::S_BCONST:
            return buffers::parser::ScannerTokenType::LITERAL_BINARY;
        case parser::Parser::symbol_kind_type::S_XCONST:
            return buffers::parser::ScannerTokenType::LITERAL_HEX;
        case parser::Parser::symbol_kind_type::S_IDENT:
            return buffers::parser::ScannerTokenType::IDENTIFIER;
        case parser::Parser::symbol_kind_type::S_Op:
        case parser::Parser::symbol_kind_type::S_EQUALS_GREATER:
        case parser::Parser::symbol_kind_type::S_GREATER_EQUALS:
        case parser::Parser::symbol_kind_type::S_LESS_EQUALS:
        case parser::Parser::symbol_kind_type::S_NOT_EQUALS:
            return buffers::parser::ScannerTokenType::OPERATOR;
        case parser::Parser::symbol_kind_type::S_DOT:
            return buffers::parser::ScannerTokenType::DOT;
        case parser::Parser::symbol_kind_type::S_DOT_TRAILING:
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

/// Pack the highlighting data
std::unique_ptr<buffers::parser::ScannerTokensT> ParsedScript::PackTokens() {
    auto& scan = *scanned_script;

    // Build a bitset of symbol indices where the parser used a keyword as an identifier (NAME node)
    std::vector<bool> name_overrides(scan.symbols.GetSize(), false);
    for (auto& node : nodes) {
        if (node.node_type() == buffers::parser::NodeType::NAME && node.symbol_span().length() == 1) {
            auto idx = node.symbol_span().offset();
            if (idx < name_overrides.size()) {
                name_overrides[idx] = true;
            }
        }
    }

    std::vector<uint32_t> offsets;
    std::vector<uint32_t> lengths;
    std::vector<buffers::parser::ScannerTokenType> types;
    offsets.reserve(scan.symbols.GetSize() * 3 / 2);
    lengths.reserve(scan.symbols.GetSize() * 3 / 2);
    types.reserve(scan.symbols.GetSize() * 3 / 2);

    size_t ci = 0;
    scan.symbols.ForEachIn(0, scan.symbols.GetSize() - 1, [&](size_t symbol_id, parser::Parser::symbol_type symbol) {
        // Emit all comments in between.
        while (ci < scan.comments.size() && scan.comments[ci].offset() < symbol.location.offset()) {
            auto& comment = scan.comments[ci++];
            offsets.push_back(comment.offset());
            lengths.push_back(comment.length());
            types.push_back(buffers::parser::ScannerTokenType::COMMENT);
        }
        // Map as standard token, overriding keywords that the parser consumed as identifiers.
        offsets.push_back(symbol.location.offset());
        lengths.push_back(symbol.location.length());
        auto token_type = MapToken(symbol, scan.text_buffer);
        if (token_type == buffers::parser::ScannerTokenType::KEYWORD && name_overrides[symbol_id]) {
            token_type = buffers::parser::ScannerTokenType::IDENTIFIER;
        }
        types.push_back(token_type);
    });
    // Emit trailing comments
    for (; ci < scan.comments.size(); ++ci) {
        auto& comment = scan.comments[ci++];
        offsets.push_back(comment.offset());
        lengths.push_back(comment.length());
        types.push_back(buffers::parser::ScannerTokenType::COMMENT);
    }

    // Build the line breaks
    std::vector<uint32_t> breaks;
    breaks.reserve(scan.line_breaks.size());
    size_t oi = 0;
    for (auto& lb : scan.line_breaks) {
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
