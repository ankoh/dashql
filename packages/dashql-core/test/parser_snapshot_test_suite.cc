#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/yaml_tests.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct ParserSnapshotTestSuite : public ::testing::TestWithParam<const ParserSnapshotTest*> {};

TEST_P(ParserSnapshotTestSuite, Test) {
    auto* test = GetParam();
    rope::Rope input{1024, test->input};
    auto [scanned, scannedStatus] = parser::Scanner::Scan(input, 0, 2);
    ASSERT_EQ(scannedStatus, buffers::status::StatusCode::OK);
    auto [parsed, parsedStatus] = parser::Parser::Parse(scanned, test->debug);
    ASSERT_EQ(parsedStatus, buffers::status::StatusCode::OK);

    c4::yml::Tree out_tree;
    auto out_root = out_tree.rootref();
    out_root.set_type(c4::yml::MAP);
    ParserSnapshotTest::EncodeScript(out_root, *scanned, *parsed, test->input);

    auto expected_node = test->tree->ref(test->node_id)["expected"];
    ASSERT_TRUE(MatchesContent(out_tree.rootref(), expected_node));
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Simple, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("simple.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bugs, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("bugs.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Regression, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("regression.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Dots, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("dots.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Set, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("ext_set.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ErrorReporting, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("error_reporting.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Create, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_create.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Select, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_select.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(View, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_view.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SSB, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("ssb.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCDS, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("tpcds.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("tpch.yaml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Trino, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("trino.yaml")), ParserSnapshotTest::TestPrinter());

}  // namespace
