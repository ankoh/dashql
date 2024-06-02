#pragma once

#include "ankerl/unordered_dense.h"
#include "sqlynx/parser/names.h"
#include "sqlynx/proto/proto_generated.h"
#include "sqlynx/script.h"
#include "sqlynx/utils/string_conversion.h"
#include "sqlynx/utils/topk.h"

namespace sqlynx {

struct Completion {
    using ScoreValueType = uint32_t;
    using ScoringTable = std::array<std::pair<proto::NameTag, ScoreValueType>, 8>;

    static constexpr ScoreValueType TAG_IGNORE = 0;
    static constexpr ScoreValueType TAG_UNLIKELY = 10;
    static constexpr ScoreValueType TAG_LIKELY = 20;
    static constexpr ScoreValueType KEYWORD_VERY_POPULAR = 3;
    static constexpr ScoreValueType KEYWORD_POPULAR = 2;
    static constexpr ScoreValueType KEYWORD_DEFAULT = 0;

    static constexpr ScoreValueType SUBSTRING_SCORE_MODIFIER = 15;
    static constexpr ScoreValueType PREFIX_SCORE_MODIFIER = 20;
    static constexpr ScoreValueType NEAR_CURSOR_SCORE_MODIFIER = 1;
    static constexpr ScoreValueType RESOLVING_TABLE_SCORE_MODIFIER = 2;

    static_assert(PREFIX_SCORE_MODIFIER > SUBSTRING_SCORE_MODIFIER,
                  "Begin a prefix weighs more than being a substring");
    static_assert(NEAR_CURSOR_SCORE_MODIFIER < KEYWORD_POPULAR,
                  "Being in the same statement doesn't outweigh a popular keyword of similar likelyhood without also "
                  "being a substring");
    static_assert((TAG_UNLIKELY + SUBSTRING_SCORE_MODIFIER) > TAG_LIKELY,
                  "An unlikely name that is a substring outweighs a likely name");
    static_assert((TAG_UNLIKELY + KEYWORD_VERY_POPULAR) < TAG_LIKELY,
                  "A very likely keyword prevalance doesn't outweighing a likely tag");

    /// The completion candidates
    struct Candidate {
        /// The schema containing the candidate
        /// The name
        CatalogEntry::NameInfo name;
        /// The name tags
        NameTags combined_tags;
        /// The name score
        ScoreValueType score;
        /// Is a name located near the cursor (in the AST)?
        bool near_cursor;
        /// Is external?
        bool external;

        /// Get the score
        inline ScoreValueType GetScore() const { return score + (near_cursor ? NEAR_CURSOR_SCORE_MODIFIER : 0); }
        /// Is less in the min-heap?
        /// We want to kick a candidate A before candidate B if
        ///     1) the score of A is less than the score of B
        ///     2) the name of A is lexicographically larger than B
        bool operator<(const Candidate& other) const {
            auto l = GetScore();
            auto r = other.GetScore();
            return (l < r) || (l == r && (fuzzy_ci_string_view{name.text.data(), name.text.size()} >
                                          fuzzy_ci_string_view{other.name.text.data(), other.name.text.size()}));
        }
    };
    /// A hash-map for candidates
    using CandidateMap = ankerl::unordered_dense::map<std::string_view, Candidate>;

   protected:
    /// The script cursor
    const ScriptCursor& cursor;
    /// The completion strategy
    const proto::CompletionStrategy strategy;
    /// The scoring table
    const ScoringTable& scoring_table;
    /// The hash-map to deduplicate names found in the completion indexes
    CandidateMap pending_candidates;
    /// The result heap, holding up to k entries
    TopKHeap<Candidate> result_heap;

    /// Resolve the expected symbols
    void FindCandidatesInGrammar(bool& expects_identifier);
    /// Find the candidates in completion indexes
    void FindCandidatesInIndexes();
    /// Find tables that contain column names that are still unresolved in the current statement
    void FindTablesForUnresolvedColumns();
    /// Find candidates in the AST around the script cursor
    void FindCandidatesInAST();
    /// Flush pending candidates and finish the results
    void FlushCandidatesAndFinish();

   public:
    /// Constructor
    Completion(const ScriptCursor& cursor, size_t k);

    /// Get the cursor
    auto& GetCursor() const { return cursor; }
    /// Get the completion strategy
    auto& GetStrategy() const { return strategy; }
    /// Get the scoring table
    auto& GetScoringTable() const { return scoring_table; }
    /// Get the pending candidates
    auto& GetPendingCandidates() { return pending_candidates; }
    /// Get the result heap
    auto& GetHeap() const { return result_heap; }

    /// Pack the completion result
    flatbuffers::Offset<proto::Completion> Pack(flatbuffers::FlatBufferBuilder& builder);
    // Compute completion at a cursor
    static std::pair<std::unique_ptr<Completion>, proto::StatusCode> Compute(const ScriptCursor& cursor, size_t k);
};

}  // namespace sqlynx
