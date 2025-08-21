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
    };
    static_assert(std::is_trivially_destructible_v<CandidateCatalogObject>,
                  "Candidate objects must be trivially destructable");

    /// A completion candidate
    struct Candidate {
        /// The name
        std::string_view name;
        /// The combined coarse-granular analyzer tags.
        /// We may hit the same name multiple times in multiple catalog entries.
        /// Each of these entries may have different name tags, so we have to merge them here.
        NameTags coarse_name_tags;
        /// The combined more fine-granular candidate tags
        CandidateTags candidate_tags;
        /// Replace text at a location
        sx::parser::Location replace_text_at;
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
            return (l < r) || (l == r && (fuzzy_ci_string_view{name.data(), name.size()} >
                                          fuzzy_ci_string_view{other.name.data(), other.name.size()}));
        }
    };
    static_assert(std::is_trivially_destructible_v<Candidate>, "Candidates must be trivially destructable");

    /// A candidate that was picked
    struct ResultCandidate : public Candidate {
        /// The column restriction snippets
        ScriptRegistry::SnippetMap restriction_snippets;
        /// The column transform snippets
        ScriptRegistry::SnippetMap transform_snippets;
    };

    /// A name component type
    enum NameComponentType { Name, Star, TrailingDot, Index };
    /// A name component
    struct NameComponent {
        /// The location
        sx::parser::Location loc;
        /// The component type
        NameComponentType type;
        /// The name (if any)
        std::optional<std::reference_wrapper<RegisteredName>> name;
    };

    /// Helper to find candidates in an index
    void findCandidatesInIndex(const CatalogEntry::NameSearchIndex& index, bool through_catalog);

   protected:
    /// The script cursor
    const ScriptCursor& cursor;
    /// The completion strategy
    const buffers::completion::CompletionStrategy strategy;

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
    /// However, `PromoteIdentifiersInScripts` probes this hash map with all identifiers that we can find
    /// through the script registry. Having a hash-map there outweighs resolving scope columns without prefix.
    std::unordered_map<QualifiedCatalogObjectID, std::reference_wrapper<CandidateCatalogObject>>
        candidate_objects_by_id;

    /// The result heap, holding up to k entries
    TopKHeap<Candidate> candidate_heap;
    /// The top result candidates
    std::vector<ResultCandidate> top_candidates;
    /// The top candidate names
    ChunkBuffer<std::vector<std::string_view>, 16> top_candidate_names;

    /// Store the qualified table name
    std::span<std::string_view> GetQualifiedTableName(const CatalogEntry::QualifiedTableName& name);
    /// Store the qualified column name
    std::span<std::string_view> GetQualifiedColumnName(const CatalogEntry::QualifiedTableName& name,
                                                       const RegisteredName& column);
    /// Store the qualified column name
    std::span<std::string_view> GetQualifiedColumnName(const RegisteredName& alias, const RegisteredName& column);

    /// Read the name path of the current cursor
    std::vector<Completion::NameComponent> ReadCursorNamePath(sx::parser::Location& name_path_loc) const;
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
    /// Get the completion strategy
    auto& GetStrategy() const { return strategy; }
    /// Get the result heap
    auto& GetHeap() const { return candidate_heap; }
    /// Get the result candidates after finishing
    auto& GetResultCandidates() const { return top_candidates; }

    /// Pack the completion result
    flatbuffers::Offset<buffers::completion::Completion> Pack(flatbuffers::FlatBufferBuilder& builder);
    // Compute completion at a cursor
    static std::pair<std::unique_ptr<Completion>, buffers::status::StatusCode> Compute(
        const ScriptCursor& cursor, size_t k, ScriptRegistry* registry = nullptr);
};

}  // namespace dashql
