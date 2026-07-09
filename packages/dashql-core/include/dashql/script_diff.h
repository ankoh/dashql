#pragma once

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {

/// A statement-level semantic diff between two parsed scripts.
///
/// This is a port of the legacy `ProgramMatcher`: a modified patience diff over the *statements* of
/// two parsed scripts. Statements are mapped by structural equality (order-insensitive), the longest
/// common subsequence of unambiguous pairs is kept, and the remaining statements are classified as
/// MOVE / UPDATE / DELETE / INSERT.
///
/// Adaptations to the current AST model (vs. the legacy one):
///  - AST node spans (`symbol_span`) are TOKEN-INDEX based and must be resolved through the scanned
///    script (`ScannedScript::ResolveTextSpan`) before touching text or emitting a text span.
///  - Object attribute lists are NOT sorted by attribute key, so we sort a scratch copy by key
///    before the merge-join in the similarity/equality traversals.
///  - The node-type classifier accounts for the `ENUM_VIS_*` values that sit numerically between
///    `OBJECT_KEYS_` and `VIS_OBJECT_KEYS_`.
class ScriptDiff {
   public:
    /// The op code (identical to the flatbuffer enum, no translation needed)
    using OpCode = buffers::diff::ScriptDiffOpCode;

    /// A single diff operation.
    struct DiffOp {
        /// The op code
        OpCode code;
        /// The source (old) statement index, or nullopt for INSERT
        std::optional<StatementID> source_statement;
        /// The target (new) statement index, or nullopt for DELETE
        std::optional<StatementID> target_statement;
        /// The resolved text span of the source statement root (empty if no source)
        buffers::parser::TextSpan source_span{0, 0};
        /// The resolved text span of the target statement root (empty if no target)
        buffers::parser::TextSpan target_span{0, 0};
        /// The changed sub-ranges within the target statement (UPDATE only; coalesced), empty otherwise
        std::vector<buffers::parser::TextSpan> target_changes;
    };

    /// Constructor
    ScriptDiff(const ParsedScript& source, const ParsedScript& target);

    /// Compute the diff (memoized; returns the cached result on subsequent calls)
    const std::vector<DiffOp>& Compute();
    /// Get the ops (computes if not done yet)
    const std::vector<DiffOp>& GetOps() { return Compute(); }

    /// Pack the diff into a flatbuffer
    flatbuffers::Offset<buffers::diff::ScriptDiff> Pack(flatbuffers::FlatBufferBuilder& builder);

   private:
    /// A fast similarity estimate for two statements
    enum class SimilarityEstimate { NOT_EQUAL, SIMILAR, EQUAL };
    /// A statement similarity score (matching nodes / total nodes)
    struct StatementSimilarity {
        /// The number of matching nodes
        size_t matching_nodes = 0;
        /// The total number of nodes
        size_t total_nodes = 0;
        /// Compute the similarity score in [0, 1]
        double Score() const { return total_nodes == 0 ? 0.0 : static_cast<double>(matching_nodes) / total_nodes; }
    };
    /// A statement mapping (source id -> target id)
    using StatementMapping = std::pair<size_t, size_t>;
    /// A list of statement mappings
    using StatementMappings = std::vector<StatementMapping>;

    /// The source (old) parsed script
    const ParsedScript& source_;
    /// The target (new) parsed script
    const ParsedScript& target_;
    /// Memoized subtree sizes for the source (0 == not computed yet)
    std::vector<size_t> source_subtree_sizes_;
    /// Memoized subtree sizes for the target (0 == not computed yet)
    std::vector<size_t> target_subtree_sizes_;
    /// Scratch buffer for sorting object attribute children by key
    std::vector<uint32_t> attr_scratch_;
    /// The computed ops (empty until Compute() ran)
    std::vector<DiffOp> ops_;
    /// Was the diff already computed?
    bool computed_ = false;

    /// Compute the size of a subtree rooted at `root` (memoized DFS)
    static size_t ComputeTreeSize(const ParsedScript& script, size_t root, std::vector<size_t>& sizes);
    /// Estimate the similarity of two statements (cheap, O(1) for equal statements)
    SimilarityEstimate EstimateSimilarity(const ParsedScript::Statement& source,
                                          const ParsedScript::Statement& target) const;
    /// Compute the similarity of two statements (expensive, lockstep DFS)
    StatementSimilarity ComputeSimilarity(const ParsedScript::Statement& source,
                                          const ParsedScript::Statement& target);
    /// Check two statements for deep equality
    bool CheckDeepEquality(const ParsedScript::Statement& source, const ParsedScript::Statement& target);
    /// Map statements between the two scripts (unique + equal pairs, with ambiguity handling)
    void MapStatements(StatementMappings& unique_pairs, StatementMappings& equal_pairs);
    /// Find the longest common subsequence among the unique pairs
    StatementMappings FindLCS(const StatementMappings& unique_pairs);
    /// Collect the changed sub-ranges within an UPDATE target statement
    std::vector<buffers::parser::TextSpan> CollectTargetChanges(const ParsedScript::Statement& source,
                                                                const ParsedScript::Statement& target);
};

}  // namespace dashql
