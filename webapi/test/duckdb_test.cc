// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/iterator.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "gtest/gtest.h"

#include "duckdb/common/vector_size.hpp"

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(DuckDBTests, Settings) {
    ASSERT_EQ(STANDARD_VECTOR_SIZE, 1024);
}

TEST(DuckDBTests, CreateTable) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto result = conn.RunQuery(R"RAW(
        CREATE TABLE r1(
            a int,
            b int
        );
        CREATE TABLE r2(
            c int,
            d int
        );
        CREATE TABLE r3(
            e int,
            f int
        );
    )RAW");
    ASSERT_TRUE(result.IsOk());
}

}  // namespace
