// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/io/memory_filesystem.h"
#include "duckdb/web/webdb.h"
#include "gtest/gtest.h"

using namespace duckdb::web;

namespace {

struct CSVImportTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<CSVImportTest>& info) const {
            return std::string{info.param.name};
        }
    };
    std::string_view name;
    std::string_view input;
    std::string_view options;
    std::string_view query;
    std::string expected_output;
};

struct CSVImportTestSuite : public testing::TestWithParam<CSVImportTest> {};

TEST_P(CSVImportTestSuite, TestImport) {
    constexpr const char* path = "TEST";

    auto& test = GetParam();
    std::vector<char> input_buffer{test.input.data(), test.input.data() + test.input.size()};
    auto memory_filesystem = std::make_unique<io::MemoryFileSystem>();
    ASSERT_TRUE(memory_filesystem->RegisterFileBuffer(path, std::move(input_buffer)).ok());

    auto db = std::make_shared<WebDB>(std::move(memory_filesystem));
    WebDB::Connection conn{*db};
    auto maybe_ok = conn.ImportCSVTable(path, test.options);
    ASSERT_TRUE(maybe_ok.ok()) << maybe_ok.message();

    auto result = conn.connection().Query(std::string{test.query});
    ASSERT_STREQ(result->ToString().c_str(), std::string{test.expected_output}.c_str());
}

// clang-format off
static std::vector<CSVImportTest> CSV_IMPORT_TEST = {
    {
        .name = "integers",
        .input = R"CSV("a","b","c"
1,2,3
4,5,6
7,8,9)CSV",
        .options = R"JSON({
            "schema": "main",
            "name": "foo"
        })JSON",
        .query = "SELECT * FROM main.foo",
        .expected_output = 
R"TXT(a	b	c	
INTEGER	INTEGER	INTEGER	
[ Rows: 3]
1	2	3	
4	5	6	
7	8	9	

)TXT"
    },
};
// clang-format on

INSTANTIATE_TEST_SUITE_P(CSVImportTest, CSVImportTestSuite, testing::ValuesIn(CSV_IMPORT_TEST),
                         CSVImportTest::TestPrinter());

}  // namespace