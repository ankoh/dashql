// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PROGRAM_MATCHER_H_
#define INCLUDE_DASHQL_PROGRAM_MATCHER_H_

#include "dashql/common/enum.h"
#include "dashql/program_instance.h"
#include "dashql/proto/syntax_generated.h"
#include <iostream>
#include <sstream>

namespace dashql {

namespace sx = proto::syntax;

BETTER_ENUM(DiffOpCode, uint8_t,
    DELETE,
    INSERT,
    KEEP,
    MOVE,
    UPDATE
)

class ProgramMatcher {
   public:
    using StatementMapping = std::pair<size_t, size_t>;
    using StatementMappings = std::vector<StatementMapping>;

    /// A similarity estimate
    enum class SimilarityEstimate {
        EQUAL,
        SIMILAR,
        NOT_EQUAL
    };

    /// A diff between statements
    struct StatementSimilarity {
        /// The maximum node count
        size_t total_nodes;
        /// The matching nodes
        size_t matching_nodes;

        /// Constructor
        StatementSimilarity(size_t total = 0, size_t matching = 0)
            : total_nodes(total), matching_nodes(matching) {}
        /// Are Equal?
        bool Equal() const { return total_nodes == matching_nodes; }
        /// Get the score
        double Score() const { return (total_nodes == 0) ? 0.0 : static_cast<double>(matching_nodes) / total_nodes; }
    };

    /// A diff operation
    struct DiffOp {
        /// The code
        DiffOpCode code_;
        /// The source statement
        std::optional<size_t> source_;
        /// The target statement
        std::optional<size_t> target_;

        /// Constructor
        DiffOp(DiffOpCode code, std::optional<size_t> source, std::optional<size_t> target = std::nullopt);

        /// The code
        auto code() const { return code_; }
        /// The source
        auto source() const { return source_; }
        /// The target
        auto target() const { return target_; }

        /// Equality operator
        bool operator==(const DiffOp& other) const {
            return code_ == other.code_ && source_ == other.source_ && target_ == other.target_;
        }
        /// Print diff op
        friend std::ostream& operator<<(std::ostream& out, const DiffOp& op) {
            auto s = op.source() ? std::to_string(*op.source()) : "_";
            auto t = op.target() ? std::to_string(*op.target()) : "_";
            out << "[" << op.code_ << "," << s << "," << t << "]";
            return out;
        }
    };

   protected:
    /// The source text
    const ProgramInstance& source_;
    /// The target program
    const ProgramInstance& target_;
    /// The subtree sizes of source nodes
    std::vector<size_t> source_subtree_sizes_;
    /// The subtree sizes of target nodes
    std::vector<size_t> target_subtree_sizes_;

    /// Compute subtree size.
    /// Only used for the full similarity computation.
    size_t ComputeTreeSize(const sx::ProgramT& prog, size_t root, std::vector<size_t>& sizes);
    /// Find unique statement mappings
    void MapStatements(StatementMappings& unique, StatementMappings& equal);
    /// Find the longest common subsequence
    StatementMappings FindLCS(const StatementMappings& unique);

   public:
    /// Compare two programs
    ProgramMatcher(const ProgramInstance& source, const ProgramInstance& target);
    /// The source text
    auto& source() const { return source_; }
    /// The target text
    auto& target() const { return target_; }

    /// Estimate the similarity
    SimilarityEstimate EstimateSimilarity(const sx::StatementT& source, const sx::StatementT& target);
    /// Compute the similarity of two statements
    StatementSimilarity ComputeSimilarity(const sx::StatementT& source, const sx::StatementT& target);
    /// Deep equality check of two statements.
    /// Runs a similarity check that aborts early if not strictly equal.
    bool CheckDeepEquality(const sx::StatementT& source, const sx::StatementT& target);

    /// Compute the diff between the programs.
    ///
    /// We use a modified version of the patience diff described here:
    ///     https://bramcohen.livejournal.com/73318.html
    ///     https://alfedenzo.livejournal.com/170301.html
    ///
    /// The main difference between our diffs and text diffs is that we don't care too much about the text order.
    /// If DashQL statements equal, we will assume that the user reordered the statements independant of their distance.
    /// The only really problematic diffs are updated statements.
    /// We therefore pick up the idea of patience sort to use unique matches as constants between user keystrokes.
    ///
    /// The algorithm works as follows:
    //
    /// 1) Similar to patience diff, we first find all unique pairs of equal statements within the two programs.
    ///    Statements that are completely identical will very likely have the same effect in our DashQL program.
    ///    (The exception are modifying statements like INSERT but their actions will be invalidated later)
    /// 2) Once we have the list of unique statement pairs, we determine the longest common subsequence (LCS) among them.
    /// 3) We then use the LCS to split the statements into sections and emit the diff program as follows:
    ///     A) We emit MOVE instructions for equal pairs that cross section boundaries.
    ///     B) We emit UPDATE instructions if the similarity between two statements is above a threshold.
    ///     C) We emit CREATE/DELETE instructions if a statement has no similar match.
    ///
    /// The rationale behind this is the following:
    ///     A user will very likely not change all statements at once.
    ///     We can therefore assume that a large portion of the statements is left unchanged.
    ///     We use the unique statement pairs as constants to identify updates quickly.
    ///
    std::vector<DiffOp> ComputeDiff();

    /// Do parameter values equal?
    static bool ParameterValuesEqual(const proto::session::ParameterValue* l, const proto::session::ParameterValue* r);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_MATCHER_H_
