#pragma once

#include <type_traits>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_object.h"
#include "dashql/script.h"
#include "dashql/text/names.h"
#include "dashql/utils/enum_bitset.h"
#include "dashql/utils/topk.h"

namespace dashql {

struct Completion {
    /// A score value
    using ScoreValueType = uint32_t;
    /// A bitset for candidate tags
    using CandidateTags =
        EnumBitset<uint32_t, buffers::completion::CandidateTag, buffers::completion::CandidateTag::MAX>;

    struct Candidate;

    /// A catalog object referenced by a completion candidate
    struct CandidateCatalogObject : public IntrusiveListNode {
        /// The candidate
        Candidate& candidate;
        /// The candidate tags of this object
        CandidateTags candidate_tags;
        /// The candidate catalog object id
        QualifiedCatalogObjectID catalog_object_id;
        /// The catalog object
        const CatalogObject& catalog_object;
        /// The score (if computed)
        ScoreValueType score = 0;
        /// The qualified name (if any)
        std::span<std::string_view> qualified_name;
        /// The index of the target name in the qualified name
        size_t qualified_name_target_idx = 0;
        /// Prefer qualification
        bool prefer_qualified = false;
    };
    static_assert(std::is_trivially_destructible_v<CandidateCatalogObject>,
                  "Candidate objects must be trivially destructable");

    /// A completion candidate
    struct Candidate {
        /// The completion text
        std::string_view completion_text;
        /// Is the completion text verbatim?
        /// Identity candidates reproduce exactly what the user typed (including any quotes) and
        /// must not be re-normalized through `quote_anyupper_fuzzy` at pack time. Otherwise a
        /// quoted lower-case identifier like `"year"` would be re-emitted unquoted as `year`,
        /// and a quoted upper-case one like `"Year"` would be quoted twice.
        bool completion_text_is_verbatim = false;
        /// The combined coarse-granular analyzer tags.
        /// We may hit the same name multiple times in multiple catalog entries.
        /// Each of these entries may have different name tags, so we have to merge them here.
        NameTags coarse_name_tags;
        /// The combined more fine-granular candidate tags
        CandidateTags candidate_tags;
        /// The target text to replace
        sx::parser::SymbolSpan target_location;
        /// The target text to replace when adding a qualified text
        sx::parser::SymbolSpan target_location_qualified;
        /// The catalog objects
        IntrusiveList<CandidateCatalogObject> catalog_objects;
        /// The score (if computed)
        ScoreValueType score = 0;
        /// The keyword symbol (set for keyword candidates)
        std::optional<parser::Parser::symbol_kind_type> keyword_symbol;
        /// The keyword continuation text (e.g. "by"), set by DeriveKeywordContinuationsForTopCandidates
        std::string_view keyword_continuation;
        /// Is less in the min-heap?
        /// We want to kick a candidate A before candidate B if
        ///     1) the score of A is less than the score of B
        ///     2) the name of A is lexicographically larger than B
        bool operator<(const Candidate& other) const {
            auto l = score;
            auto r = other.score;
            return (l < r) ||
                   (l == r && (fuzzy_ci_string_view{completion_text.data(), completion_text.size()} >
                               fuzzy_ci_string_view{other.completion_text.data(), other.completion_text.size()}));
        }
    };
    static_assert(std::is_trivially_destructible_v<Candidate>, "Candidates must be trivially destructable");

    /// Helper to find candidates in an index
    void findCandidatesInIndex(const CatalogEntry::NameSearchIndex& index, bool through_catalog);
    /// Determine whether a real token follows the cursor's feed point (the write-front check).
    /// Uses the same feed/insert-vs-replace logic as the keyword suffix probe.
    bool computeHasPostCursorToken() const;

   protected:
    /// The script cursor
    const ScriptCursor& cursor;
    /// The completion strategy
    const buffers::completion::CompletionStrategy strategy;
    /// Is the target qualified?
    bool dot_completion = false;
    /// Is the cursor at a definition position (name being defined, not referenced)?
    bool at_definition = false;
    /// Is the cursor between symbols (whitespace after a token)?
    bool between_symbols = false;
    /// Is there a real token after the cursor's feed point?
    bool has_post_cursor_token = false;
    /// The symbol that we are completing.
    /// Note that we sometimes have a choice here between the current and the previous symbol.
    std::optional<ScannedScript::SymbolLocationInfo> target_scanner_symbol;

    /// The candidate buffer
    ChunkBuffer<Candidate, 16> candidates;
    /// The candidate object buffer
    ChunkBuffer<CandidateCatalogObject, 16> candidate_objects;
    /// The candidates by name
    std::unordered_map<std::string_view, std::reference_wrapper<Candidate>> candidates_by_name;
    /// The candidate objects by object.
    /// We use this for boosting individual candidates.
    /// This currently assumes that a catalog object can be added to at most a single candidate.
    ///
    /// We *could* use a btree here if we want to prefix-search for candidate columns of a table.
    /// A hash map keeps object promotion lookups cheap.
    std::unordered_map<QualifiedCatalogObjectID, std::reference_wrapper<CandidateCatalogObject>>
        candidate_objects_by_id;

    /// The result heap, holding up to k entries
    TopKHeap<Candidate> candidate_heap;
    /// The top result candidates
    std::vector<Candidate> top_candidates;
    /// The top candidate names
    ChunkBuffer<std::vector<std::string_view>, 16> top_candidate_names;
    /// Storage for keyword continuation strings (lifetime must outlast candidates)
    ChunkBuffer<std::string, 16> keyword_continuation_strings;

    /// Store the qualified function name
    std::span<std::string_view> GetQualifiedFunctionName(const CatalogEntry::QualifiedFunctionName& name);
    /// Store the qualified table name
    std::span<std::string_view> GetQualifiedTableName(const CatalogEntry::QualifiedTableName& name);
    /// Store the qualified column name
    std::span<std::string_view> GetQualifiedColumnName(const CatalogEntry::QualifiedTableName& name,
                                                       const RegisteredName& column);
    /// Store the qualified column name
    std::span<std::string_view> GetQualifiedColumnName(const RegisteredName& alias, const RegisteredName& column);

    /// Complete after a dot
    void FindCandidatesForNamePath();
    /// Find the candidates in completion indexes
    void FindCandidatesInIndexes();
    /// Add CTEs, script-local relations, and their output columns from the current semantic scope.
    void FindCandidatesInScope();
    /// Add output columns from the inline SELECT source of the surrounding VISUALIZE statement.
    void FindCandidatesInInlineVisualizeSource();
    /// Add or merge a non-catalog candidate using the supplied typed prefix and replacement range.
    void AddLocalCandidate(std::string_view name, NameTags name_tags, CandidateTags candidate_tags,
                           std::string_view prefix, sx::parser::SymbolSpan target_location,
                           sx::parser::SymbolSpan target_location_qualified);
    /// Read the identifier prefix to the left of the cursor in the current scanner symbol.
    std::string_view ReadTargetPrefix() const;
    /// Promote identifiers that are in the current name scope of in the same statement
    void PromoteIdentifiersInScope();
    /// Promote tables that contain column names that are still unresolved in the current statement
    void PromoteTablesAndPeersForUnresolvedColumns();
    /// Add expected keywords in the grammar directly to the result heap.
    /// We deliberately do not register them as candidates to not inflate the results.
    /// We accept that they may occur twice in the completion list and we mark them explictly as grammar matches in the
    /// UI.
    /// `prefix` is the LALR state snapshot taken by `ParseUntilWithSnapshot` at the same target
    /// the caller used to compute `symbols`; reused here for the suffix probe so the prefix
    /// isn't reparsed.
    void AddExpectedKeywordsAsCandidates(std::span<parser::Parser::ExpectedSymbol> symbols,
                                         const parser::Parser::PrefixSnapshot& prefix);
    /// Flush pending candidates and finish the results
    void SelectTopCandidates();
    /// Derive keyword continuations for results (e.g. group >by<, create >table<, inner >join<)
    /// `prefix` is the LALR state snapshot from `ParseUntilWithSnapshot`, reused to probe whether a
    /// continuation stays compatible with the post-cursor token stream (so mid-statement
    /// continuations that would conflict with trailing text are dropped, but valid ones kept).
    void DeriveKeywordContinuationsForTopCandidates(const parser::Parser::PrefixSnapshot& prefix);
    /// Make sure top-candidates are qualified
    void QualifyTopCandidates();

   public:
    /// Constructor
    Completion(const ScriptCursor& cursor, size_t k);

    /// Is a scanner symbol kind completable?
    /// False for punctuation, literals, and other symbols where completing the symbol itself makes no sense.
    static bool IsSymbolKindCompletable(parser::Parser::symbol_kind_type kind);

    /// Get the cursor
    auto& GetCursor() const { return cursor; }
    /// Get the target scanner symbol
    auto& GetTargetSymbol() const { return target_scanner_symbol; }
    /// Get the completion strategy
    auto& GetStrategy() const { return strategy; }
    /// Are we dot-completing?
    auto& IsDotCompletion() const { return dot_completion; }
    /// Get the result heap
    auto& GetHeap() const { return candidate_heap; }
    /// Get the result candidates after finishing
    auto& GetResultCandidates() const { return top_candidates; }

    /// Pack the completion result
    flatbuffers::Offset<buffers::completion::Completion> Pack(flatbuffers::FlatBufferBuilder& builder);

    // Compute completion at a cursor (throws Exception on error)
    static std::unique_ptr<Completion> Compute(const ScriptCursor& cursor, size_t k);

};

}  // namespace dashql
