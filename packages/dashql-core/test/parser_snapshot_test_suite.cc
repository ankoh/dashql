#include "gtest/gtest.h"
#include "pugixml.hpp"
#include "dashql/parser/parser.h"
#include "dashql/parser/scanner.h"
#include "dashql/testing/parser_snapshot_test.h"
#include "dashql/testing/xml_tests.h"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct ParserSnapshotTestSuite : public ::testing::TestWithParam<const ParserSnapshotTest*> {};

TEST_P(ParserSnapshotTestSuite, Test) {
    auto* test = GetParam();
    rope::Rope input{1024, test->input};
    auto [scanned, scannedStatus] = parser::Scanner::Scan(input, 2);
    ASSERT_EQ(scannedStatus, buffers::status::StatusCode::OK);
    auto [parsed, parsedStatus] = parser::Parser::Parse(scanned, test->debug);
    ASSERT_EQ(parsedStatus, buffers::status::StatusCode::OK);

    pugi::xml_document out;
    ParserSnapshotTest::EncodeScript(out, *scanned, *parsed, test->input);

    ASSERT_TRUE(Matches(out, test->expected));
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Bugs, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("bugs.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Regression, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("regression.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Dots, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("dots.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Set, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("ext_set.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ErrorReporting, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("error_reporting.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Create, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_create.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Select, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_select.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(View, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("sql_view.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(SSB, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("ssb.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCDS, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("tpcds.xml")), ParserSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TPCH, ParserSnapshotTestSuite, ::testing::ValuesIn(ParserSnapshotTest::GetTests("tpch.xml")), ParserSnapshotTest::TestPrinter());

} // namespace
