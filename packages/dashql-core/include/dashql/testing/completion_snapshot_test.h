#pragma once

#include <filesystem>
#include <string>

#include "dashql/analyzer/completion.h"
#include "dashql/script.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct CompletionSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const CompletionSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The name
    std::string name;
    /// The catalog scripts
    std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot> catalog_scripts;
    /// The registry scripts
    std::vector<AnalyzerSnapshotTest::ScriptAnalysisSnapshot> registry_scripts;
    /// The editor script
    AnalyzerSnapshotTest::ScriptAnalysisSnapshot script;
    /// The search string for the cursor
    std::string cursor_search_string;
    /// The search index for the cursor
    size_t cursor_search_index;
    /// The completion limit
    size_t completion_limit;
    /// Expected completions: tree (not owned) and node id of completions node
    c4::yml::Tree* completions_tree = nullptr;
    c4::yml::id_type completions_node_id = c4::yml::NONE;

    /// Encode completion to YAML
    static void EncodeCompletion(c4::yml::NodeRef root, const Completion& completion);
    /// Get the grammar tests
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const CompletionSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const CompletionSnapshotTest& p);

}  // namespace dashql::testing
