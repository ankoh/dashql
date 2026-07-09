#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"
#include "dashql/script_diff.h"
#include "dashql/testing/diff_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct DiffSnapshotTestSuite : public ::testing::TestWithParam<const DiffSnapshotTest*> {};

TEST_P(DiffSnapshotTestSuite, Test) {
    auto* test = GetParam();

    rope::Rope source_rope{1024, test->source};
    auto source_scanned = parser::Scanner::Scan(source_rope, 0, 1);
    auto source_parsed = parser::Parser::Parse(source_scanned);

    rope::Rope target_rope{1024, test->target};
    auto target_scanned = parser::Scanner::Scan(target_rope, 0, 2);
    auto target_parsed = parser::Parser::Parse(target_scanned);

    ScriptDiff diff{*source_parsed, *target_parsed};
    auto& ops = diff.Compute();

    c4::yml::Tree out_tree;
    auto out_root = out_tree.rootref();
    out_root.set_type(c4::yml::MAP);
    DiffSnapshotTest::EncodeDiff(out_root, ops, test->source, test->target);

    auto expected_node = test->tree->ref(test->node_id)["expected"];
    ASSERT_TRUE(MatchesContent(out_tree.rootref(), expected_node));
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Basic, DiffSnapshotTestSuite, ::testing::ValuesIn(DiffSnapshotTest::GetTests("basic.yaml")), DiffSnapshotTest::TestPrinter());
// clang-format on

}  // namespace
