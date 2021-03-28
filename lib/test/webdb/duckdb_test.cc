// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/test/config.h"
#include "dashql/webdb/iterator.h"
#include "dashql/webdb/webdb.h"
#include "duckdb/common/types.hpp"
#include "duckdb/common/vector_size.hpp"
#include "gtest/gtest.h"
#include "parquet-extension.hpp"

using namespace dashql::webdb;
using namespace std;
namespace p = dashql::proto::webdb;

namespace {

TEST(DuckDBTests, Settings) { ASSERT_EQ(STANDARD_VECTOR_SIZE, 1024); }

TEST(DuckDBTests, SQLTypeIDs) {
    using dt = duckdb::LogicalTypeId;
    using pt = p::SQLTypeID;

    ASSERT_EQ(static_cast<uint8_t>(dt::INVALID), static_cast<uint8_t>(pt::INVALID));
    ASSERT_EQ(static_cast<uint8_t>(dt::SQLNULL), static_cast<uint8_t>(pt::SQLNULL));
    ASSERT_EQ(static_cast<uint8_t>(dt::UNKNOWN), static_cast<uint8_t>(pt::UNKNOWN));
    ASSERT_EQ(static_cast<uint8_t>(dt::ANY), static_cast<uint8_t>(pt::ANY));
    ASSERT_EQ(static_cast<uint8_t>(dt::BOOLEAN), static_cast<uint8_t>(pt::BOOLEAN));
    ASSERT_EQ(static_cast<uint8_t>(dt::TINYINT), static_cast<uint8_t>(pt::TINYINT));
    ASSERT_EQ(static_cast<uint8_t>(dt::SMALLINT), static_cast<uint8_t>(pt::SMALLINT));
    ASSERT_EQ(static_cast<uint8_t>(dt::INTEGER), static_cast<uint8_t>(pt::INTEGER));
    ASSERT_EQ(static_cast<uint8_t>(dt::BIGINT), static_cast<uint8_t>(pt::BIGINT));
    ASSERT_EQ(static_cast<uint8_t>(dt::DATE), static_cast<uint8_t>(pt::DATE));
    ASSERT_EQ(static_cast<uint8_t>(dt::TIME), static_cast<uint8_t>(pt::TIME));
    ASSERT_EQ(static_cast<uint8_t>(dt::TIMESTAMP), static_cast<uint8_t>(pt::TIMESTAMP));
    ASSERT_EQ(static_cast<uint8_t>(dt::DECIMAL), static_cast<uint8_t>(pt::DECIMAL));
    ASSERT_EQ(static_cast<uint8_t>(dt::FLOAT), static_cast<uint8_t>(pt::FLOAT));
    ASSERT_EQ(static_cast<uint8_t>(dt::DOUBLE), static_cast<uint8_t>(pt::DOUBLE));
    ASSERT_EQ(static_cast<uint8_t>(dt::CHAR), static_cast<uint8_t>(pt::CHAR));
    ASSERT_EQ(static_cast<uint8_t>(dt::VARCHAR), static_cast<uint8_t>(pt::VARCHAR));
    ASSERT_EQ(static_cast<uint8_t>(dt::BLOB), static_cast<uint8_t>(pt::BLOB));
    ASSERT_EQ(static_cast<uint8_t>(dt::INTERVAL), static_cast<uint8_t>(pt::INTERVAL));
    ASSERT_EQ(static_cast<uint8_t>(dt::HUGEINT), static_cast<uint8_t>(pt::HUGEINT));
    ASSERT_EQ(static_cast<uint8_t>(dt::POINTER), static_cast<uint8_t>(pt::POINTER));
    ASSERT_EQ(static_cast<uint8_t>(dt::HASH), static_cast<uint8_t>(pt::HASH));
    ASSERT_EQ(static_cast<uint8_t>(dt::STRUCT), static_cast<uint8_t>(pt::STRUCT));
    ASSERT_EQ(static_cast<uint8_t>(dt::LIST), static_cast<uint8_t>(pt::LIST));
}

TEST(DuckDBTests, PassingDuckDBRegression1) {
    auto db = make_shared<duckdb::DuckDB>();
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "tpch" / "lineitem.parquet";
    ss << "select sum(l_quantity) as sum_qty "
          "from parquet_scan('"
       << data.string()
       << "') lineitem "
          "where l_shipdate::DATE <= date '1996-12-01' - interval '86' day";
    auto result = con.Query(ss.str());
    ASSERT_TRUE(result->success);
    ASSERT_NE(result->GetValue(0, 0), NULL);
}

TEST(DuckDBTests, PassingDuckDBRegression2) {
    auto db = make_shared<duckdb::DuckDB>();
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "tpch" / "lineitem.parquet";
    ss << "sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge "
          "from parquet_scan('"
       << data.string()
       << "') lineitem "
          "where l_shipdate::DATE <= date '1996-12-01' - interval '86' day";
    auto result = con.Query(ss.str());
    ASSERT_TRUE(result->success);
    ASSERT_NE(result->GetValue(0, 0), NULL);
}

TEST(DuckDBTests, FailingDuckDBRegression) {
    auto db = make_shared<duckdb::DuckDB>();
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    std::stringstream ss;
    auto data = dashql::test::SOURCE_DIR / ".." / "data" / "tpch" / "lineitem.parquet";
    ss << "select sum(l_quantity) as sum_qty, sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge "
          "from parquet_scan('"
       << data.string()
       << "') lineitem "
          "where l_shipdate::DATE <= date '1996-12-01' - interval '86' day";
    auto result = con.Query(ss.str());
    ASSERT_TRUE(result->success);
    ASSERT_NE(result->GetValue(0, 0), NULL);
    ASSERT_NE(result->GetValue(1, 0), NULL);
}

}  // namespace
