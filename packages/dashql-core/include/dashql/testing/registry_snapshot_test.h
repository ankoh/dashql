#pragma once

#include <filesystem>
#include <string>

#include "dashql/script_registry.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql::testing {

struct RegistrySnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const RegistrySnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };
    struct CatalogScript {
        /// The origin id
        CatalogEntryID external_id;
        /// The script
        std::string input;
    };

    /// The name
    std::string name;
    /// The catalog scripts
    std::optional<CatalogScript> catalog_script;
    /// The registry scripts
    std::vector<std::string> registry_scripts;

    /// The expected registry node
    pugi::xml_document expected;

    using TableColumnKey = std::pair<ContextObjectID, ColumnID>;

    /// Test a registry snapshot
    static void TestRegistrySnapshot(const std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot>& snaps,
                                     pugi::xml_node& registry_node, Catalog& catalog, ScriptRegistry& registry,
                                     std::vector<std::unique_ptr<Script>>& registry_scripts, size_t& entry_ids);
    /// Encode script templates
    static void EncodeScriptTemplates(pugi::xml_node out, const ScriptRegistry::SnippetMap& snippets);
    /// Encode a script
    static void EncodeRegistry(pugi::xml_node out, ScriptRegistry& registry);
    /// Get the registry tests
    static void LoadTests(std::filesystem::path& project_root);
    /// Get the registry tests
    static std::vector<const RegistrySnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const RegistrySnapshotTest& p);

}  // namespace dashql::testing
