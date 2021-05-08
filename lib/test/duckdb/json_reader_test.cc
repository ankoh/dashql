// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/json_reader.h"

#include <optional>

#include "duckdb/web/json_analyzer.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

using namespace duckdb::web::json;

namespace {

TEST(JSONReaderTest, NoFormat1) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({})JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(JSONReaderTest, NoFormat2) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "foo": "bar"
    })JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(JSONReaderTest, FormatRowArray) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "row-array"
    })JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, TableShape::ROW_ARRAY);
}

TEST(JSONReaderTest, FormatColumnObject) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "column-object"
    })JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, TableShape::COLUMN_OBJECT);
}

TEST(JSONReaderTest, FormatInvalidString) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "invalid"
    })JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

TEST(JSONReaderTest, FormatInvalidInt) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": 42 
    })JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

}  // namespace
