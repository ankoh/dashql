// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/io/streambuf.h"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(WebDB, InvalidSQL) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    auto expected = conn.SendQuery(R"RAW(
        INVALID SQL
    )RAW");
    ASSERT_FALSE(expected.ok());
}

TEST(WebDB, RunQuery) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    auto buffer = conn.RunQuery("SELECT (v & 127)::TINYINT FROM generate_series(0, 2000) as t(v);");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
}

TEST(WebDB, SendQuery) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    auto buffer = conn.SendQuery("SELECT (v & 127)::TINYINT FROM generate_series(0, 2000) as t(v);");
    ASSERT_TRUE(buffer.ok()) << buffer.status().message();
}

TEST(WebDB, LoadParquet) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    ss << "SELECT * FROM parquet_scan('" << data.string() << "');";
    auto result = conn.connection().Query(ss.str());
    ASSERT_STREQ(result->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\nINTEGER\tVARCHAR\tINTEGER\t\n"
                 "[ Rows: 8]\n"
                 "24002\tXenokrates\t18\t\n"
                 "25403\tJonas\t12\t\n"
                 "26120\tFichte\t10\t\n"
                 "26830\tAristoxenos\t8\t\n"
                 "27550\tSchopenhauer\t6\t\n"
                 "28106\tCarnap\t3\t\n"
                 "29120\tTheophrastos\t2\t\n"
                 "29555\tFeuerbach\t2\t\n\n");
}

TEST(WebDB, LoadParquetTwice) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    ss << "SELECT * FROM parquet_scan('" << data.string() << "');";
    auto query = ss.str();
    auto result = conn.connection().Query(query);
    ASSERT_STREQ(result->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\nINTEGER\tVARCHAR\tINTEGER\t\n"
                 "[ Rows: 8]\n"
                 "24002\tXenokrates\t18\t\n"
                 "25403\tJonas\t12\t\n"
                 "26120\tFichte\t10\t\n"
                 "26830\tAristoxenos\t8\t\n"
                 "27550\tSchopenhauer\t6\t\n"
                 "28106\tCarnap\t3\t\n"
                 "29120\tTheophrastos\t2\t\n"
                 "29555\tFeuerbach\t2\t\n\n");
    result = conn.connection().Query(query);
    ASSERT_STREQ(result->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\nINTEGER\tVARCHAR\tINTEGER\t\n"
                 "[ Rows: 8]\n"
                 "24002\tXenokrates\t18\t\n"
                 "25403\tJonas\t12\t\n"
                 "26120\tFichte\t10\t\n"
                 "26830\tAristoxenos\t8\t\n"
                 "27550\tSchopenhauer\t6\t\n"
                 "28106\tCarnap\t3\t\n"
                 "29120\tTheophrastos\t2\t\n"
                 "29555\tFeuerbach\t2\t\n\n");
}

// TEST(WebDB, LoadCSVIStream) {
//     using LT = duckdb::LogicalType;
//
//     auto data = dashql::test::SOURCE_DIR / ".." / "data" / "test.csv";
//
//     // Create database
//     auto buffer_manager = std::make_shared<io::BufferManager>(io::CreateDefaultFileSystem());
//     auto buffered_filesystem = std::make_unique<io::BufferedFileSystem>(buffer_manager);
//     duckdb::DBConfig db_config;
//     db_config.file_system = std::move(buffered_filesystem);
//
//     auto db = make_shared<duckdb::DuckDB>(nullptr, &db_config);
//     duckdb::BufferedCSVReaderOptions options;
//     options.delimiter = ',';
//     std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
//     duckdb::DataChunk output_chunk;
//     output_chunk.Initialize(column_types);
//
//     auto input = std::make_shared<io::InputStreamBuffer>(buffer_manager, data.c_str());
//     try {
//         duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(input.get()));
//         reader.ParseCSV(output_chunk);
//         ASSERT_STREQ(output_chunk.ToString().c_str(),
//                      "Chunk - [3 Columns]\n"
//                      "- FLAT INTEGER: 3 = [ 1, 4, 7]\n"
//                      "- FLAT INTEGER: 3 = [ 2, 5, 8]\n"
//                      "- FLAT INTEGER: 3 = [ 3, 6, 9]\n");
//     } catch (std::exception const& e) {
//         FAIL() << e.what();
//     }
// }

}  // namespace
