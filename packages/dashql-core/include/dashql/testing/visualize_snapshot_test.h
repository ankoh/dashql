#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "gtest/gtest.h"
#include "dashql/visualize/markdown.h"
#include "dashql/visualize/umap.h"
#include "dashql/analyzer/analyzer_types.h"
#include "ryml.hpp"

namespace dashql::testing {

struct VisualizeSnapshotTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<const VisualizeSnapshotTest*>& info) const {
            return std::string{info.param->name};
        }
    };

    std::string name;
    std::string catalog_input;
    std::string script_input;

    c4::yml::Tree* tree = nullptr;
    c4::yml::id_type node_id = c4::yml::NONE;

    static void LoadTests(const std::filesystem::path& snapshots_dir);
    static std::vector<const VisualizeSnapshotTest*> GetTests(std::string_view filename);
};

/// Encode the generated Markdown object model as a native YAML subtree.
void EncodeMarkdownSpec(c4::yml::NodeRef out, const visualize::MarkdownDocument& spec);
void EncodeUmapSpec(c4::yml::NodeRef out, const visualize::UmapDocument& spec);
void EncodeDashboardSpec(c4::yml::NodeRef out, const DashboardSpec& spec);

extern void operator<<(std::ostream& out, const VisualizeSnapshotTest& p);

}  // namespace dashql::testing
