// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb_webapi/webapi.h"
#include "duckdb_webapi/iterator.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "duckdb_webapi/types.h"
#include "gtest/gtest.h"

#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(WebAPI, InvalidSQL) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        INVALID SQL
    )RAW");
    ASSERT_TRUE(expected.IsErr());
}

}  // namespace
