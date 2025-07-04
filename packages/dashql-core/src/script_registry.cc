#include "dashql/script_registry.h"

#include <variant>

#include "dashql/buffers/index_generated.h"

namespace dashql {

void ScriptRegistry::Clear() {}

void ScriptRegistry::DropScript(Script& script) {}

buffers::status::StatusCode ScriptRegistry::LoadScript(Script& script) {
    if (!script.analyzed_script) {
        return buffers::status::StatusCode::SCRIPT_NOT_ANALYZED;
    }
    auto& analyzed = *script.analyzed_script;

    return buffers::status::StatusCode::OK;
}

std::vector<ScriptRegistry::IndexedColumnRestriction> ScriptRegistry::FindColumnRestrictions(
    ContextObjectID table, ColumnID column_id, CatalogVersion target_catalog_version) {
    // Collect column restrictions
    std::vector<ScriptRegistry::IndexedColumnRestriction> lookup;
    // Track outdated refs
    std::vector<std::tuple<ContextObjectID, ColumnID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_restrictions.lower_bound({table, column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_restrictions.end(); ++iter) {
        // Same key?
        auto [iter_table, iter_column, iter_script] = iter.key();
        if (iter_table != table && iter_column != column_id) {
            break;
        }
        // Script still alive?
        auto script_iter = script_entries.find(iter_script);
        if (script_iter == script_entries.end()) {
            continue;
        }
        auto& script_entry = script_iter->second;
        auto analyzed = script_entry.analyzed;
        assert(analyzed != nullptr);

        // Collect restrictions in the analyzed script
        auto [b, e] = analyzed->column_restrictions_by_catalog_entry.equal_range({table, column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& restriction = b->second.get();

            // Unpack the column ref
            auto& column_ref_expr = restriction.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (resolved->referenced_catalog_version < target_catalog_version) {
                    outdated.emplace_back(table, column_id, &script_entry.script);
                    break;
                }
            }

            lookup.emplace_back(script_entry.script, *script_entry.analyzed, restriction);
        }
    }

    // Remove outdated from the index.
    // Note that we're only dropping the outdated column ref here.
    // Other column refs from these scripts might still be valid after all.
    for (auto& key : outdated) {
        column_restrictions.erase(key);
    }
    return lookup;
}

std::vector<ScriptRegistry::IndexedColumnTransform> ScriptRegistry::FindColumnTransforms(
    ContextObjectID table, ColumnID column_id, CatalogVersion target_catalog_version) {
    // Collect column transforms
    std::vector<ScriptRegistry::IndexedColumnTransform> lookup;
    // Track outdated refs
    std::vector<std::tuple<ContextObjectID, ColumnID, const Script*>> outdated;

    // Search the qualified column id
    auto iter = column_transforms.lower_bound({table, column_id, nullptr});
    // Iterate over restrictions
    for (; iter != column_transforms.end(); ++iter) {
        // Same key?
        auto [iter_table, iter_column, iter_script] = iter.key();
        if (iter_table != table && iter_column != column_id) {
            break;
        }
        // Script still alive?
        auto script_iter = script_entries.find(iter_script);
        if (script_iter == script_entries.end()) {
            continue;
        }
        auto& script_entry = script_iter->second;
        auto analyzed = script_entry.analyzed;
        assert(analyzed != nullptr);

        // Collect transforms in the analyzed script
        auto [b, e] = analyzed->column_transforms_by_catalog_entry.equal_range({table, column_id});
        for (auto r_iter = b; r_iter != e; ++r_iter) {
            auto& transform = b->second.get();
            lookup.emplace_back(script_entry.script, *script_entry.analyzed, transform);

            // Unpack the column ref
            auto& column_ref_expr = transform.column_ref.get();
            assert(std::holds_alternative<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner));
            auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(column_ref_expr.inner);

            // If it is resolved, check the catalog_version.
            // If it is older than the provided catalog version, we know that the analyzed script is outdated.
            // (We are here looking up a column ref that was registered with the catalog at a later point than this ref)
            if (auto& resolved = column_ref.resolved_column) {
                if (resolved->referenced_catalog_version < target_catalog_version) {
                    outdated.emplace_back(table, column_id, &script_entry.script);
                    break;
                }
            }
            lookup.emplace_back(script_entry.script, *script_entry.analyzed, transform);
        }
    }

    // Remove outdated from the index.
    // Note that we're only dropping the outdated column ref here.
    // Other column refs from these scripts might still be valid after all.
    for (auto& key : outdated) {
        column_transforms.erase(key);
    }
    return lookup;
}

flatbuffers::Offset<buffers::registry::ScriptRegistryColumnInfo> ScriptRegistry::FindColumnInfo(
    flatbuffers::FlatBufferBuilder& builder, ContextObjectID table, ColumnID column_id,
    CatalogVersion target_catalog_version) {
    // Find all column restrictions
    auto restrictions = FindColumnRestrictions(table, column_id, target_catalog_version);
    // Find all column transforms
    auto transforms = FindColumnTransforms(table, column_id, target_catalog_version);

    // XXX Pack restrictions and transforms

    buffers::registry::ScriptRegistryColumnInfoBuilder info_builder{builder};
    return info_builder.Finish();
}

}  // namespace dashql
