#include "dashql/testing/agent_snapshot_test.h"

#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"

using namespace dashql::testing;

namespace {

struct AgentSnapshotTestSuite : public ::testing::TestWithParam<const AgentSnapshotTest*> {};

TEST_P(AgentSnapshotTestSuite, Test) {
    auto* test = GetParam();
    c4::yml::Tree tree;
    auto root = tree.rootref();
    root |= c4::yml::MAP;
    AgentSnapshotTest::EncodeExpected(root, *test);
    ASSERT_TRUE(MatchesContent(root, test->tree->ref(test->node_id)["expected"]));
}

TEST(AgentSnapshotDiscovery, LoadsBasicSnapshots) {
    EXPECT_FALSE(AgentSnapshotTest::GetTests("basic.yaml").empty());
}

INSTANTIATE_TEST_SUITE_P(Basic, AgentSnapshotTestSuite,
                         ::testing::ValuesIn(AgentSnapshotTest::GetTests("basic.yaml")),
                         AgentSnapshotTest::TestPrinter());

}  // namespace
