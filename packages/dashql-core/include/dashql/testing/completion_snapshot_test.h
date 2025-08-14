#pragma once

#include <filesystem>
#include <string>

#include "dashql/analyzer/completion.h"
#include "dashql/script.h"
#include "dashql/testing/analyzer_snapshot_test.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

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
    /// The catalog scriopts
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
    /// The completions
    pugi::xml_document completions;

    /// Encode a script
    static void EncodeCompletion(pugi::xml_node root, const Completion& completion);
    /// Get the grammar tests
    static void LoadTests(std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const CompletionSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const CompletionSnapshotTest& p);

}  // namespace dashql::testing
