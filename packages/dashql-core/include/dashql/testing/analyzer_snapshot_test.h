#pragma once

#include <filesystem>
#include <string>

#include "dashql/external.h"
#include "dashql/script.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct AnalyzerSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const AnalyzerSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };
    /// A snapshot of a script analysis (expected data lives in tree at node_id)
    struct ScriptAnalysisSnapshot {
        /// The script input
        std::string input;
        /// Tree holding the snapshot file (not owned)
        c4::yml::Tree* tree = nullptr;
        /// Node id of this script node in the tree (expected sections = tree->ref(node_id)[key])
        c4::yml::id_type node_id = c4::yml::NONE;

        /// Read input from a YAML script node
        void ReadFrom(c4::yml::ConstNodeRef script_node);
    };

    /// The name
    std::string name;
    /// The main script
    ScriptAnalysisSnapshot script;
    /// The entries
    std::vector<ScriptAnalysisSnapshot> catalog_entries;

    /// Test catalog scripts and compare to expected
    static void TestCatalogSnapshot(const std::vector<ScriptAnalysisSnapshot>& snaps, c4::yml::NodeRef registry_node,
                                    Catalog& catalog, std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                    size_t& entry_ids);
    /// Test main script and compare to expected
    static void TestScriptSnapshot(const ScriptAnalysisSnapshot& snap, c4::yml::NodeRef node, Script& script,
                                   size_t entry_id, bool is_main);
    /// Encode a snippet to YAML
    static void EncodeSnippet(c4::yml::NodeRef parent, const AnalyzedScript& analyzed, size_t root_node_id);
    /// Encode a script to YAML
    static void EncodeScript(c4::yml::NodeRef out, const AnalyzedScript& script, bool is_main);
    /// Get the grammar tests
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const AnalyzerSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const AnalyzerSnapshotTest& p);

}  // namespace dashql::testing
