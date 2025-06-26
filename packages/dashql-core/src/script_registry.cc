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
    CatalogEntryID catalogEntry, TableID tableId, ColumnID columnId,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnRestriction&)>& callback) {}

void ScriptRegistry::FindColumnTransforms(
    CatalogEntryID catalogEntry, TableID tableId, ColumnID columnId,
    std::function<bool(const Script&, const AnalyzedScript&, const AnalyzedScript::ColumnTransform&)>& callback) {}

}  // namespace dashql
