#pragma once

#include <type_traits>

#include "dashql/buffers/index_generated.h"
#include "dashql/catalog_object.h"
#include "dashql/script.h"
#include "dashql/script_registry.h"
#include "dashql/text/names.h"
#include "dashql/utils/enum_bitset.h"
#include "dashql/utils/topk.h"

namespace dashql {

class ScriptRegistry;

struct Completion {
    /// A score value
    using ScoreValueType = uint32_t;
    /// A bitset for candidate tags
    using CandidateTags =
        EnumBitset<uint32_t, buffers::completion::CandidateTag, buffers::completion::CandidateTag::MAX>;

    struct Candidate;

    /// The snippets for a catalog object.
    /// We keep them separate as we're only resolving snippets for catalog objects of top candidates
    struct CatalogObjectSnippets {
        /// The column restriction snippets
        ScriptRegistry::SnippetMap restriction_snippets;
        /// The column computation snippets
        ScriptRegistry::SnippetMap computation_snippets;

        /// Pack the snippets
        flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>>> Pack(
            flatbuffers::FlatBufferBuilder& builder,
            std::vector<flatbuffers::Offset<buffers::snippet::ScriptTemplate>>& tmp_templates,
            std::vector<flatbuffers::Offset<buffers::snippet::ScriptSnippet>>& tmp_snippets) const;
    };

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
        /// The script snippets (if resolved)
        std::optional<std::reference_wrapper<CatalogObjectSnippets>> script_snippets;
    };
    static_assert(std::is_trivially_destructible_v<CandidateCatalogObject>,
                  "Candidate objects must be trivially destructable");

    /// A completion candidate
    struct Candidate {
        /// The completion text
        std::string_view completion_text;
        /// The combined coarse-granular analyzer tags.
        /// We may hit the same name multiple times in multiple catalog entries.
        /// Each of these entries may have different name tags, so we have to merge them here.
        NameTags coarse_name_tags;
        /// The combined more fine-granular candidate tags
        CandidateTags candidate_tags;
        /// The target text to replace
        sx::parser::Location target_location;
        /// The target text to replace when adding a qualified text
        sx::parser::Location target_location_qualified;
        /// The catalog objects
        IntrusiveList<CandidateCatalogObject> catalog_objects;
        /// The score (if computed)
        ScoreValueType score = 0;
        /// Prefer qualified tables?
        bool prefer_qualified_tables = 0;
        /// Prefer qualified columns?
        bool prefer_qualified_columns = 0;
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

   protected:
    /// The script cursor
    const ScriptCursor& cursor;
    /// The completion strategy
    const buffers::completion::CompletionStrategy strategy;
    /// Is the target qualified?
    bool dot_completion = false;
    /// The symbol that we are completing.
    /// Note that we sometimes have a choice here between the current and the previous symbol.
    std::optional<ScannedScript::SymbolLocationInfo> target_scanner_symbol;

    /// The candidate buffer
    ChunkBuffer<Candidate, 16> candidates;
    /// The candidate object buffer
    ChunkBuffer<CandidateCatalogObject, 16> candidate_objects;
    /// The script snippets for candidate objects
    ChunkBuffer<CatalogObjectSnippets, 16> candidate_object_snippets;
    /// The candidates by name
    std::unordered_map<std::string_view, std::reference_wrapper<Candidate>> candidates_by_name;
    /// The candidate objects by object.
    /// We use this for boosting individual candidates.
    /// This currently assumes that a catalog object can be added to at most a single candidate.
    ///
    /// We *could* use a btree here if we want to prefix-search for candidate columns of a table.
    /// However, `PromoteIdentifiersInScripts` probes this hash map with all identifiers that we can find
    /// through the script registry. Having a hash-map there outweighs resolving scope columns without prefix.
    std::unordered_map<QualifiedCatalogObjectID, std::reference_wrapper<CandidateCatalogObject>>
        candidate_objects_by_id;

    /// The result heap, holding up to k entries
    TopKHeap<Candidate> candidate_heap;
    /// The top result candidates
    std::vector<Candidate> top_candidates;
    /// The top candidate names
    ChunkBuffer<std::vector<std::string_view>, 16> top_candidate_names;

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
    /// Promote identifiers that are in the current name scope of in the same statement
    void PromoteIdentifiersInScope();
    /// Promote identifiers that were used before
    void PromoteIdentifiersInScripts(ScriptRegistry& registry);
    /// Promote tables that contain column names that are still unresolved in the current statement
    void PromoteTablesAndPeersForUnresolvedColumns();
    /// Add expected keywords in the grammar directly to the result heap.
    /// We deliberately do not register them as candidates to not inflate the results.
    /// We accept that they may occur twice in the completion list and we mark them explictly as grammar matches in the
    /// UI.
    void AddExpectedKeywordsAsCandidates(std::span<parser::Parser::ExpectedSymbol> symbols);
    /// Flush pending candidates and finish the results
    void SelectTopCandidates();
    /// Find identifier snippets for results (after flushing)
    void FindIdentifierSnippetsForTopCandidates(ScriptRegistry& registry);
    /// Derive keyword snippets for results (e.g. group >by<, partition >by<, create >table<, inner >join<)
    void DeriveKeywordSnippetsForTopCandidates();
    /// Make sure top-candidates are qualified
    void QualifyTopCandidates();

   public:
    /// Constructor
    Completion(const ScriptCursor& cursor, size_t k);

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

    // Compute completion at a cursor
    static std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Compute(
        const ScriptCursor& cursor, size_t k, ScriptRegistry* registry = nullptr);

    // Update completion at a cursor after selecting a candidate of a previous completion
    static std::pair<CompletionPtr, buffers::status::StatusCode> SelectCandidate(
        flatbuffers::FlatBufferBuilder& builder, const ScriptCursor& cursor,
        const buffers::completion::Completion& _completion, size_t _candidate_idx,
        std::optional<size_t> _catalog_object_idx = std::nullopt);
    // Update completion at a cursor after qualifying a candidate of a previous completion
    static std::pair<CompletionPtr, buffers::status::StatusCode> SelectQualifiedCandidate(
        flatbuffers::FlatBufferBuilder& builder, const ScriptCursor& cursor,
        const buffers::completion::Completion& _completion, size_t _candidate_idx, size_t catalog_object_idx);
};

}  // namespace dashql
