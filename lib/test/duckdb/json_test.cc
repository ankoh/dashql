// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_analyzer.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

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

}  // namespace

TEST(JSONTest, ColumnArrays1) {
    std::string_view input_view{R"JSON({
        "a": [1, -2, 3],
        "b": ["c", "d", "e"],
        "f": [true, true, false]
    })JSON"};
    imemstream in{input_view};

    auto result = duckdb::web::json::InferTableType(in);
    ASSERT_TRUE(result.ok()) << result.status().message();
    auto& [shape, type] = result.ValueUnsafe();

    ASSERT_EQ(shape, duckdb::web::json::TableShape::COLUMN_ARRAYS);
}

TEST(JSONTest, RowArray1) {
    std::string_view input_view{R"JSON([
        {"a": 1, "b": "c", "f": true},
        {"a": -2, "b": "d", "f": true},
        {"a": 3, "b": "e", "f": false}
    ])JSON"};
    imemstream in{input_view};

    auto result = duckdb::web::json::InferTableType(in);
    ASSERT_TRUE(result.ok()) << result.status().message();
    auto& [shape, type] = result.ValueUnsafe();

    ASSERT_EQ(shape, duckdb::web::json::TableShape::ROW_ARRAY);
}
