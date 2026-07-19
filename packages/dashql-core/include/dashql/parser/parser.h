#pragma once

#include <span>
#include <string>
#include <vector>

#include "dashql/parser/parser_generated.h"
#include "dashql/utils/chunk_buffer.h"

namespace dashql {

class ParsedScript;
class ScannedScript;

namespace parser {

/// A parser error
struct ParseError {
    /// The symbol span of the offending token
    buffers::parser::SymbolSpan location;
    /// The error message
    std::string message;
    /// An optional hint (e.g. "did you mean to use a double-quoted identifier?")
    std::string hint;
};

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

    /// Result of probing a hypothetical keyword's compatibility with the post-cursor token stream.
    /// Drives mid-statement keyword scoring: an expected keyword that the actual suffix can't continue is noise.
    struct SuffixProbe {
        /// Did the next real post-cursor token shift cleanly after feeding the candidate? (k=1 test)
        bool k1_compatible = false;
        /// Number of real post-cursor tokens that were consumed before erroring or accepting.
        uint16_t depth_consumed = 0;
        /// Did parsing reach EOF (the suffix is fully consistent with the candidate).
        bool reached_eof = false;
    };

    /// Snapshot of the LALR parser state immediately before reading the token at the cursor.
    /// Holds only state numbers — `yy_lac_check_` and the suffix-probe replay only read state
    /// numbers, so semantic values are not needed. Reused between expected-symbol collection and
    /// the suffix probe so the prefix is parsed only once.
    struct PrefixSnapshot {
        std::vector<state_type> state_stack;
        /// True when the prefix parse reached the cursor without erroring or accepting first.
        bool reached_target = false;
    };

    /// Combined output of the prefix parse: expected grammar symbols at the cursor + the state
    /// snapshot used to compute them. The snapshot can be replayed by
    /// `ProbeSuffixBatchFromSnapshot`.
    struct ExpectedAtCursor {
        std::vector<ExpectedSymbol> expected;
        PrefixSnapshot prefix;
    };

    /// Accessor for the underlying ParseContext. Used by DriveLALR policies that need to look at
    /// the symbol iterator or token index.
    ParseContext& GetCtx() { return ctx; }
    /// Number of states on the parser stack.
    auto GetStackSize() const { return yystack_.size(); }
    /// State number at depth `i` (0 = bottom). Used by policies that snapshot the stack.
    state_type GetStackState(decltype(stack_type{}.size()) i) const { return yystack_[i].state; }

   protected:
    /// Run the bison-generated LALR automaton, delegating customizable steps to `policy` (a duck
    /// type with the hooks documented in parser.cc). All three of `CollectExpectedSymbolsAfter`,
    /// `ParsePrefixToTarget`, and `ProbeSuffixFromPrefix` share this driver — they only differ
    /// in the policy.
    /// `init_stack=true` clears yystack_ and pushes the initial state; pass `false` when the
    /// caller has already restored a prefix snapshot.
    template <typename Policy>
    void DriveLALR(Policy& policy, bool init_stack);

   public:
    /// Collect all expected symbols at the parser's current state via LAC. Public so DriveLALR
    /// policies can call it from their hooks.
    std::vector<ExpectedSymbol> CollectExpectedSymbols();
    /// Parse until a token, feed an extra symbol, then return expected symbols after it
    std::vector<ExpectedSymbol> CollectExpectedSymbolsAfter(ChunkBufferEntryID symbol_id, symbol_kind_type feed_symbol);
    /// Run the LALR driver up to (but not including) the read of `target_symbol_id`. The parser's
    /// current state stack is captured into `out` (state numbers only, no semantic values).
    void ParsePrefixToTarget(ChunkBufferEntryID target_symbol_id, PrefixSnapshot& out);
    /// Restore a captured state stack into the parser. After this returns the parser is in the
    /// same logical state as ParsePrefixToTarget left it, ready for LAC queries or suffix replay.
    void RestorePrefix(const PrefixSnapshot& prefix);
    /// Probe how many post-cursor tokens parse cleanly after feeding `feed_symbol`, starting from
    /// the parser state captured in `prefix`. The caller's iterator and token-index are positioned
    /// to the target. If `replace_target` is true the candidate stands in for the target token;
    /// otherwise the candidate is inserted before it and the target is consumed afterward.
    SuffixProbe ProbeSuffixFromPrefix(const PrefixSnapshot& prefix, ChunkBufferEntryID target_symbol_id,
                                       symbol_kind_type feed_symbol, bool replace_target);
    /// Like `ProbeSuffixFromPrefix`, but feeds a whole SEQUENCE of symbols (e.g. a candidate
    /// keyword followed by its continuation keyword) before letting the real post-cursor stream
    /// flow. `depth_consumed`/`k1_compatible`/`reached_eof` describe only the real suffix shifted
    /// *after* the fed sequence, so this answers "does inserting these tokens keep the suffix
    /// parseable?".
    SuffixProbe ProbeSuffixSequenceFromPrefix(const PrefixSnapshot& prefix, ChunkBufferEntryID target_symbol_id,
                                              std::span<const symbol_kind_type> feed_symbols, bool replace_target);

   public:
    /// Parse until a token; return both the expected grammar symbols at the cursor and the
    /// LALR state snapshot. Pass the snapshot to `ProbeSuffixBatchFromSnapshot` to avoid
    /// re-parsing the prefix.
    static ExpectedAtCursor ParseUntilWithSnapshot(ScannedScript& in, ChunkBufferEntryID symbol_id);
    /// Parse until a token, feed an extra symbol, then return expected symbols after it
    static std::vector<ExpectedSymbol> ParseUntilAfter(ScannedScript& in, ChunkBufferEntryID symbol_id,
                                                       symbol_kind_type feed_symbol);
    /// Probe how compatible each candidate keyword is with the post-cursor token stream, given a
    /// pre-computed prefix snapshot (e.g. from `ParseUntilWithSnapshot`). One probe per candidate
    /// in input order; if the snapshot didn't reach the target, all probes are default-valued.
    static std::vector<SuffixProbe> ProbeSuffixBatchFromSnapshot(
        ScannedScript& in, ChunkBufferEntryID symbol_id, const PrefixSnapshot& prefix,
        std::span<const symbol_kind_type> feed_symbols, bool replace_target);
    /// Probe a single feed SEQUENCE against the post-cursor token stream, given a pre-computed
    /// prefix snapshot. Used to test whether a keyword continuation (candidate + continuation
    /// keyword) stays compatible with the tokens that already follow the cursor.
    static SuffixProbe ProbeSuffixSequenceFromSnapshot(ScannedScript& in, ChunkBufferEntryID symbol_id,
                                                       const PrefixSnapshot& prefix,
                                                       std::span<const symbol_kind_type> feed_symbols,
                                                       bool replace_target);
    /// Parse a module (throws Exception on error)
    static std::shared_ptr<ParsedScript> Parse(std::shared_ptr<ScannedScript> in, bool debug = false);

   protected:
    /// Override of bison's syntax-error message builder. Detects common mistakes (e.g. SCONST used
    /// where an IDENT would have parsed) and stashes a hint for the next `error()` call.
    std::string yysyntax_error_(const context& yyctx) const override;
    /// Override of the bison-generated error reporter. Forwards `loc` and `msg` to the
    /// `ParseContext`, attaching any `pending_hint_` set by the prior `yysyntax_error_` call.
    void error(const location_type& loc, const std::string& msg) override;
};

}  // namespace parser
}  // namespace dashql
