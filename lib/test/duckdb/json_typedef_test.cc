// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_typedef.h"

#include <optional>

#include "duckdb/web/json_analyzer.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

using namespace duckdb::web::json;

namespace {

struct JSONTypedefTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<JSONTypedefTest>& info) const {
            return std::string{info.param.name};
        }
    };
    std::string_view name;
    std::string_view input;
    std::string_view expected;
};

struct JSONTypedefTestSuite : public testing::TestWithParam<JSONTypedefTest> {};

TEST_P(JSONTypedefTestSuite, ReadFields) {
    auto& test = GetParam();

    rapidjson::Document doc;
    doc.Parse(std::string{test.input.data()});
    ASSERT_FALSE(doc.HasParseError()) << doc.GetParseError() << std::endl;
    ASSERT_TRUE(doc.IsArray());

    auto array = ((const rapidjson::Document&)(doc)).GetArray();
    auto fields = ReadFields(array);
    ASSERT_TRUE(fields.ok()) << fields.status().message();

    auto have = arrow::struct_(std::move(fields.ValueUnsafe()));
    ASSERT_EQ(std::string{test.expected}, std::string{have->ToString()});
}

// clang-format off
static std::vector<JSONTypedefTest> JSON_TYPEDEF_TESTS = {
    {
        .name = "integer",
        .input = R"JSON([
            {
                "name": "foo",
                "type": "int64"
            }
        ])JSON",
        .expected = "struct<foo: int64>",
    }
};
// clang-format on

INSTANTIATE_TEST_SUITE_P(JSONTypedefTest, JSONTypedefTestSuite, testing::ValuesIn(JSON_TYPEDEF_TESTS),
                         JSONTypedefTest::TestPrinter());

}  // namespace
