// Copyright (c) 2020 The DashQL Authors

#include <duckdb/common/types.hpp>
#include <duckdb/main/config.hpp>
#include <fstream>

#include "dashql/test/config.h"
#include "duckdb.hpp"
#include "duckdb/web/csv_reader.h"
#include "duckdb/web/io/ifstream.h"
#include "gtest/gtest.h"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(CSVTest, BufferedCSVReader) {
    using LT = duckdb::LogicalType;
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.csv";
    auto input = std::make_shared<io::InputFileStreamBuffer>(buffer_manager, path.c_str());
    auto inputStream = std::make_unique<std::istream>(input.get());

    duckdb::BufferedCSVReaderOptions options;
    options.auto_detect = true;
    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);
    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(input.get()));
        reader.ParseCSV(output_chunk);
        ASSERT_STREQ(output_chunk.ToString().c_str(),
                     "Chunk - [3 Columns]\n"
                     "- FLAT INTEGER: 3 = [ 1, 4, 7]\n"
                     "- FLAT INTEGER: 3 = [ 2, 5, 8]\n"
                     "- FLAT INTEGER: 3 = [ 3, 6, 9]\n");
    } catch (std::exception const& e) {
        FAIL() << e.what();
    }
}

TEST(CSVTest, ParseTest) {
    auto buffer_manager = std::make_shared<io::BufferManager>();
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.csv";
    auto input = std::make_shared<io::InputFileStreamBuffer>(buffer_manager, path.c_str());
    auto inputStream = std::make_unique<std::istream>(input.get());

    duckdb::DBConfig config;
    auto db = std::make_shared<duckdb::DuckDB>(nullptr, &config);
    duckdb::Connection conn{*db};
    conn.BeginTransaction();

    CSVReaderArgs args;
    args.schema = "main";
    args.table = "foo";
    args.options = {};
    args.options.auto_detect = true;
    CSVReader reader{conn, std::move(inputStream), std::move(args)};

    auto init_rc = reader.Initialize();
    ASSERT_TRUE(init_rc.ok()) << init_rc.message();
    auto maybe_rows = reader.ParseEntireInput();
    ASSERT_TRUE(maybe_rows.ok()) << maybe_rows.status().message();
    ASSERT_EQ(maybe_rows.ValueUnsafe(), 3);

    auto result = conn.Query("select * from foo");
    ASSERT_STREQ(result->ToString().c_str(),
                 "a\tb\tc\t\nINTEGER\tINTEGER\tINTEGER\t\n"
                 "[ Rows: 3]\n"
                 "1\t2\t3\t\n"
                 "4\t5\t6\t\n"
                 "7\t8\t9\t\n\n");
}

}  // namespace
