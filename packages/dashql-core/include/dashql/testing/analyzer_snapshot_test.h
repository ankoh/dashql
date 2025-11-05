#pragma once

#include <filesystem>
#include <string>

#include "dashql/external.h"
#include "dashql/script.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql::testing {

struct AnalyzerSnapshotTest {
    /// Printer test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const AnalyzerSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };
    /// A snapshot of a script analysis
    struct ScriptAnalysisSnapshot {
        /// The origin id
        CatalogEntryID external_id;
        /// The script
        std::string input;
        /// The errors
        pugi::xml_document errors;
        /// The tables
        pugi::xml_document tables;
        /// The table references
        pugi::xml_document table_references;
        /// The expressions
        pugi::xml_document expressions;
        /// The constants
        pugi::xml_document constant_expressions;
        /// The column computations
        pugi::xml_document column_computations;
        /// The column restrictions
        pugi::xml_document column_resrictions;

        /// Read from an xml node
        void ReadFrom(const pugi::xml_node& script_node);
    };

    /// The name
    std::string name;
    /// The main script
    ScriptAnalysisSnapshot script;
    /// The entries
    std::vector<ScriptAnalysisSnapshot> catalog_entries;

    /// Read a registry
    static void TestCatalogSnapshot(const std::vector<ScriptAnalysisSnapshot>& snaps, pugi::xml_node& registry_node,
                                    Catalog& catalog, std::vector<std::unique_ptr<Script>>& catalog_scripts,
                                    size_t& entry_ids);
    /// Read a registry
    static void TestScriptSnapshot(const ScriptAnalysisSnapshot& snap, pugi::xml_node& node, Script& script,
                                   size_t entry_id, bool is_main);
    /// Encode a snippet
    static void EncodeSnippet(pugi::xml_node parent, const AnalyzedScript& analyzed, size_t root_node_id);
    /// Encode a script
    static void EncodeScript(pugi::xml_node out, const AnalyzedScript& script, bool is_main);
    /// Get the grammar tests
    static void LoadTests(const std::filesystem::path& project_root);
    /// Get the grammar tests
    static std::vector<const AnalyzerSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const AnalyzerSnapshotTest& p);

}  // namespace dashql::testing
