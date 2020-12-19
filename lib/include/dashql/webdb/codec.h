// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_CODEC_H_
#define INCLUDE_DASHQL_WEBDB_CODEC_H_

#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace webdb {

/// Map an operator type
proto::webdb::OperatorType MapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
flatbuffers::Offset<proto::webdb::QueryResult> WriteQueryResult(flatbuffers::FlatBufferBuilder& builder,
                                                                duckdb::QueryResult& result, uint64_t queryID,
                                                                bool async = true);
/// Write the query result chunk
flatbuffers::Offset<proto::webdb::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder& builder,
                                                                          uint64_t queryID, duckdb::DataChunk* chunk,
                                                                          nonstd::span<duckdb::LogicalType> types);
/// Write the query plan
flatbuffers::Offset<proto::webdb::QueryPlan> WriteQueryPlan(flatbuffers::FlatBufferBuilder& builder,
                                                            duckdb::LogicalOperator& plan);

}  // namespace webdb
}  // namespace dashql

#endif  // INCLUDE_DUCKDB_WEB_PROTO_CODEC_H_

