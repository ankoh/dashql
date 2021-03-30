// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <sstream>

#include "dashql/common/blob_stream.h"
#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(WebDB, InvalidSQL) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        INVALID SQL
    )RAW");
    ASSERT_TRUE(expected.IsErr());
}

TEST(WebDB, LoadParquet) {
    auto db = make_shared<duckdb::DuckDB>();
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    ss << "SELECT * FROM parquet_scan('" << data.string() << "');";
    auto result = con.Query(ss.str());
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

TEST(WebDB, LoadCSVIStream) {
    using LT = duckdb::LogicalType;

    auto db = make_shared<duckdb::DuckDB>();
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "test.csv";
    duckdb::BufferedCSVReaderOptions options;
    options.auto_detect = true;
    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);
    auto str = data.string();
    auto fh = db->GetFileSystem().OpenFile(str, duckdb::FileFlags::FILE_FLAGS_READ);
    dashql::FileSystemStreamBuffer streambuf(db->GetFileSystem(), *fh);

    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(&streambuf));
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

}  // namespace
