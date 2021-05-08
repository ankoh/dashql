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

TEST(JSONReaderTest, Missing) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({})JSON");
    JSONReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(JSONReaderTest, RowArray) {
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

TEST(JSONReaderTest, ColumnObject) {
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

}  // namespace
