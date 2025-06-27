#include "dashql/script_registry.h"

namespace dashql {

void ScriptRegistry::DropScript(Script& script) {}

void ScriptRegistry::LoadScript(Script& script) {
    if (!script.analyzed_script) {
        return;
    }
    auto& analyzed = *script.analyzed_script;
}

void ScriptRegistry::FindColumnRestrictions(
    ContextObjectID table, ColumnID column_id, std::string_view column_name,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnRestriction&)>& callback) {
    // Search the qualified column id
    auto iter = column_restrictions.lower_bound({table, column_id, nullptr});
    // Iterate over restrictions
    while (iter != column_restrictions.end()) {
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
        auto analyzed = script_iter->second.analyzed;
        assert(analyzed != nullptr);

        // Collect restrictions in the analyzed script
        // XXX
    }
}

void ScriptRegistry::FindColumnTransforms(
    ContextObjectID table, ColumnID column_id, std::string_view column_name,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnTransform&)>& callback) {
    // Search the qualified column id
    auto _lb = column_restrictions.lower_bound({table, column_id, nullptr});
}

}  // namespace dashql
