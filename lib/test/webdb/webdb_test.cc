// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/webdb.h"

#include <sstream>

#include "dashql/proto_generated.h"
#include "dashql/webdb/iterator.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "gtest/gtest.h"

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

}  // namespace
