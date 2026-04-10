#include "dashql/buffers/index_generated.h"
#include "dashql/testing/plan_view_model_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct SparkPlanSnapshotTestSuite : public ::testing::TestWithParam<const PlanViewModelSnapshotTest*> {};

TEST_P(SparkPlanSnapshotTestSuite, Test) {
    auto* test = GetParam();

    PlanViewModel view_model;
    view_model.ParseSparkPlan(test->input);  // throws on error

    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(64.0);
    config.mutate_node_height(32.0);
    config.mutate_node_margin_horizontal(20.0);
    config.mutate_node_padding_left(8.0);
    config.mutate_node_padding_right(8.0);
    config.mutate_icon_width(14.0);
    config.mutate_icon_margin_right(8.0);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(8.5);
    config.mutate_node_min_width(0);
    view_model.Configure(config);

    view_model.ComputeLayout();

    c4::yml::Tree tree;
    tree.reserve_arena(4 * 1024 * 1024);
    c4::yml::NodeRef root = tree.rootref();
    root |= c4::yml::MAP;
    PlanViewModelSnapshotTest::EncodePlanViewModel(root, view_model);

    auto have_ops = root["operators"];
    auto have_edges = root["operator-edges"];
    ASSERT_FALSE(have_ops.invalid());
    ASSERT_FALSE(have_edges.invalid());
    if (test->expected_operators_node_id != c4::yml::NONE &&
        test->expected_edges_node_id != c4::yml::NONE) {
        ASSERT_TRUE(Matches(have_ops, test->expected_operators_tree->ref(test->expected_operators_node_id)));
        ASSERT_TRUE(Matches(have_edges, test->expected_edges_tree->ref(test->expected_edges_node_id)));
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Handpicked, SparkPlanSnapshotTestSuite, ::testing::ValuesIn(PlanViewModelSnapshotTest::GetTests("spark", "handpicked.yaml")), PlanViewModelSnapshotTest::TestPrinter());
// clang-format on

}  // namespace
