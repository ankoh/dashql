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
    using ExpectedSymbol = Parser::symbol_kind_type;

   protected:
    /// Collect all expected symbols
    std::vector<ExpectedSymbol> CollectExpectedSymbols();
    /// Parse until a token and return expected symbols
    std::vector<ExpectedSymbol> CollectExpectedSymbolsAt(ChunkBufferEntryID symbol_id);

   public:
    /// Complete at a token
    static std::vector<ExpectedSymbol> ParseUntil(ScannedScript& in, ChunkBufferEntryID symbol_id);
    /// Parse a module (throws Exception on error)
    static std::shared_ptr<ParsedScript> Parse(std::shared_ptr<ScannedScript> in, bool debug = false);
};

}  // namespace parser
}  // namespace dashql
