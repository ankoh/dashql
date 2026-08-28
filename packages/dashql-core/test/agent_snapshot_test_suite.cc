#include "dashql/testing/agent_snapshot_test.h"

#include <stdexcept>
#include <utility>

#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"

using namespace dashql::testing;

namespace {

struct AgentSnapshotTestSuite : public ::testing::TestWithParam<const AgentSnapshotTest*> {};

AgentSnapshotTest MakeFixture(std::vector<AgentSnapshotEvent> events) {
    AgentSnapshotTest test;
    test.name = "invalid_fixture";
    test.prompt = "Write a query.";
    test.intent = dashql::buffers::agent::AgentIntent::SQL;
    test.events = std::move(events);
    return test;
}

void EncodeFixture(const AgentSnapshotTest& test) {
    c4::yml::Tree tree;
    auto root = tree.rootref();
    root |= c4::yml::MAP;
    AgentSnapshotTest::EncodeExpected(root, test);
}

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

TEST(AgentSnapshotFixtureValidation, RejectsMismatchedEvent) {
    auto test = MakeFixture({AgentSnapshotEvent{.type = AgentSnapshotEvent::Type::kCompleteModel, .value = "select 1"}});
    EXPECT_THROW(EncodeFixture(test), std::runtime_error);
}

TEST(AgentSnapshotFixtureValidation, RejectsMissingEvent) {
    auto test = MakeFixture({});
    EXPECT_THROW(EncodeFixture(test), std::runtime_error);
}

TEST(AgentSnapshotFixtureValidation, RejectsEventAfterTerminalOperation) {
    auto test = MakeFixture({
        AgentSnapshotEvent{.type = AgentSnapshotEvent::Type::kCompleteContext},
        AgentSnapshotEvent{.type = AgentSnapshotEvent::Type::kCompleteModel, .value = "select 1"},
        AgentSnapshotEvent{.type = AgentSnapshotEvent::Type::kCompleteApply},
        AgentSnapshotEvent{.type = AgentSnapshotEvent::Type::kCompleteApply},
    });
    EXPECT_THROW(EncodeFixture(test), std::runtime_error);
}

TEST(AgentSnapshotFixtureValidation, RejectsUnknownEventType) {
    auto tree = c4::yml::parse_in_arena("name: invalid_fixture\ninput:\n  prompt: Write a query.\nevents:\n  - type: typo\n");
    EXPECT_THROW(AgentSnapshotTest::Parse(tree.rootref()), std::invalid_argument);
}

INSTANTIATE_TEST_SUITE_P(Basic, AgentSnapshotTestSuite,
                         ::testing::ValuesIn(AgentSnapshotTest::GetTests("basic.yaml")),
                         AgentSnapshotTest::TestPrinter());

}  // namespace
