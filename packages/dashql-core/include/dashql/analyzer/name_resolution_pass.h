#pragma once

#include <functional>

#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/text/names.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

struct AnalysisState;

struct NameResolutionPass : public PassManager::LTRPass {
   protected:
    /// A node state during name resolution
    struct NodeState {
        /// The child scopes
        IntrusiveList<AnalyzedScript::NameScope> child_scopes;
        /// The column definitions in the subtree
        IntrusiveList<AnalyzedScript::TableColumn> table_columns;
        /// The table references in scope
        IntrusiveList<AnalyzedScript::TableReference> table_references;
        /// The column references in scope
        IntrusiveList<AnalyzedScript::Expression> column_references;
        /// The result targets in this subtree
        IntrusiveList<AnalyzedScript::ResultTarget> result_targets;
        /// The CTEs in this subtree
        IntrusiveList<AnalyzedScript::CTEDefinition> ctes;

        /// Clear a node state
        void Clear();
        /// Merge two states
        void Merge(NodeState&& other);
    };

   protected:
    /// The state of all nodes
    std::vector<NodeState> node_states;
    /// The root scopes
    ankerl::unordered_dense::set<AnalyzedScript::NameScope*> root_scopes;
    /// The temporary name path buffer
    std::vector<std::reference_wrapper<RegisteredName>> name_path_buffer;
    /// The temporary pending table columns
    ChunkBuffer<AnalyzedScript::TableColumn, 16> pending_columns;
    /// The temporary free-list for pending table columns
    IntrusiveList<AnalyzedScript::TableColumn> pending_columns_free_list;
    /// The pending result targets
    ChunkBuffer<AnalyzedScript::ResultTarget, 16> pending_result_targets;
    /// The pending CTEs
    ChunkBuffer<AnalyzedScript::CTEDefinition, 4> pending_cte_nodes;

    /// Register a schema
    QualifiedCatalogObjectID RegisterSchema(RegisteredName& database_name, RegisteredName& schema_name);

    /// Merge child states into a destination state
    void MergeChildStates(NodeState& dst, const sx::parser::Node& parent);
    /// Merge child states into a destination state
    void MergeChildStates(NodeState& dst, std::initializer_list<const buffers::parser::Node*> children);
    /// Create a naming scope
    AnalyzedScript::NameScope& CreateScope(NodeState& target, uint32_t scope_root_node);

    /// Resolve all table refs in a scope
    void ResolveTableRefsInScope(AnalyzedScript::NameScope& scope);
    /// Resolve column refs against tables in a scope (single scope, no parent walk)
    void ResolveColumnRefsLocally(AnalyzedScript::NameScope& scope);
    /// Resolve column refs against child scope output columns
    void ResolveColumnRefsFromChildOutputs(AnalyzedScript::NameScope& scope);
    /// Resolve remaining unresolved column refs by walking up parent scopes (correlation)
    void ResolveColumnRefsFromParents(AnalyzedScript::NameScope& scope);
    /// Associate still-unresolved column refs with unresolved tables in scope (schema inference).
    /// Emits InferenceConstraints into the AnalyzedScript for the solver to resolve in Finish().
    void AssociateUnresolvedColumns(AnalyzedScript::NameScope& scope);
    /// Populate a scope's output_columns from its result targets
    void PopulateOutputColumns(AnalyzedScript::NameScope& scope);
    /// Resolve all names
    void ResolveNames();
    /// Solve the schema-inference constraints into per-table inferred schemas.
    /// Seeds forced memberships, propagates to a fixpoint, then resolves the residual ambiguity.
    void RunSchemaInference();

   public:
    /// Constructor
    NameResolutionPass(AnalysisState& state);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
