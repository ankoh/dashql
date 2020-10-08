// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/iterator.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "gtest/gtest.h"

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(QueryResultIterator, GenerateSeries) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};

    auto result = conn.SendQuery(R"RAW(
        SELECT * FROM generate_series(2, 10000);
    )RAW");
    ASSERT_TRUE(result.IsOk());
    QueryResultIterator iter{conn, result.value()};
    for (unsigned i = 2; i < 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd()) << i;
        ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), i);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

}  // namespace
