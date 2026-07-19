#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/testing/visualize_snapshot_test.h"
#include "dashql/visualize/vegalite.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct VisualizeSnapshotTestSuite : public ::testing::TestWithParam<const VisualizeSnapshotTest*> {};

TEST_P(VisualizeSnapshotTestSuite, Test) {
    auto* test = GetParam();

    Catalog catalog;
    if (!test->catalog_input.empty()) {
        Script catalog_script{catalog};
        catalog_script.InsertTextAt(0, test->catalog_input);
        catalog_script.Scan();
        catalog_script.Parse();
        catalog_script.Analyze();
        catalog.LoadScript(catalog_script, catalog_script.GetCatalogEntryId());
    }

    Script main_script{catalog};
    main_script.InsertTextAt(0, test->script_input);
    main_script.Scan();
    main_script.Parse();
    main_script.Analyze();

    auto& analyzed = *main_script.analyzed_script;
    ASSERT_FALSE(analyzed.visualization_specs.IsEmpty());

    auto& spec = analyzed.visualization_specs[0];
    bool is_embeddingatlas = spec.renderer.has_value() && *spec.renderer == "embeddingatlas";

    if (is_embeddingatlas) {
        std::string ea_json = visualize::GenerateEmbeddingAtlasSpec(spec, analyzed);
        ASSERT_FALSE(ea_json.empty());
        if (test->tree && test->node_id != c4::yml::NONE) {
            auto test_node = test->tree->ref(test->node_id);
            if (test_node.has_child("embeddingatlas")) {
                c4::csubstr expected_v = test_node["embeddingatlas"].val();
                std::string expected_json =
                    expected_v.str ? std::string(expected_v.str, expected_v.len) : std::string();
                while (!expected_json.empty() && expected_json.back() == '\n') expected_json.pop_back();
                EXPECT_EQ(ea_json, expected_json);
            }
        }
        return;
    }

    std::string vegalite_json = visualize::GenerateVegaLiteSpec(spec, analyzed);
    std::string roundtrip = visualize::ParseVegaLiteToVisualize(vegalite_json);

    ASSERT_FALSE(vegalite_json.empty());
    ASSERT_FALSE(roundtrip.empty());

    if (test->tree && test->node_id != c4::yml::NONE) {
        auto test_node = test->tree->ref(test->node_id);
        if (test_node.has_child("vegalite")) {
            c4::csubstr expected_v = test_node["vegalite"].val();
            std::string expected_json = expected_v.str ? std::string(expected_v.str, expected_v.len) : std::string();
            while (!expected_json.empty() && expected_json.back() == '\n') expected_json.pop_back();
            EXPECT_EQ(vegalite_json, expected_json);
        }
        if (test_node.has_child("roundtrip")) {
            c4::csubstr expected_r = test_node["roundtrip"].val();
            std::string expected_rt = expected_r.str ? std::string(expected_r.str, expected_r.len) : std::string();
            while (!expected_rt.empty() && expected_rt.back() == '\n') expected_rt.pop_back();
            EXPECT_EQ(roundtrip, expected_rt);
        }
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("basic.yaml")), VisualizeSnapshotTest::TestPrinter());

}  // namespace
