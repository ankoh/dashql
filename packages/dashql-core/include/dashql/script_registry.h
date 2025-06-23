#pragma once

#include "dashql/script.h"

namespace dashql {

using RegistryEntryID = uint32_t;

/// A script registry.
///
/// DashQL has two sources for user completion data.
/// The catalog stores and indexes column, table, schema and database identifiers.
/// The script registry indexes transforms and restrictions in analyzed scripts.
///
/// It is therefore an orthorgonal concept, a script may be added to both.
/// Note that completions currently cost in the order of |scripts| in the Catalog.
/// We expect all scripts to be added in the script registry, but only scripts with DDL statements in the catalog.
///
class ScriptRegistry {
   protected:
    /// A catalog entry backed by an analyzed script
    struct ScriptEntry {
        /// The script
        const Script& script;
        /// The analyzed script
        std::shared_ptr<AnalyzedScript> analyzed;
    };

    /// The script entries
    std::unordered_map<RegistryEntryID, ScriptEntry> script_entries;
};

}  // namespace dashql
