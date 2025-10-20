#include "dashql/buffers/index_generated.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"
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

    pugi::xml_document out;
    PlanViewModelSnapshotTest::EncodePlanViewModel(out, view_model);

    ASSERT_TRUE(Matches(out, test->expected));
}

// clang-format off

INSTANTIATE_TEST_SUITE_P(Handpicked, HyperPlanSnapshotTestSuite, ::testing::ValuesIn(PlanViewModelSnapshotTest::GetTests("hyper", "handpicked.xml")), PlanViewModelSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Tpch, HyperPlanSnapshotTestSuite, ::testing::ValuesIn(PlanViewModelSnapshotTest::GetTests("hyper", "tpch.xml")), PlanViewModelSnapshotTest::TestPrinter());

}
