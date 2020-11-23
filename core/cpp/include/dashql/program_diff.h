// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PROGRAM_DIFF_H_
#define INCLUDE_DASHQL_PROGRAM_DIFF_H_

#include "dashql/proto/syntax_generated.h"

namespace dashql {

namespace sx = proto::syntax;

class ProgramMatcher {
   public:
    /// A similarity estimate
    enum class SimilarityEstimate {
        EQUAL,
        SIMILAR,
        NOT_EQUAL
    };

    /// A diff between statements
    struct StatementDiff {
        /// The maximum node count
        size_t total_nodes;
        /// The matching nodes
        size_t matching_nodes;
        /// The first N nodes that differ
        std::vector<size_t> diff_nodes;

        /// Constructor
        StatementDiff(size_t total = 0, size_t matching = 0)
            : total_nodes(total), matching_nodes(matching), diff_nodes() {}
        /// Are Equal?
        bool Equal() const { return total_nodes == matching_nodes; }
        /// Get the score
        double Score() const { return (total_nodes == 0) ? 0.0 : static_cast<double>(matching_nodes) / total_nodes; }
    };

   protected:
    /// The source text
    std::string_view source_text_;
    /// The target text
    std::string_view target_text_;
    /// The source program
    const sx::Program& source_program_;
    /// The target program
    const sx::Program& target_program_;
    /// The subtree sizes of source nodes
    std::vector<size_t> source_subtree_sizes_;
    /// The subtree sizes of target nodes
    std::vector<size_t> target_subtree_sizes_;

    /// Compute subtree size.
    /// Only used for the full similarity computation.
    size_t ComputeTreeSize(const sx::Program& prog, size_t root, std::vector<size_t>& sizes);
    /// Find unique statement mappings
    void FindUniqueMappings(const std::vector<size_t>& source_ids, const std::vector<size_t>& target_ids, std::vector<std::pair<size_t, size_t>>& unique_pairs);

   public:
    /// Compare two programs
    ProgramMatcher(std::string_view source_text, std::string_view target_text, const sx::Program& source_program, const sx::Program& target_program);

    /// Estimate the similarity
    SimilarityEstimate EstimateSimilarity(const sx::Statement& source, const sx::Statement& target);
    /// Compute the diff of two statements
    StatementDiff ComputeDiff(const sx::Statement& source, const sx::Statement& target, size_t diff_cap = 8);
    /// Deep equality check of two statements.
    /// Runs a similarity check that aborts early if not strictly equal.
    bool CheckDeepEquality(const sx::Statement& source, const sx::Statement& target);

    /// Compute the diff between the programs.
    ///
    /// The main difference between our diffs and text diffs is that we don't care too much about the order within the text.
    /// If DashQL statements equal, we will always assume that the user reordered the statements independant of their distance.
    ///
    /// The algorithm works as follows:
    /// 1) Similar to patience diff, we first find all unique pairs of equal statements within the two programs.
    ///    Statements that are completely identical will very likely have the same effect in our DashQL runtime.
    ///    (The exception are modifying statements like INSERT, UPDATE, DELETE but their effects will be handled later)
    /// 2) After that, we are left with all statements that are either copies or new/deleted.
    void ComputeDiff();

};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_DIFF_H_
