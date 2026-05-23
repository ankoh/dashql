#pragma once

#include "dashql/parser/parser_generated.h"
#include "dashql/utils/chunk_buffer.h"

namespace dashql {

class ParsedScript;
class ScannedScript;

namespace parser {

class Parser : public ParserBase {
    using ParserBase::ParserBase;

   public:
    struct ExpectedSymbol {
        symbol_kind_type symbol;

        ExpectedSymbol() = default;
        ExpectedSymbol(symbol_kind_type s) : symbol(s) {}
        operator symbol_kind_type() const { return symbol; }
        bool operator==(symbol_kind_type other) const { return symbol == other; }
    };

   protected:
    /// Collect all expected symbols
    std::vector<ExpectedSymbol> CollectExpectedSymbols();
    /// Parse until a token and return expected symbols
    std::vector<ExpectedSymbol> CollectExpectedSymbolsAt(ChunkBufferEntryID symbol_id);
    /// Parse until a token, feed an extra symbol, then return expected symbols after it
    std::vector<ExpectedSymbol> CollectExpectedSymbolsAfter(ChunkBufferEntryID symbol_id, symbol_kind_type feed_symbol);

   public:
    /// Complete at a token
    static std::vector<ExpectedSymbol> ParseUntil(ScannedScript& in, ChunkBufferEntryID symbol_id);
    /// Parse until a token, feed an extra symbol, then return expected symbols after it
    static std::vector<ExpectedSymbol> ParseUntilAfter(ScannedScript& in, ChunkBufferEntryID symbol_id,
                                                       symbol_kind_type feed_symbol);
    /// Parse a module (throws Exception on error)
    static std::shared_ptr<ParsedScript> Parse(std::shared_ptr<ScannedScript> in, bool debug = false);
};

}  // namespace parser
}  // namespace dashql
