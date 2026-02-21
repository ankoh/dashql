#include "dashql/formatter/formatter.h"
#include "dashql/parser/scanner.h"
#include "dashql/testing/formatter_snapshot_test.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct FormatterSnapshotTestSuite : public ::testing::TestWithParam<const FormatterSnapshotTest*> {};

TEST_P(FormatterSnapshotTestSuite, Test) {
    auto* test = GetParam();
    rope::Rope input{1024, test->input};
    auto [scanned, scannedStatus] = parser::Scanner::Scan(input, 0, 2);
    ASSERT_EQ(scannedStatus, buffers::status::StatusCode::OK);
    auto [parsed, parsedStatus] = parser::Parser::Parse(scanned);
    ASSERT_EQ(parsedStatus, buffers::status::StatusCode::OK);

    Formatter formatter{parsed};
    rope::Rope formatted = formatter.Format(test->config);
    std::string text = formatted.ToString();

    ASSERT_EQ(text, test->formatted);
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Simple, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("simple.xml")), FormatterSnapshotTest::TestPrinter());

} // namespace
