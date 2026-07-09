#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "dashql/script_diff.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

struct DiffSnapshotTest {
    /// Printer for test name
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const DiffSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    /// The test name
    std::string name;
    /// The source (old) script text
    std::string source;
    /// The target (new) script text
    std::string target;
    /// Tree holding the snapshot file (not owned)
    c4::yml::Tree* tree = nullptr;
    /// Node id of this diff-snapshot entry (expected = tree->ref(node_id)["expected"])
    c4::yml::id_type node_id = c4::yml::NONE;

    /// Encode a diff op list into a YAML map (appends an "ops" sequence to `root`).
    /// `source_text` / `target_text` are the raw script texts (op spans are already resolved to text offsets).
    static void EncodeDiff(c4::yml::NodeRef root, const std::vector<ScriptDiff::DiffOp>& ops,
                           std::string_view source_text, std::string_view target_text);
    /// Load tests from a snapshot directory (reads .yaml files)
    static void LoadTests(const std::filesystem::path& snapshots_dir);
    /// Get tests for a given filename (e.g. "basic.yaml")
    static std::vector<const DiffSnapshotTest*> GetTests(std::string_view filename);
};

extern void operator<<(std::ostream& out, const DiffSnapshotTest& p);

}  // namespace dashql::testing
