#include "dashql/formatter/formatter.h"
#include "dashql/parser/scanner.h"
#include "dashql/testing/formatter_snapshot_test.h"
#include "gtest/gtest.h"

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
    for (size_t i = 0; i < test->expectations.size(); ++i) {
        const auto& exp = test->expectations[i];
        std::string formatted = formatter.Format(exp.config);
        ASSERT_NE(formatted, "") << "Expectation " << i << " (mode=" << FormattingModeToString(exp.config.mode)
                                 << " indent=" << exp.config.indentation_width << "): output must not be empty";
        ASSERT_EQ(formatted, exp.formatted)
            << "Expectation " << i << " (mode=" << FormattingModeToString(exp.config.mode)
            << " indent=" << exp.config.indentation_width << ")";
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Simple, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("simple.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bugs, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("bugs.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Precedences, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("precedences.yaml")), FormatterSnapshotTest::TestPrinter());

} // namespace
