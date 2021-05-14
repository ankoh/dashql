// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/io/memory_filesystem.h"
#include "duckdb/web/webdb.h"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace duckdb::web;
using namespace std;

namespace {

TEST(ParquetImportTest, LoadParquet) {
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

TEST(ParquetImportTest, LoadParquetTwice) {
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
                 "29555\tFeuerbach\t2\t\n"
                 "\n");
}

}  // namespace
