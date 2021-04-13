// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/arrow_ifstream.h"

#include <sstream>

#include "arrow/csv/api.h"
#include "arrow/json/api.h"
#include "arrow/table.h"
#include "dashql/test/config.h"
#include "duckdb/common/file_system.hpp"
#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(ArrowInputFileStream, LoadJSON) {
    SeekableFileSystem fs;
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.json";
    auto pathStr = path.string();

    auto input = std::make_shared<InputFileStream>(fs, pathStr.c_str());

    arrow::MemoryPool* pool = arrow::default_memory_pool();

    auto read_options = arrow::json::ReadOptions::Defaults();
    auto parse_options = arrow::json::ParseOptions::Defaults();

    auto res_reader = arrow::json::TableReader::Make(pool, input, read_options, parse_options);
    ASSERT_TRUE(res_reader.ok()) << res_reader.status().message();
    auto reader = res_reader.ValueUnsafe();

    auto res_read = reader->Read();
    ASSERT_TRUE(res_read.ok());
    auto table = res_read.ValueUnsafe();
    std::vector<std::string> colNames{"a", "b", "c", "d"};
    ASSERT_EQ(table->ColumnNames(), colNames);
    ASSERT_EQ(table->num_rows(), 2);
}

TEST(ArrowInputFileStream, LoadCSV) {
    SeekableFileSystem fs;
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.csv";
    auto pathStr = path.string();

    auto input = std::make_shared<InputFileStream>(fs, pathStr.c_str());

    auto read_options = arrow::csv::ReadOptions::Defaults();
    auto parse_options = arrow::csv::ParseOptions::Defaults();
    auto convert_options = arrow::csv::ConvertOptions::Defaults();

    auto io_context = arrow::io::default_io_context();

    auto res_reader = arrow::csv::TableReader::Make(io_context, input, read_options, parse_options, convert_options);
    ASSERT_TRUE(res_reader.ok()) << res_reader.status().message();
    auto reader = res_reader.ValueUnsafe();

    auto res_read = reader->Read();
    ASSERT_TRUE(res_read.ok());
    auto table = res_read.ValueUnsafe();
    std::vector<std::string> colNames{"a", "b", "c"};
    ASSERT_EQ(table->ColumnNames(), colNames);
    ASSERT_EQ(table->num_rows(), 3);
}

}  // namespace
