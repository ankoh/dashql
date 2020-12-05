// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "dashql/proto_generated.h"
#include "duckdb/web/webdb.h"
#include "duckdb/web/iterator.h"
#include "gtest/gtest.h"

#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/timestamp.hpp"

using namespace duckdb::web;
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
