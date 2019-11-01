//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
#define INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_

#include "duckdb.hpp"

#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/duckdb_generated.h"

namespace tigon {
namespace proto {

/// Map an operator type
proto::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
flatbuffers::Offset<proto::QueryResult> writeQueryResult(flatbuffers::FlatBufferBuilder& builder, duckdb::QueryResult& result, uint64_t queryID);
/// Write the query plan
flatbuffers::Offset<proto::QueryPlan> writeQueryPlan(flatbuffers::FlatBufferBuilder& builder, duckdb::LogicalOperator& plan);

} // namespace proto
} // namespace tigon

#endif // INCLUDE_TIGON_PROTO_DUCKDB_CODEC_H_
