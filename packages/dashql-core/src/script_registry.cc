#include "dashql/script_registry.h"

#include "dashql/buffers/index_generated.h"

namespace dashql {

void ScriptRegistry::Clear() {}

void ScriptRegistry::DropScript(Script& script) {}

buffers::status::StatusCode ScriptRegistry::LoadScript(Script& script) {
    if (!script.analyzed_script) {
        return buffers::status::StatusCode::REGISTRY_SCRIPT_NOT_ANALYZED;
    }
    auto& analyzed = *script.analyzed_script;

    return buffers::status::StatusCode::OK;
}

void ScriptRegistry::FindColumnRestrictions(
    ContextObjectID table, ColumnID column_id, std::string_view column_name,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnRestriction&)>& callback) {
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
            callback(script_entry.script, *script_entry.analyzed, restriction);
        }
    }
}

void ScriptRegistry::FindColumnTransforms(
    ContextObjectID table, ColumnID column_id, std::string_view column_name,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnTransform&)>& callback) {
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
            callback(script_entry.script, *script_entry.analyzed, transform);
        }
    }
}

flatbuffers::Offset<buffers::registry::ScriptRegistryColumnInfo> ScriptRegistry::FindColumnRefs(
    flatbuffers::FlatBufferBuilder& builder, ContextObjectID table, std::string_view column_name) {
    buffers::registry::ScriptRegistryColumnInfoBuilder info_builder{builder};
    return info_builder.Finish();
}

}  // namespace dashql
