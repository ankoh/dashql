// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <sstream>

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

TEST(WebDB, ImportCSV) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "test.csv";
    auto result = conn.ImportCSV(path.string(), R"({
        "import": {
            "schema": "csv_schema",
            "table": "csv_table"
        }
    })");
    ASSERT_TRUE(result.ok()) << result.message();
    auto queryResult = conn.connection().Query("SELECT * FROM csv_schema.csv_table");
    ASSERT_STREQ(queryResult->ToString().c_str(),
                 "a\tb\tc\t\n"
                 "BIGINT\tBIGINT\tBIGINT\t\n"
                 "[ Rows: 3]\n"
                 "1\t2\t3\t\n"
                 "4\t5\t6\t\n"
                 "7\t8\t9\t\n\n");
}

TEST(WebDB, ImportCSV2) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    auto path = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.csv";
    auto result = conn.ImportCSV(path.string(), R"({
        "import": {
            "schema": "csv_schema",
            "table": "csv_table2"
        },
        "read": {
            "column_names": ["MatrNr", "Name", "Semester"]
        },
        "parse": {
            "delimiter": "|"
        }
    })");
    ASSERT_TRUE(result.ok()) << result.message();
    auto queryResult = conn.connection().Query("SELECT * FROM csv_schema.csv_table2");
    ASSERT_STREQ(queryResult->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\n"
                 "BIGINT\tVARCHAR\tBIGINT\t\n"
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

TEST(WebDB, LoadParquet) {
    auto db = make_shared<WebDB>();
    WebDB::Connection conn{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "uni" / "out" / "studenten.parquet";
    ss << "SELECT * FROM parquet_scan('" << data.string() << "');";
    auto result = conn.connection().Query(ss.str());
    ASSERT_STREQ(result->ToString().c_str(),
                 "MatrNr\tName\tSemester\t\n"
                 "INTEGER\tVARCHAR\tINTEGER\t\n"
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

}  // namespace
