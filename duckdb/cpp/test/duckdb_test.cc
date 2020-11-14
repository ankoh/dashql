// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "duckdb/webapi/webapi.h"
#include "duckdb/webapi/iterator.h"
#include "duckdb/webapi/proto/query_plan_generated.h"
#include "gtest/gtest.h"

#include "duckdb/common/vector_size.hpp"
#include "duckdb/common/types.hpp"

using namespace duckdb_webapi;
using namespace std;

namespace {

TEST(DuckDBTests, Settings) {
    ASSERT_EQ(STANDARD_VECTOR_SIZE, 1024);
}


TEST(DuckDBTests, SQLTypeIDs) {
    using dt = duckdb::LogicalTypeId;
    using pt = proto::SQLTypeID;

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
    ASSERT_EQ(static_cast<uint8_t>(dt::VARBINARY), static_cast<uint8_t>(pt::VARBINARY));
    ASSERT_EQ(static_cast<uint8_t>(dt::BLOB), static_cast<uint8_t>(pt::BLOB));
    ASSERT_EQ(static_cast<uint8_t>(dt::INTERVAL), static_cast<uint8_t>(pt::INTERVAL));
    ASSERT_EQ(static_cast<uint8_t>(dt::HUGEINT), static_cast<uint8_t>(pt::HUGEINT));
    ASSERT_EQ(static_cast<uint8_t>(dt::POINTER), static_cast<uint8_t>(pt::POINTER));
    ASSERT_EQ(static_cast<uint8_t>(dt::HASH), static_cast<uint8_t>(pt::HASH));
    ASSERT_EQ(static_cast<uint8_t>(dt::STRUCT), static_cast<uint8_t>(pt::STRUCT));
    ASSERT_EQ(static_cast<uint8_t>(dt::LIST), static_cast<uint8_t>(pt::LIST));
}

}  // namespace
