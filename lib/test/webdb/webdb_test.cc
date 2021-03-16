// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/webdb.h"

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/webdb/iterator.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace dashql::webdb;
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
    auto result = con.Query(R"RAW(
        SELECT * FROM parquet_scan('/home/dakror/Desktop/dashql/webdb/test/studenten.parquet');
    )RAW");
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
