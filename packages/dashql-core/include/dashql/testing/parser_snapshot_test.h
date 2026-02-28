#pragma once

#include <filesystem>
#include <string>

#include "dashql/script.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct ParserSnapshotTest {
    /// Printer for test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const ParserSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    std::string name;
    std::string input;
    bool debug = false;
    /// Tree holding the snapshot file (not owned)
    c4::yml::Tree* tree = nullptr;
    /// Node id of this parser-snapshot entry (expected = tree->ref(node_id)["expected"])
    c4::yml::id_type node_id = c4::yml::NONE;

    /// Encode AST nodes into a YAML parent (adds "nodes" sequence with node maps)
    static void EncodeAST(c4::yml::NodeRef parent, std::string_view text, std::span<const buffers::parser::Node> ast,
                          size_t root_node_id);
    /// Encode script result into a YAML map (statements, scanner-errors, parser-errors, line-breaks, comments)
    static void EncodeScript(c4::yml::NodeRef root, const ScannedScript& scanned, const ParsedScript& parsed,
                             std::string_view text);
    /// Load tests from snapshot directory (reads .yaml files)
    static void LoadTests(const std::filesystem::path& snapshots_dir);
    /// Get tests for a given filename (e.g. "simple.yaml")
    static std::vector<const ParserSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const ParserSnapshotTest& p);

}  // namespace dashql::testing
