// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/iterator.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "gtest/gtest.h"

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(QueryResultIterator, TinyIntColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT MOD(v, 128)::TINYINT FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::TINYINT);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<int8_t>(), i % 128);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, SmallIntColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::SMALLINT FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::SMALLINT);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<int16_t>(), i);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, IntegerColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::INTEGER FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::INTEGER);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), i);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, BigIntColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::BIGINT FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::BIGINT);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), i);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, FloatColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::FLOAT FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::FLOAT);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<float>(), static_cast<float>(i));
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, DoubleColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebAPI::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::DOUBLE FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::DOUBLE);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<double>(), static_cast<double>(i));
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

}  // namespace
