#ifndef INCLUDE_DUCKDB_WEBAPI_PROTO_CODEC_H_
#define INCLUDE_DUCKDB_WEBAPI_PROTO_CODEC_H_

#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"

#include "flatbuffers/flatbuffers.h"
#include "duckdb_webapi/proto/query_result_generated.h"

namespace duckdb_webapi {
namespace proto {

/// Map an operator type
proto::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
flatbuffers::Offset<proto::QueryResultHeader> writeQueryResult(flatbuffers::FlatBufferBuilder& builder, duckdb::QueryResult& result, uint64_t queryID);
/// Write the query plan
flatbuffers::Offset<proto::QueryPlan> writeQueryPlan(flatbuffers::FlatBufferBuilder& builder, duckdb::LogicalOperator& plan);

} // namespace proto
} // namespace tigon

#endif // INCLUDE_DUCKDB_WEBAPI_PROTO_DUCKDB_CODEC_H_

