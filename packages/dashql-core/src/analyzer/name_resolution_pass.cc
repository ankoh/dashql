#include "dashql/analyzer/name_resolution_pass.h"

#include <format>
#include <functional>
#include <iterator>
#include <optional>
#include <variant>

#include "dashql/analyzer/analysis_state.h"
#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/script.h"
#include "dashql/utils/ast_attributes.h"
#include "dashql/utils/intrusive_list.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;

/// Helper to merge two vectors
template <typename T> static void merge(std::vector<T>& left, std::vector<T>&& right) {
    if (left.empty()) {
        left = std::move(right);
    } else {
        left.insert(left.end(), std::make_move_iterator(right.begin()), std::make_move_iterator(right.end()));
        right.clear();
    }
}

/// Merge two node states
void NameResolutionPass::NodeState::Merge(NodeState&& other) {
    child_scopes.Append(std::move(other.child_scopes));
    table_columns.Append(std::move(other.table_columns));
    table_references.Append(std::move(other.table_references));
    column_references.Append(std::move(other.column_references));
}

/// Clear a node state
void NameResolutionPass::NodeState::Clear() {
    child_scopes.Clear();
    table_columns.Clear();
    table_references.Clear();
    column_references.Clear();
}

/// Constructor
NameResolutionPass::NameResolutionPass(AnalysisState& state)
    : PassManager::LTRPass(state), node_states(state.ast.size()) {}

/// Register a schema
std::pair<CatalogDatabaseID, CatalogSchemaID> NameResolutionPass::RegisterSchema(RegisteredName& database_name,
                                                                                 RegisteredName& schema_name) {
    // Register the database
    CatalogDatabaseID db_id = 0;
    CatalogSchemaID schema_id = 0;
    auto db_ref_iter = state.analyzed->databases_by_name.find(database_name);
    if (db_ref_iter == state.analyzed->databases_by_name.end()) {
        db_id = state.catalog.AllocateDatabaseId(database_name);
        auto& db =
            state.analyzed->database_references.PushBack(CatalogEntry::DatabaseReference{db_id, database_name, ""});
        state.analyzed->databases_by_name.insert({db.database_name, db});
        database_name.resolved_objects.PushBack(db.CastToBase());
    } else {
        db_id = db_ref_iter->second.get().catalog_database_id;
    }
    // Register the schema
    auto schema_ref_iter = state.analyzed->schemas_by_qualified_name.find({database_name, schema_name});
    if (schema_ref_iter == state.analyzed->schemas_by_qualified_name.end()) {
        schema_id = state.catalog.AllocateSchemaId(database_name, schema_name);
        auto& schema = state.analyzed->schema_references.PushBack(
            CatalogEntry::SchemaReference{db_id, schema_id, database_name, schema_name});
        state.analyzed->schemas_by_qualified_name.insert({{database_name, schema_name}, schema});
        schema_name.resolved_objects.PushBack(schema.CastToBase());
    } else {
        schema_id = schema_ref_iter->second.get().catalog_schema_id;
    }
    return {db_id, schema_id};
}

void NameResolutionPass::MergeChildStates(NodeState& dst,
                                          std::initializer_list<const buffers::parser::Node*> children) {
    for (const buffers::parser::Node* child : children) {
        if (!child) continue;
        dst.Merge(std::move(node_states[child - state.ast.data()]));
    }
}

void NameResolutionPass::MergeChildStates(NodeState& dst, const buffers::parser::Node& parent) {
    for (size_t i = 0; i < parent.children_count(); ++i) {
        auto child_id = parent.children_begin_or_value() + i;
        auto& child = node_states[parent.children_begin_or_value() + i];
        dst.Merge(std::move(child));
    }
}

AnalyzedScript::NameScope& NameResolutionPass::CreateScope(NodeState& target, uint32_t scope_root) {
    auto& scope = state.analyzed->name_scopes.PushBack(
        AnalyzedScript::NameScope{.name_scope_id = state.analyzed->name_scopes.GetSize(),
                                  .ast_node_id = scope_root,
                                  .parent_scope = nullptr,
                                  .child_scopes = target.child_scopes.CastAsBase()});
    state.analyzed->name_scopes_by_root_node.insert({scope_root, scope});
    for (auto& child_scope : target.child_scopes) {
        child_scope.parent_scope = &scope;
        root_scopes.erase(&child_scope);
    }
    for (auto& ref : target.column_references) {
        assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(ref.inner));
        auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(ref.inner);
        column_ref.ast_scope_root = scope_root;
    }
    for (auto& ref : target.table_references) {
        ref.ast_scope_root = scope_root;
    }
    scope.table_references = target.table_references;
    scope.expressions = target.column_references;
    // Clear the target since we're starting a new scope now
    target.Clear();
    // Remember the child scope
    target.child_scopes.PushBack(scope);
    root_scopes.insert(&scope);
    return scope;
}

constexpr size_t MAX_TABLE_REF_AMBIGUITY = 100;

void NameResolutionPass::ResolveTableRefsInScope(AnalyzedScript::NameScope& scope) {
    for (auto& table_ref : scope.table_references) {
        // TODO Matches a view or CTE?

        auto* rel_expr = std::get_if<AnalyzedScript::TableReference::RelationExpression>(&table_ref.inner);
        if (!rel_expr || rel_expr->resolved_table.has_value()) {
            continue;
        }
        // Copy table name so that we can override the unresolved expression
        auto table_name = rel_expr->table_name;
        // Helper to register a name
        auto register_name = [&](std::string_view alias, const AnalyzedScript::TableDeclaration& table) {
            // Already exists in this scope?
            auto resolved_iter = scope.referenced_tables_by_name.find(alias);
            if (resolved_iter != scope.referenced_tables_by_name.end()) {
                // Register an error
                auto& error = state.analyzed->errors.emplace_back();
                error.error_type = buffers::analyzer::AnalyzerErrorType::DUPLICATE_TABLE_ALIAS;
                error.ast_node_id = table_ref.ast_node_id;
                error.location =
                    std::make_unique<buffers::parser::Location>(state.parsed.nodes[table_ref.ast_node_id].location());

                std::string tmp;
                std::string_view alias_text = alias;
                alias_text = quote_anyupper_fuzzy(alias_text, tmp);
                error.message = std::format("duplicate table alias {}", alias_text);
            } else {
                scope.referenced_tables_by_name.insert({alias, table});
            }
        };

        // Try to resolve in the own script
        std::vector<std::reference_wrapper<const CatalogEntry::TableDeclaration>> resolved_tables;
        state.analyzed->ResolveTable(table_name, resolved_tables, MAX_TABLE_REF_AMBIGUITY);

        // Didn't find anything?
        // Then resolve through the catalog
        if (resolved_tables.size() == 0) {
            state.catalog.ResolveTable(table_name, state.catalog_entry_id, resolved_tables, MAX_TABLE_REF_AMBIGUITY);
        }

        // Found something?
        // Then register the resolved table(s)
        if (resolved_tables.size() > 0) {
            // Always pick the first match, ResolveTable respects qualification and catalog entry ranks
            auto& best_match = resolved_tables.front().get();

            // Store resolved relation expression
            rel_expr->resolved_table = AnalyzedScript::TableReference::ResolvedTableEntry{
                .table_name = best_match.table_name,
                .catalog_database_id = best_match.catalog_database_id,
                .catalog_schema_id = best_match.catalog_schema_id,
                .catalog_table_id = best_match.catalog_table_id,
            };

            // Store ambiguous matches
            for (size_t i = 1; i < resolved_tables.size(); ++i) {
                auto& match = resolved_tables[i].get();
                rel_expr->resolved_alternatives.push_back({
                    .table_name = match.table_name,
                    .catalog_database_id = match.catalog_database_id,
                    .catalog_schema_id = match.catalog_schema_id,
                    .catalog_table_id = match.catalog_table_id,
                });
            }

            // Register the table either using the alias or the table name
            std::string_view alias = table_ref.alias_name.has_value() ? table_ref.alias_name->get().text
                                                                      : best_match.table_name.table_name.get().text;
            register_name(alias, best_match);
            continue;
        }

        // Otherwise leave unresolved
    }
}

void NameResolutionPass::ResolveColumnRefsInScope(AnalyzedScript::NameScope& scope, ColumnRefsByAlias& refs_by_alias,
                                                  ColumnRefsByName& refs_by_name) {
    std::list<std::reference_wrapper<AnalyzedScript::Expression>> unresolved_columns;
    for (auto& expr : scope.expressions) {
        if (auto col_ref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expr.inner);
            col_ref != nullptr && !col_ref->resolved_column.has_value()) {
            unresolved_columns.push_back(expr);
        }
    }
    // Resolve refs in the scope upwards
    for (auto target_scope = &scope; target_scope != nullptr; target_scope = target_scope->parent_scope) {
        for (auto iter = unresolved_columns.begin(); iter != unresolved_columns.end();) {
            auto& expr = iter->get();
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(expr.inner);
            std::string_view column_name = column_ref.column_name.column_name.get();

            // Try to resolve a table
            std::optional<std::reference_wrapper<AnalyzedScript::TableColumn>> table_column;
            if (column_ref.column_name.table_alias.has_value()) {
                // Do we know the name in this scope?
                std::string_view table_alias = column_ref.column_name.table_alias->get();
                auto table_iter = target_scope->referenced_tables_by_name.find(table_alias);
                if (table_iter != target_scope->referenced_tables_by_name.end()) {
                    // Is the table known in that table?
                    auto& table_columns_by_name = table_iter->second.get().table_columns_by_name;
                    auto column_iter = table_columns_by_name.find(column_name);
                    if (column_iter != table_columns_by_name.end()) {
                        table_column = column_iter->second;
                    }
                }
            } else {
                // Otherwise we check all table declarations and find all tables with the column name
                std::vector<std::tuple<std::string_view, std::reference_wrapper<const CatalogEntry::TableDeclaration>,
                                       std::reference_wrapper<AnalyzedScript::TableColumn>>>
                    candidates;
                for (auto& [table_name, table] : target_scope->referenced_tables_by_name) {
                    auto& table_columns_by_name = table.get().table_columns_by_name;
                    auto column_iter = table_columns_by_name.find(column_name);
                    if (column_iter != table_columns_by_name.end()) {
                        candidates.emplace_back(table_name, table, column_iter->second);
                    }
                }
                // Is the column ref ambiguous?
                if (candidates.size() > 1) {
                    state.analyzed->errors.emplace_back();
                    auto& error = state.analyzed->errors.back();
                    error.error_type = buffers::analyzer::AnalyzerErrorType::COLUMN_REF_AMBIGUOUS;
                    error.ast_node_id = expr.ast_node_id;
                    error.location =
                        std::make_unique<buffers::parser::Location>(state.parsed.nodes[expr.ast_node_id].location());

                    // Construct the error message
                    // Note that we deliberately do not use std::stringstream here since clang is then baking in fd
                    // dependencies: Import #5 module="wasi_snapshot_preview1" function="fd_prestat_get"
                    std::string out = "column reference is ambiguous, candidates: ";
                    std::string tmp;
                    for (size_t i = 0; i < candidates.size(); ++i) {
                        if (i > 0) {
                            out += ", ";
                        }
                        auto& [table_alias, table_decl, table_column] = candidates[i];
                        std::string_view tbl = table_alias;
                        tbl = quote_anyupper_fuzzy(tbl, tmp);
                        out += tbl;
                        out += ".";
                        std::string_view col = column_name;
                        col = quote_anyupper_fuzzy(col, tmp);
                        out += col;
                    }
                    error.message = std::move(out);

                } else if (candidates.size() == 1) {
                    table_column = std::get<2>(candidates.front());
                }
            }
            // Found a table column?
            if (table_column.has_value()) {
                auto& resolved_column = table_column.value().get();
                auto& resolved_table = resolved_column.table->get();
                assert(column_ref.ast_scope_root.has_value());
                auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(expr.inner);
                column_ref.resolved_column = AnalyzedScript::Expression::ResolvedColumn{
                    .catalog_database_id = resolved_table.catalog_database_id,
                    .catalog_schema_id = resolved_table.catalog_schema_id,
                    .catalog_table_id = resolved_table.catalog_table_id,
                    .table_column_id = resolved_column.column_index,
                };
                auto dead_iter = iter++;
                unresolved_columns.erase(dead_iter);
            } else {
                ++iter;
            }
        }
    }
}

void NameResolutionPass::ResolveNames() {
    // Create column ref maps
    ColumnRefsByAlias tmp_refs_by_alias;
    ColumnRefsByAlias tmp_refs_by_name;
    tmp_refs_by_alias.reserve(state.analyzed->expressions.GetSize());
    tmp_refs_by_name.reserve(state.analyzed->expressions.GetSize());

    // Recursively traverse down the scopes
    std::stack<std::reference_wrapper<AnalyzedScript::NameScope>> pending_scopes;
    for (auto& scope : root_scopes) {
        pending_scopes.push(*scope);
    }
    while (!pending_scopes.empty()) {
        auto top = pending_scopes.top();
        pending_scopes.pop();
        ResolveTableRefsInScope(top);
        tmp_refs_by_alias.clear();
        tmp_refs_by_name.clear();
        ResolveColumnRefsInScope(top, tmp_refs_by_alias, tmp_refs_by_name);
        for (auto& child_scope : top.get().child_scopes) {
            pending_scopes.push(*static_cast<AnalyzedScript::NameScope*>(&child_scope));
        }
    }
}

/// Prepare the analysis pass
void NameResolutionPass::Prepare() {}

/// Visit a chunk of nodes
void NameResolutionPass::Visit(std::span<const buffers::parser::Node> morsel) {
    // XXX What about:
    //  indirections? c_expr
    //  subquery with alias

    // Scan nodes in morsel
    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        // Resolve the node
        const buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;
        // Create empty node state
        NodeState& node_state = node_states[node_id];

        // Check node type
        switch (node.node_type()) {
            case buffers::parser::NodeType::OBJECT_SQL_COLUMN_DEF: {
                auto [column_def_node] = state.GetAttributes<AttributeKey::SQL_COLUMN_DEF_NAME>(node);
                if (column_def_node && column_def_node->node_type() == buffers::parser::NodeType::NAME) {
                    auto& name = state.scanned.GetNames().At(column_def_node->children_begin_or_value());
                    name.coarse_analyzer_tags |= buffers::analyzer::NameTag::COLUMN_NAME;
                    if (auto reused = pending_columns_free_list.PopFront()) {
                        *reused = AnalyzedScript::TableColumn(node_id, name);
                        node_state.table_columns.PushBack(*reused);
                    } else {
                        auto& node = pending_columns.PushBack(AnalyzedScript::TableColumn(node_id, name));
                        node_state.table_columns.PushBack(node);
                    }
                }
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_COLUMN_REF: {
                // Read column ref path
                auto [column_ref_node] = state.GetAttributes<AttributeKey::SQL_COLUMN_REF_PATH>(node);
                auto column_name_node_id = static_cast<uint32_t>(column_ref_node - state.parsed.nodes.data());
                auto column_name = state.ReadQualifiedColumnName(column_ref_node);
                if (column_name.has_value()) {
                    // Add column reference
                    AnalyzedScript::Expression::ColumnRef column_ref{
                        .column_name = column_name.value(),
                        .ast_scope_root = std::nullopt,
                        .resolved_column = std::nullopt,
                    };
                    auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(column_ref));
                    // Mark column refs as (identity) transform
                    n.is_column_transform = true;
                    node_state.column_references.PushBack(n);
                    state.SetAnalyzed(node, n);
                }
                // Column refs may be recursive
                MergeChildStates(node_state, node);
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_TABLEREF: {
                // Read a table ref name
                auto [name_node, alias_node] =
                    state.GetAttributes<AttributeKey::SQL_TABLEREF_NAME, AttributeKey::SQL_TABLEREF_ALIAS>(node);
                // Only consider table refs with a name for now
                if (name_node) {
                    auto name_node_id = static_cast<uint32_t>(name_node - state.parsed.nodes.data());
                    auto name = state.ReadQualifiedTableName(name_node);
                    if (name.has_value()) {
                        // Read a table alias
                        std::string_view alias_str;
                        std::optional<std::reference_wrapper<RegisteredName>> alias_name = std::nullopt;
                        if (alias_node && alias_node->node_type() == buffers::parser::NodeType::NAME) {
                            auto& alias = state.scanned.GetNames().At(alias_node->children_begin_or_value());
                            alias.coarse_analyzer_tags |= buffers::analyzer::NameTag::TABLE_ALIAS;
                            alias_str = alias;
                            alias_name = alias;
                        }
                        // Add table reference
                        auto& n = state.analyzed->table_references.PushBack(AnalyzedScript::TableReference(alias_name));
                        n.buffer_index = state.analyzed->table_references.GetSize() - 1;
                        n.table_reference_id =
                            ContextObjectID{state.catalog_entry_id,
                                            static_cast<uint32_t>(state.analyzed->table_references.GetSize() - 1)};
                        n.ast_node_id = node_id;
                        n.location = state.parsed.nodes[node_id].location();
                        n.ast_statement_id = std::nullopt;
                        n.ast_scope_root = std::nullopt;
                        n.inner = AnalyzedScript::TableReference::RelationExpression{
                            .table_name = name.value(),
                            .resolved_table = std::nullopt,
                            .resolved_alternatives = {},
                        };
                        node_state.table_references.PushBack(n);
                    }
                }
                // Table refs may be recursive
                MergeChildStates(node_state, node);
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_RESULT_TARGET: {
                // // Read result target
                // auto children = ast.subspan(node.children_begin_or_value(), node.children_count());
                // auto attrs = attribute_index.Load(children);
                //
                // if (auto star_node = attrs[buffers::parser::AttributeKey::SQL_RESULT_TARGET_STAR]) {
                //
                // }
                // // Specifies a target name?
                // if (auto name_node = attrs[buffers::parser::AttributeKey::SQL_RESULT_TARGET_NAME]) {
                // }
                //
                // XXX Register result targets
                MergeChildStates(node_state, node);
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_SELECT: {
                MergeChildStates(node_state, node);
                CreateScope(node_state, node_id);
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_CREATE: {
                auto [name_node, elements_node] =
                    state.GetAttributes<AttributeKey::SQL_CREATE_TABLE_NAME, AttributeKey::SQL_CREATE_TABLE_ELEMENTS>(
                        node);
                // Read the name
                auto table_name = state.ReadQualifiedTableName(name_node);
                if (table_name.has_value()) {
                    // Register the database
                    auto [db_id, schema_id] = RegisterSchema(table_name->database_name, table_name->schema_name);
                    // Determine the catalog table id
                    ContextObjectID catalog_table_id{
                        state.catalog_entry_id, static_cast<uint32_t>(state.analyzed->table_declarations.GetSize())};
                    // Merge child states
                    MergeChildStates(node_state, {elements_node});
                    // Collect all columns
                    auto table_columns = node_state.table_columns.Flatten();
                    pending_columns_free_list.Append(std::move(node_state.table_columns));

                    // Sort the table columns
                    std::sort(table_columns.begin(), table_columns.end(),
                              [&](CatalogEntry::TableColumn& l, CatalogEntry::TableColumn& r) {
                                  return l.column_name.get().text < r.column_name.get().text;
                              });
                    // Create the scope
                    CreateScope(node_state, node_id);
                    // Build the table
                    auto& n = state.analyzed->table_declarations.PushBack(
                        AnalyzedScript::TableDeclaration(table_name.value()));
                    n.catalog_table_id = catalog_table_id;
                    n.catalog_database_id = db_id;
                    n.catalog_schema_id = schema_id;
                    n.ast_node_id = node_id;
                    n.table_columns = std::move(table_columns);
                    // Register the table declaration
                    table_name->table_name.get().resolved_objects.PushBack(n);
                    // Update the table ref and index of all columns
                    n.table_columns_by_name.reserve(n.table_columns.size());
                    for (size_t column_index = 0; column_index != n.table_columns.size(); ++column_index) {
                        auto& column = n.table_columns[column_index];
                        column.table = n;
                        column.column_index = column_index;
                        column.column_name.get().resolved_objects.PushBack(column);
                        n.table_columns_by_name.insert({column.column_name.get().text, column});
                    }
                }
                break;
            }

            case buffers::parser::NodeType::OBJECT_SQL_CREATE_AS: {
                auto [name_node, elements_node] =
                    state.GetAttributes<buffers::parser::AttributeKey::SQL_CREATE_TABLE_NAME,
                                        buffers::parser::AttributeKey::SQL_CREATE_TABLE_ELEMENTS>(node);

                (void)name_node;
                (void)elements_node;
                break;
            }

            // By default, merge child states into the node state
            default:
                MergeChildStates(node_state, node);
                break;
        }
    }
}

/// Finish the analysis pass
void NameResolutionPass::Finish() {
    for (auto& table_chunk : state.analyzed->table_declarations.GetChunks()) {
        for (auto& table : table_chunk) {
            state.analyzed->tables_by_qualified_name.insert({table.table_name, table});
            state.analyzed->tables_by_unqualified_name.insert({table.table_name.table_name.get().text, table});
            if (table.table_name.schema_name.get() != "") {
                state.analyzed->tables_by_unqualified_schema.insert(
                    {{table.table_name.schema_name.get(), table.table_name.database_name.get()}, table});
            }
        }
    }

    // Resolve all names
    ResolveNames();

    // Bail out if there are no statements
    if (!state.parsed.statements.empty()) {
        // Helper to assign statement ids
        auto assign_statment_ids = [&](auto& chunks) {
            uint32_t statement_id = 0;
            size_t statement_begin = state.parsed.statements[0].nodes_begin;
            size_t statement_end = statement_begin + state.parsed.statements[0].node_count;
            for (auto& chunk : chunks) {
                for (auto& ref : chunk) {
                    // Search first statement that might include the node
                    while (statement_end <= ref.ast_node_id && statement_id < state.parsed.statements.size()) {
                        ++statement_id;
                        statement_begin = state.parsed.statements[statement_id].nodes_begin;
                        statement_end = statement_begin + state.parsed.statements[statement_id].node_count;
                    }
                    // There is none?
                    // Abort, all other refs won't match either
                    if (statement_id == state.parsed.statements.size()) {
                        break;
                    }
                    // The statement includes the node?
                    if (statement_begin <= ref.ast_node_id) {
                        ref.ast_statement_id = statement_id;
                        continue;
                    }
                    // Otherwise lthe ast_node does not belong to a statement, check next one
                }
            }
        };
        assign_statment_ids(state.analyzed->table_references.GetChunks());
        assign_statment_ids(state.analyzed->expressions.GetChunks());
        assign_statment_ids(state.analyzed->name_scopes.GetChunks());
    }

    // Index the table declarations
    state.analyzed->table_declarations.ForEach([&](size_t ti, auto& table) {
        for (size_t i = 0; i < table.table_columns.size(); ++i) {
            auto& column = table.table_columns[i];
            state.analyzed->table_columns_by_name.insert({column.column_name.get().text, column});
        }
    });
}

}  // namespace dashql
