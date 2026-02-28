#pragma once

#include <filesystem>
#include <string>

#include "dashql/script_registry.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct RegistrySnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const RegistrySnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The catalog scripts
    std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot> catalog_scripts;
    /// The registry scripts
    std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot> registry_scripts;

    using TableColumnKey = std::pair<ExternalObjectID, ColumnID>;

    /// Test a registry snapshot
    static void TestRegistrySnapshot(const std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot>& snaps,
                                     c4::yml::NodeRef registry_node, Catalog& catalog, ScriptRegistry& registry,
                                     std::vector<std::unique_ptr<Script>>& registry_scripts, size_t& entry_ids);
    /// Encode script templates to YAML
    static void EncodeScriptTemplates(c4::yml::NodeRef out, const ScriptRegistry::SnippetMap& snippets);
    /// Get the registry tests
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get the registry tests
    static std::vector<const RegistrySnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const RegistrySnapshotTest& p);

}  // namespace dashql::testing
