// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TEST_QUERY_RESULT_MATCHER_H_
#define INCLUDE_DUCKDB_WEBAPI_TEST_QUERY_RESULT_MATCHER_H_

#include "duckdb.hpp"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "gtest/gtest.h"

namespace duckdb_webapi {
namespace test {

/// Equal results?
::testing::AssertionResult equalResults(duckdb::QueryResult& dbResult, proto::QueryResult& protoResult);

} // namespace test
} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_QUERY_RESULT_DUCKDB_MATCHER_H_

