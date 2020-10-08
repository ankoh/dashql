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
        SELECT * FROM generate_series(2, 5);
    )RAW");

    ASSERT_TRUE(result.IsOk());

    auto& r = result.value();
    ASSERT_NE(r.column_names(), nullptr);
    ASSERT_NE(r.column_types(), nullptr);
    ASSERT_NE(r.data_chunks(), nullptr);

    auto chunks = r.data_chunks();
    ASSERT_EQ(chunks->size(), 1);

    QueryResultIterator iter{conn, result.value()};
    ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), 2);
    ++iter;
    ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), 3);
    ++iter;
    ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), 4);
}

}  // namespace
