// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_CODEC_H_
#define INCLUDE_DUCKDB_WEBAPI_CODEC_H_

#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"

#include "flatbuffers/flatbuffers.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/common/span.h"

namespace duckdb_webapi {

/// Map an operator type
proto::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
flatbuffers::Offset<proto::QueryResult> writeQueryResult(flatbuffers::FlatBufferBuilder& builder, duckdb::QueryResult& result, uint64_t queryID);
/// Write the query result chunk
flatbuffers::Offset<proto::QueryResultChunk> writeQueryResultChunk(flatbuffers::FlatBufferBuilder& builder, uint64_t queryID, duckdb::DataChunk* chunk, nonstd::span<duckdb::LogicalType> types);
/// Write the query plan
flatbuffers::Offset<proto::QueryPlan> writeQueryPlan(flatbuffers::FlatBufferBuilder& builder, duckdb::LogicalOperator& plan);


/// A logical type
struct LogicalType {
    static proto::LogicalType create();
    static proto::LogicalType create(proto::LogicalTypeID id);
    static proto::LogicalType create(proto::LogicalTypeID id, uint8_t width, uint8_t scale);
    /// Get the physical type
    static proto::PhysicalTypeID getPhysicalType(proto::LogicalType& type);
    /// Logical type to string
    static const char* toString(proto::LogicalTypeID typeID);
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_PROTO_CODEC_H_

