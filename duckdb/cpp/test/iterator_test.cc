// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb/web/webdb.h"
#include "duckdb/web/iterator.h"
#include "duckdb/web/proto/query_plan_generated.h"
#include "gtest/gtest.h"

#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/common/operator/numeric_binary_operators.hpp"

using namespace duckdb;
using namespace duckdb::web;
using namespace std;

namespace {

TEST(QueryResultIterator, BoolColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT MOD(v, 2)::BOOL FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::BOOLEAN);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        ASSERT_EQ(iter.GetValue(0).GetValue<bool>(), i % 2);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, TinyIntColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
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
    WebDB::Connection conn{db};
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
    WebDB::Connection conn{db};
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
    WebDB::Connection conn{db};
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
    WebDB::Connection conn{db};
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

TEST(QueryResultIterator, VarcharColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT v::VARCHAR FROM generate_series(0, 10000) as t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::VARCHAR);
    QueryResultIterator iter{conn, result};
    for (unsigned i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd());
        auto txt = std::to_string(i);
        ASSERT_EQ(iter.GetValue(0).GetValue<std::string>(), txt);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, DateColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT DATE '2020-10-09' + v::INTEGER FROM generate_series(0, 10000) AS t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::DATE);
    QueryResultIterator iter{conn, result};
    for (int32_t i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd()) << "i=" << i;
        auto txt = std::to_string(i);
        auto v = duckdb::AddOperator::Operation<date_t, interval_t, date_t>(duckdb::Date::FromDate(2020, 10, 9), {0, i, 0});
        ASSERT_EQ(iter.GetValue(0).GetValue<date_t>(), v);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, TimeColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT TIME '01:00:00' + CAST(CONCAT(MOD(v, 1000)::VARCHAR, ' millisecond') AS INTERVAL) FROM generate_series(0, 10000) AS t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::TIME);
    QueryResultIterator iter{conn, result};
    for (int32_t i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd()) << "i=" << i;
        auto txt = std::to_string(i);
        ASSERT_EQ(iter.GetValue(0).GetValue<dtime_t>(), duckdb::Time::FromTime(1, 0, 0, i % 1000)) << "i=" << i;
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, TimestampColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT TIMESTAMP '2020-10-09 01:00:00' + CAST(CONCAT(MOD(v, 1000)::VARCHAR, ' millisecond') AS INTERVAL) FROM generate_series(0, 10000) AS t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::TIMESTAMP);
    QueryResultIterator iter{conn, result};
    for (int32_t i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd()) << "i=" << i;
        auto d = duckdb::Date::FromDate(2020, 10, 9);
        auto t = duckdb::Time::FromTime(1, 0, 0, i % 1000);
        auto ts = duckdb::Timestamp::FromDatetime(d, t);
        ASSERT_EQ(iter.GetValue(0).GetValue<timestamp_t>(), ts) << "i=" << i;
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

TEST(QueryResultIterator, IntervalColumn) {
    auto db = make_shared<duckdb::DuckDB>();
    WebDB::Connection conn{db};
    auto expected = conn.SendQuery(R"RAW(
        SELECT CAST(CONCAT(MOD(v, 1000)::VARCHAR, ' millisecond') AS INTERVAL) FROM generate_series(0, 10000) AS t(v);
    )RAW");
    ASSERT_TRUE(expected.IsOk());
    auto& result = expected.value();
    ASSERT_NE(result.column_types(), nullptr);
    ASSERT_EQ(result.column_types()->size(), 1);
    ASSERT_EQ(result.column_types()->Get(0)->type_id(), proto::SQLTypeID::INTERVAL);
    QueryResultIterator iter{conn, result};
    for (int32_t i = 0; i <= 10000; ++i) {
        ASSERT_FALSE(iter.IsEnd()) << "i=" << i;
        auto expected = interval_t{0, 0, i % 1000};
        auto v = iter.GetValue(0).value_.interval; // XXX DuckDB lacks GetValue<interval_t>
        ASSERT_EQ(v.days, expected.days);
        ASSERT_EQ(v.months, expected.months);
        ASSERT_EQ(v.msecs, expected.msecs);
        iter.Next();
    }
    ASSERT_TRUE(iter.IsEnd());
}

}  // namespace
