#pragma once

#include <functional>
#include <stack>

#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/text/names.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

struct AnalysisState;

class NameResolutionPass : public PassManager::LTRPass {
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

    /// Register a schema
    QualifiedCatalogObjectID RegisterSchema(RegisteredName& database_name, RegisteredName& schema_name);

    /// Merge child states into a destination state
    void MergeChildStates(NodeState& dst, const sx::parser::Node& parent);
    /// Merge child states into a destination state
    void MergeChildStates(NodeState& dst, std::initializer_list<const buffers::parser::Node*> children);
    /// Create a naming scope
    AnalyzedScript::NameScope& CreateScope(NodeState& target, uint32_t scope_root_node);

    using ColumnRefsByAlias =
        ankerl::unordered_dense::map<std::string_view, std::reference_wrapper<AnalyzedScript::Expression>>;
    using ColumnRefsByName =
        ankerl::unordered_dense::map<std::string_view, std::reference_wrapper<AnalyzedScript::Expression>>;

    /// Resolve all table refs in a scope
    void ResolveTableRefsInScope(AnalyzedScript::NameScope& scope);
    /// Resolve all column refs in a scope
    void ResolveColumnRefsInScope(AnalyzedScript::NameScope& scope, ColumnRefsByAlias& refs_by_alias,
                                  ColumnRefsByName& refs_by_name);
    /// Resolve all names
    void ResolveNames();

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
