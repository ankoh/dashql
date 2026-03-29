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
    auto scanned = parser::Scanner::Scan(input, 0, 2);
    auto parsed = parser::Parser::Parse(scanned);

    Formatter formatter{parsed};
    for (const auto& dialect_exp : test->dialects) {
        if (dialect_exp.skip) continue;
        for (size_t i = 0; i < dialect_exp.expectations.size(); ++i) {
            const auto& exp = dialect_exp.expectations[i];
            std::string formatted = formatter.Format(exp.config);
            ASSERT_NE(formatted, "") << "Dialect " << dialect_exp.dialect << " expectation " << i
                                     << " (mode=" << FormattingModeToString(exp.config.mode)
                                     << " indent=" << exp.config.indentation_width << "): output must not be empty";
            ASSERT_EQ(formatted, exp.formatted) << "Dialect " << dialect_exp.dialect << " expectation " << i
                                                << " (mode=" << FormattingModeToString(exp.config.mode)
                                                << " indent=" << exp.config.indentation_width << ")";
        }
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Simple, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("simple.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bugs, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("bugs.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Precedences, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("precedences.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TableRef, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("tableref.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ColumnRef, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("columnref.yaml")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Expressions, FormatterSnapshotTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTests("expressions.yaml")), FormatterSnapshotTest::TestPrinter());

} // namespace
