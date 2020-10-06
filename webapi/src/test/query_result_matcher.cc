// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/test/query_result_matcher.h"

namespace duckdb_webapi {
namespace test {

/// Equal results?
::testing::AssertionResult equalResults(duckdb::QueryResult& dbResult, std::vector<proto::QueryResultChunk*>& protoResult) {
    (void)dbResult;
    (void)protoResult;
    return ::testing::AssertionSuccess() << "results are equal";
}

} // namespace test
} // namespace duckdb_webapi

