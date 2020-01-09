//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
#define INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_

#include "duckdb/main/query_result.hpp"
#include "duckdb/planner/logical_operator.hpp"

#include "google/protobuf/arena.h"
#include "tigon/proto/duckdb.pb.h"

namespace tigon {

/// Write the query plan
proto::duckdb::QueryPlan* encodeQueryPlan(google::protobuf::Arena& arena, duckdb::LogicalOperator& plan);
/// Write the query result
proto::duckdb::QueryResult* encodeQueryResult(google::protobuf::Arena& arena, duckdb::QueryResult& result, uint64_t queryID);

} // namespace tigon

#endif // INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
