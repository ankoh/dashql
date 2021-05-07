// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_analyzer.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

using namespace duckdb::web::json;

namespace {

struct membuf : std::streambuf {
    membuf(std::string_view data) {
        char* p(const_cast<char*>(data.data()));
        this->setg(p, p, p + data.size());
    }
};

struct imemstream : virtual membuf, std::istream {
    imemstream(std::string_view data) : membuf(data), std::istream(static_cast<std::streambuf*>(this)) {}
};

struct JSONAnalyzerTest {
    struct TestPrinter {
        std::string operator()(const ::testing::TestParamInfo<JSONAnalyzerTest>& info) const {
            return std::string{info.param.name};
        }
    };
    std::string_view name;
    std::string_view input;
    TableShape shape;
    std::string_view type;
};

struct JSONAnalyzerTestSuite : public testing::TestWithParam<JSONAnalyzerTest> {};

TEST_P(JSONAnalyzerTestSuite, InferTableType) {
    auto& test = GetParam();

    imemstream in{test.input};
    auto result = InferTableType(in);
    ASSERT_TRUE(result.ok()) << result.status().message();
    auto& [shape, type] = result.ValueUnsafe();

    ASSERT_EQ(shape, test.shape);
    if (shape == TableShape::UNRECOGNIZED) {
        ASSERT_EQ(test.type, nullptr);
        return;
    }
    ASSERT_NE(type, nullptr);
    ASSERT_EQ(type->ToString(), test.type);
}

// clang-format off
static std::vector<JSONAnalyzerTest> JSON_ANALYZER_TESTS = {
    {
        .name = "column_arrays_1",
        .input = R"JSON({
            "a": [1, -2, 3],
            "b": ["c", "d", "e"],
            "f": [true, true, false]
        })JSON",
        .shape = TableShape::COLUMN_ARRAYS,
        .type = "struct<a: int32, b: string, f: bool>"
    },
    {
        .name = "row_array_1",
        .input = R"JSON([
            {"a": 1, "b": "c", "f": true},
            {"a": -2, "b": "d", "f": true},
            {"a": 3, "b": "e", "f": false}
        ])JSON",
        .shape = TableShape::ROW_ARRAY,
        .type = "struct<a: int32, b: string, f: bool>"
    }
};
// clang-format on

INSTANTIATE_TEST_SUITE_P(JSONTest, JSONAnalyzerTestSuite, testing::ValuesIn(JSON_ANALYZER_TESTS),
                         JSONAnalyzerTest::TestPrinter());

}  // namespace
