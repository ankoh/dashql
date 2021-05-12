// Copyright (c) 2020 The DashQL Authors

#include <optional>

#include "duckdb/web/io/memory_filesystem.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_parser.h"
#include "duckdb/web/json_table_options.h"
#include "gtest/gtest.h"
#include "rapidjson/document.h"
#include "rapidjson/memorystream.h"
#include "rapidjson/reader.h"

using namespace duckdb::web;

namespace {

TEST(TableReaderOptions, NoFormat1) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({})JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(TableReaderOptions, NoFormat2) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "foo": "bar"
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_EQ(options.table_shape, std::nullopt);
}

TEST(TableReaderOptions, FormatRowArray) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "row-array"
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, json::TableShape::ROW_ARRAY);
}

TEST(TableReaderOptions, FormatColumnObject) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "column-object"
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    ASSERT_TRUE(options.ReadFrom(doc).ok());
    ASSERT_TRUE(options.table_shape.has_value());
    ASSERT_EQ(*options.table_shape, json::TableShape::COLUMN_OBJECT);
}

TEST(TableReaderOptions, FormatInvalidString) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "invalid"
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

TEST(TableReaderOptions, FormatInvalidInt) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": 42 
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_FALSE(status.ok());
}

TEST(TableReaderOptions, Fields) {
    rapidjson::Document doc;
    doc.Parse(R"JSON({
        "format": "row-array",
        "fields": [
            {"name": "foo", "type": "int32"},
            {"name": "bar", "type": "utf8"}
        ]
    })JSON");
    json::TableReaderOptions options;
    ASSERT_EQ(options.table_shape, std::nullopt);
    auto status = options.ReadFrom(doc);
    ASSERT_TRUE(status.ok());
    ASSERT_EQ(options.table_shape, json::TableShape::ROW_ARRAY);
    ASSERT_EQ(options.fields.size(), 2);
    ASSERT_EQ(options.fields[0]->name(), "foo");
    ASSERT_EQ(options.fields[1]->name(), "bar");
    ASSERT_EQ(options.fields[0]->type()->id(), arrow::Type::INT32);
    ASSERT_EQ(options.fields[1]->type()->id(), arrow::Type::STRING);
}

static std::shared_ptr<io::InputFileStreamBuffer> CreateStreamBuf(const char* path, std::vector<char> buffer) {
    auto fs = std::make_unique<io::MemoryFileSystem>();
    if (!fs->RegisterFileBuffer(path, std::move(buffer)).ok()) return nullptr;
    auto filesystem_buffer = std::make_shared<io::FileSystemBuffer>(std::move(fs));
    return std::make_shared<io::InputFileStreamBuffer>(filesystem_buffer, path);
}

TEST(TableReader, RowObjectDetect1) {
    const char* path = "foo.json";
    constexpr std::string_view raw_input = R"([
        {"foo": 1},
        {"foo": 4}
    ])";
    std::vector<char> input_buffer{raw_input.data(), raw_input.data() + raw_input.size()};

    json::TableType type = {
        .shape = json::TableShape::ROW_ARRAY,
        .type = arrow::struct_({
            arrow::field("foo", arrow::int32()),
        }),
    };

    auto fs = std::make_shared<io::MemoryFileSystem>();
    auto fs_buffer = std::make_shared<io::FileSystemBuffer>(fs);
    ASSERT_TRUE(fs->RegisterFileBuffer(path, std::move(input_buffer)).ok());

    auto in = std::make_unique<io::InputFileStream>(fs_buffer, path);
    auto maybe_reader = json::TableReader::Resolve(std::move(in), std::move(type));
    ASSERT_TRUE(maybe_reader.ok());

    auto reader = std::move(maybe_reader.ValueUnsafe());
    ASSERT_TRUE(reader->Prepare().ok());
}

}  // namespace
