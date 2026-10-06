#include "dashql/catalog.h"
#include "dashql/script.h"
#include "dashql/testing/visualize_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "dashql/visualize/markdown.h"
#include "dashql/visualize/umap.h"
#include "dashql/visualize/vegalite.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

#include <string_view>

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
    bool is_umap = spec.renderer.has_value() && *spec.renderer == "umap";
    bool is_markdown = spec.renderer.has_value() && *spec.renderer == "markdown";
    bool is_table = spec.renderer.has_value() && *spec.renderer == "table";

    if (test->tree && test->node_id != c4::yml::NONE) {
        auto test_node = test->tree->ref(test->node_id);
        if (test_node.has_child("dashboard")) {
            c4::yml::Tree actual;
            auto root = actual.rootref();
            EncodeDashboardSpec(root, spec.dashboard);
            EXPECT_TRUE(MatchesContent(root, test_node["dashboard"]));
        }
    }

    if (test->name == "vis_layer_resolve") {
        EXPECT_EQ(spec.encoding_channels.size(), 1u);
        ASSERT_EQ(spec.layers.size(), 2u);
        EXPECT_EQ(spec.layers[0].encoding_channels.size(), 2u);
        EXPECT_EQ(spec.layers[1].encoding_channels.size(), 1u);
    }

    if (is_umap) {
        auto umap = visualize::CompileUmapSpec(spec, analyzed);
        ASSERT_NE(umap, nullptr);
        if (test->tree && test->node_id != c4::yml::NONE) {
            auto test_node = test->tree->ref(test->node_id);
            if (test_node.has_child("umap")) {
                c4::yml::Tree actual;
                auto root = actual.rootref();
                EncodeUmapSpec(root, *umap);
                EXPECT_TRUE(MatchesContent(root, test_node["umap"]));
            }
        }
        return;
    }

    if (is_markdown) {
        auto markdown = visualize::CompileMarkdownSpec(spec);
        ASSERT_NE(markdown, nullptr);
        if (test->tree && test->node_id != c4::yml::NONE) {
            auto test_node = test->tree->ref(test->node_id);
            if (test_node.has_child("markdown")) {
                c4::yml::Tree actual;
                auto root = actual.rootref();
                EncodeMarkdownSpec(root, *markdown);
                EXPECT_TRUE(MatchesContent(root, test_node["markdown"]));
            }
        }
        return;
    }

    if (is_table) return;

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

TEST(VisualizeTest, SelectSource) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
SELECT * FROM sales WHERE revenue > 0
VISUALIZE USING vegalite (mark => bar)
)SQL");
    script.Analyze();

    auto& analyzed = *script.analyzed_script;
    ASSERT_FALSE(analyzed.visualization_specs.IsEmpty());
    auto json = visualize::GenerateVegaLiteSpec(analyzed.visualization_specs[0], analyzed);
    EXPECT_NE(json.find("SELECT * FROM sales WHERE revenue > 0"), std::string::npos);
    EXPECT_EQ(json.find("visualize"), std::string::npos);
}

TEST(VisualizeTest, NormalizesDashboardLayoutWithWarnings) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
SELECT 1 AS value VISUALIZE USING vegalite (
    mark => bar,
    dashboard => (row => -1, column => 15, width => 20, height => 0)
)
)SQL");
    script.Parse();
    ASSERT_TRUE(script.parsed_script->errors.empty())
        << (script.parsed_script->errors.empty() ? "" : script.parsed_script->errors.front().message);
    script.Analyze();

    auto& analyzed = *script.analyzed_script;
    ASSERT_FALSE(analyzed.visualization_specs.IsEmpty());
    const auto& dashboard = analyzed.visualization_specs[0].dashboard;
    EXPECT_FALSE(dashboard.row.has_value());
    ASSERT_TRUE(dashboard.column.has_value());
    EXPECT_EQ(*dashboard.column, 0);
    EXPECT_EQ(dashboard.width, 12);
    EXPECT_EQ(dashboard.height, 1);
    ASSERT_EQ(analyzed.errors.size(), 4u);
    for (const auto& warning : analyzed.errors) {
        EXPECT_EQ(warning.error_type, buffers::analyzer::AnalyzerErrorType::INVALID_DASHBOARD_LAYOUT);
        EXPECT_EQ(warning.severity, buffers::analyzer::AnalyzerErrorSeverity::WARNING);
    }
}

TEST(VisualizeTest, RejectsDashboardInNestedVegaLayer) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
SELECT 1 AS value VISUALIZE USING vegalite (
    layer => [(mark => bar, dashboard => (width => 6))]
)
)SQL");
    script.Parse();

    ASSERT_NE(script.parsed_script, nullptr);
    EXPECT_FALSE(script.parsed_script->errors.empty());
}

TEST(VisualizeTest, PacksAnalyzedTableAndDashboardSpecs) {
    Catalog catalog;
    Script script{catalog};
    script.InsertTextAt(0, R"SQL(
SELECT 1 AS value VISUALIZE USING table (
    dashboard => (row => 2, column => 4, width => 8, height => 5)
)
)SQL");
    script.Analyze();

    flatbuffers::FlatBufferBuilder builder;
    builder.Finish(script.analyzed_script->Pack(builder));
    auto* packed = flatbuffers::GetRoot<buffers::analyzer::AnalyzedScript>(builder.GetBufferPointer());
    ASSERT_NE(packed->visualization_specs(), nullptr);
    ASSERT_EQ(packed->visualization_specs()->size(), 1u);
    const auto* visualization = packed->visualization_specs()->Get(0);
    ASSERT_NE(visualization->dashboard(), nullptr);
    ASSERT_NE(visualization->table_spec(), nullptr);
    ASSERT_TRUE(visualization->dashboard()->row().has_value());
    EXPECT_EQ(*visualization->dashboard()->row(), 2);
    ASSERT_TRUE(visualization->dashboard()->column().has_value());
    EXPECT_EQ(*visualization->dashboard()->column(), 4);
    EXPECT_EQ(visualization->dashboard()->width(), 8);
    EXPECT_EQ(visualization->dashboard()->height(), 5);
}

TEST(VisualizeTest, AcceptsDashboardForEveryRendererRoot) {
    for (const auto renderer_spec : {
             std::string_view{"vegalite (mark => bar, dashboard => (width => 7))"},
             std::string_view{"umap (vector => embedding, dashboard => (width => 7))"},
             std::string_view{"markdown (template => '{{value}}', dashboard => (width => 7))"},
             std::string_view{"table (dashboard => (width => 7))"},
         }) {
        Catalog catalog;
        Script script{catalog};
        script.InsertTextAt(0, std::string{"SELECT value, embedding VISUALIZE USING "} +
                                   std::string{renderer_spec});
        script.Analyze();

        ASSERT_NE(script.parsed_script, nullptr);
        ASSERT_TRUE(script.parsed_script->errors.empty())
            << (script.parsed_script->errors.empty() ? "" : script.parsed_script->errors.front().message);
        ASSERT_FALSE(script.analyzed_script->visualization_specs.IsEmpty());
        EXPECT_EQ(script.analyzed_script->visualization_specs[0].dashboard.width, 7);
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("basic.yaml")), VisualizeSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(VegaLite, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("vegalite.yaml")), VisualizeSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Umap, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("umap.yaml")), VisualizeSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Markdown, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("markdown.yaml")), VisualizeSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Table, VisualizeSnapshotTestSuite, ::testing::ValuesIn(VisualizeSnapshotTest::GetTests("table.yaml")), VisualizeSnapshotTest::TestPrinter());

}  // namespace
