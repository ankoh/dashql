#include "dashql/formatter/formatter.h"
#include "dashql/parser/scanner.h"
#include "dashql/testing/formatter_snapshot_test.h"
#include "duckdb.hpp"
#include "gtest/gtest.h"

using namespace dashql;
using namespace dashql::testing;

namespace {

struct FormatterValidationDuckDBTestSuite : public ::testing::TestWithParam<const FormatterSnapshotTest*> {};

TEST_P(FormatterValidationDuckDBTestSuite, Test) {
    auto* test = GetParam();
    rope::Rope input{1024, test->input};
    auto scanned = parser::Scanner::Scan(input, 0, 2);
    auto parsed = parser::Parser::Parse(scanned);

    Formatter formatter{parsed};
    for (const auto& dialect_exp : test->dialects) {
        if (dialect_exp.skip) continue;
        if (dialect_exp.dialect != "duckdb" || !dialect_exp.validation.has_value()) continue;

        duckdb::DuckDB db(nullptr);
        duckdb::Connection con(db);

        const auto& validation = *dialect_exp.validation;
        if (!validation.setup.empty()) {
            auto setup_result = con.Query(validation.setup);
            ASSERT_FALSE(setup_result->HasError())
                << "Dialect " << dialect_exp.dialect << ": setup failed: " << setup_result->GetError();
        }

        for (size_t i = 0; i < dialect_exp.expectations.size(); ++i) {
            const auto& exp = dialect_exp.expectations[i];
            std::string formatted = formatter.Format(exp.config);
            ASSERT_NE(formatted, "") << "Dialect " << dialect_exp.dialect << " expectation " << i
                                     << " (mode=" << FormattingModeToString(exp.config.mode)
                                     << "): output must not be empty";
            ASSERT_EQ(formatted, exp.formatted) << "Dialect " << dialect_exp.dialect << " expectation " << i
                                                << " (mode=" << FormattingModeToString(exp.config.mode) << ")";
            auto exec_result = con.Query(formatted);
            ASSERT_FALSE(exec_result->HasError()) << "Dialect " << dialect_exp.dialect << " expectation " << i
                                                  << " (mode=" << FormattingModeToString(exp.config.mode)
                                                  << "): DuckDB execution failed: " << exec_result->GetError();
        }
    }
}

// clang-format off
INSTANTIATE_TEST_SUITE_P(Simple, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("simple.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Bugs, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("bugs.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Precedences, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("precedences.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(TableRef, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("tableref.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(ColumnRef, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("columnref.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());
INSTANTIATE_TEST_SUITE_P(Expressions, FormatterValidationDuckDBTestSuite, ::testing::ValuesIn(FormatterSnapshotTest::GetTestsWithValidation("expressions.yaml", "duckdb")), FormatterSnapshotTest::TestPrinter());

} // namespace
