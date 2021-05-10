// Copyright (c) 2020 The DashQL Authors

#include <optional>

#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_reader.h"
#include "duckdb/web/json_table_options.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

using namespace duckdb::web::json;

namespace {

TEST(TableReaderOptionsTest, NoFormat1) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({})JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(TableReaderOptionsTest, NoFormat2) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "foo": "bar"
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(TableReaderOptionsTest, FormatRowArray) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "row-array"
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, TableShape::ROW_ARRAY);
}

TEST(TableReaderOptionsTest, FormatColumnObject) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "column-object"
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, TableShape::COLUMN_OBJECT);
}

TEST(TableReaderOptionsTest, FormatInvalidString) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "invalid"
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

TEST(TableReaderOptionsTest, FormatInvalidInt) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": 42 
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

TEST(TableReaderOptionsTest, Fields) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "row-array",
        "fields": [
            {"name": "foo", "type": "int32"},
            {"name": "bar", "type": "utf8"}
        ]
    })JSON");
    TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok());
    ASSERT_EQ(options.table_shape, TableShape::ROW_ARRAY);
    ASSERT_EQ(options.fields.size(), 2);
    ASSERT_EQ(options.fields[0]->name(), "foo");
    ASSERT_EQ(options.fields[1]->name(), "bar");
    ASSERT_EQ(options.fields[0]->type()->id(), arrow::Type::INT32);
    ASSERT_EQ(options.fields[1]->type()->id(), arrow::Type::STRING);
}

}  // namespace
