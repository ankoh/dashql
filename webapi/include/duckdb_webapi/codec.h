// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_CODEC_H_
#define INCLUDE_DUCKDB_WEBAPI_CODEC_H_

#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"
#include "duckdb_webapi/common/span.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/proto/vector_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace duckdb_webapi {

/// Map an operator type
proto::OperatorType MapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
flatbuffers::Offset<proto::QueryResult> WriteQueryResult(flatbuffers::FlatBufferBuilder& builder,
                                                         duckdb::QueryResult& result, uint64_t queryID);
/// Write the query result chunk
flatbuffers::Offset<proto::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder& builder,
                                                                   uint64_t queryID, duckdb::DataChunk* chunk,
                                                                   nonstd::span<duckdb::LogicalType> types);
/// Write the query plan
flatbuffers::Offset<proto::QueryPlan> WriteQueryPlan(flatbuffers::FlatBufferBuilder& builder,
                                                     duckdb::LogicalOperator& plan);

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_PROTO_CODEC_H_

