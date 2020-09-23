//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
#define INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_

#include "duckdb/main/query_result.hpp"
#include "duckdb/planner/logical_operator.hpp"

#include "dashql/proto/engine.pb.h"
#include "google/protobuf/arena.h"

namespace dashql {

    /// Write the query plan
    proto::engine::QueryPlan* encodeQueryPlan(google::protobuf::Arena& arena, duckdb::LogicalOperator& plan);
    /// Write the query result
    proto::engine::QueryResult* encodeQueryResult(google::protobuf::Arena& arena, duckdb::QueryResult& result, uint64_t queryID);

} // namespace dashql

#endif // INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
