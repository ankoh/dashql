#pragma once

#include <functional>

#include "dashql/catalog.h"
#include "dashql/external.h"
#include "dashql/script.h"

namespace dashql {

using RegistryEntryID = uint32_t;
using ColumnID = uint32_t;

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
/// There are three kinds of operations that we need to support here:
///  O1) During completion, we receive a qualified table id and need to find out all scripts
///      that contain restrictions and transforms for it (later maybe join edges).
///  O2) When updating a catalog entry, we need to invalidate all catalog entries in the registry
///  O3) When updating a script, we need to remove the script entries in the restriction and transform maps.
///
/// Additional details that help us:
///  D1) We don't really care too much if the indexes get a little bit stale.
///      The worst that can happen is that we get a false-positive when looking up a table id. Then we see when
///      checking the script, that the referenced catalog version is outdated or the restriction does not exist.
///
/// Design:
///  X1) We're using btrees for restriction and transform indexes
///  X2) When deleting a catalog entry, we can just prefix-search the catalog entry id and remove everything at once.
///  X3) When updating a script, we do not remove all script refs right away.
///      Instead, we're doing that lazily during lookup. If we're seeing something that does not exist, we remove it.
//       This holds for the case where a referenced script no longer has a restriction/transform.
///      AND for the case where the referenced script got deleted!
///      Before accessing the referenced script, we always need to check if the script is still alive.
///
/// The only downside of this design is, that the script registry grows when:
///  P1) A user updates a script often
///  P2) With many different references to table columns
///  P3) That are rarely ever looked at again (since referencing would cleanup later)
///
/// We accept this for now since the effect should be irrelvant.
///
class ScriptRegistry {
   protected:
    /// A registered script with reference to a specifc analyzed script.
    /// (A script may be modified and re-analyzed. This shared pointer keeps the reference version alive)
    struct ScriptEntry {
        /// The script
        const Script& script;
        /// The analyzed script
        std::shared_ptr<AnalyzedScript> analyzed;
    };

    /// The script entries
    std::unordered_map<const Script*, ScriptEntry> script_entries;

    /// The scripts containing column restrictions
    btree::set<std::tuple<ContextObjectID, ColumnID, const Script*>> column_restrictions;
    /// The scripts containing column transforms
    btree::set<std::tuple<ContextObjectID, ColumnID, const Script*>> column_transforms;

   public:
    /// Clear the script registry
    void Clear();
    /// Creates a new script entry or updates an existing one if already registered
    buffers::status::StatusCode LoadScript(Script& script);
    /// Drop a script completely
    void DropScript(Script& script);

    /// Find table column restrictions.
    /// The parameter `min_version` stores the catalog version of this column ref.
    ///
    using IndexedColumnRestriction =
        std::tuple<std::reference_wrapper<const Script>, std::reference_wrapper<const AnalyzedScript>,
                   std::reference_wrapper<const AnalyzedScript::ColumnRestriction>>;
    std::vector<IndexedColumnRestriction> FindColumnRestrictions(ContextObjectID table, ColumnID column_id,
                                                                 CatalogVersion target_catalog_version);
    /// Find table column transforms
    using IndexedColumnTransform =
        std::tuple<std::reference_wrapper<const Script>, std::reference_wrapper<const AnalyzedScript>,
                   std::reference_wrapper<const AnalyzedScript::ColumnTransform>>;
    std::vector<IndexedColumnTransform> FindColumnTransforms(ContextObjectID table, ColumnID column_id,
                                                             CatalogVersion target_catalog_version);

    /// Find column refs and return the result as flatbuffer
    flatbuffers::Offset<buffers::registry::ScriptRegistryColumnInfo> FindColumnInfo(
        flatbuffers::FlatBufferBuilder& builder, ContextObjectID table, ColumnID column_id,
        CatalogVersion target_catalog_version);
};

}  // namespace dashql
