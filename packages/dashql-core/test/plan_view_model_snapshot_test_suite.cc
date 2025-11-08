#include "dashql/buffers/index_generated.h"
#include "dashql/testing/plan_view_model_snapshot_test.h"
#include "dashql/testing/xml_tests.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct HyperPlanSnapshotTestSuite : public ::testing::TestWithParam<const PlanViewModelSnapshotTest*> {};

TEST_P(HyperPlanSnapshotTestSuite, Test) {
    auto* test = GetParam();

    // Parse a Hyper team
    PlanViewModel view_model;
    auto status = view_model.ParseHyperPlan(test->input);
    ASSERT_EQ(status, buffers::status::StatusCode::OK);

    // Configure the plan layout
    buffers::view::PlanLayoutConfig config;
    config.mutate_level_height(20.0);
    config.mutate_node_height(8.0);
    config.mutate_padding_left(2.0);
    config.mutate_padding_right(2.0);
    config.mutate_max_label_chars(20);
    config.mutate_width_per_label_char(2.0);
    config.mutate_min_node_width(8);
    view_model.Configure(config);

    // Compute the plan layout
    view_model.ComputeLayout();

    pugi::xml_document out;
    PlanViewModelSnapshotTest::EncodePlanViewModel(out, view_model);

    auto ops = out.child("operators");
    auto edges = out.child("edges");
    ASSERT_TRUE(Matches(ops, test->expected_operators));
    ASSERT_TRUE(Matches(edges, test->expected_edges));
}

// clang-format off

INSTANTIATE_TEST_SUITE_P(Handpicked, HyperPlanSnapshotTestSuite, ::testing::ValuesIn(PlanViewModelSnapshotTest::GetTests("hyper", "handpicked.xml")), PlanViewModelSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Tpch, HyperPlanSnapshotTestSuite, ::testing::ValuesIn(PlanViewModelSnapshotTest::GetTests("hyper", "tpch.xml")), PlanViewModelSnapshotTest::TestPrinter());

}
