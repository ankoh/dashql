// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_CODEC_H_
#define INCLUDE_DASHQL_WEBDB_CODEC_H_

#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/partitioner.h"
#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace webdb {

/// Iterate over a vector
template <typename T, bool WITH_NULL, typename OP> void iterateVector(duckdb::VectorData& vec, size_t count, OP op) {
    if (vec.sel) {
        for (unsigned i = 0; i < count; ++i) {
            auto s = vec.sel->get_index(i);
            auto n = false;
            if constexpr (WITH_NULL) n = (*vec.nullmask)[s];
            auto& d = reinterpret_cast<T*>(vec.data)[s];
            op(i, d, n);
        }
    } else {
        for (unsigned i = 0; i < count; ++i) {
            auto& d = reinterpret_cast<T*>(vec.data)[i];
            auto n = false;
            if constexpr (WITH_NULL) n = (*vec.nullmask)[i];
            op(i, d, n);
        }
    }
}

/// Map an operator type
proto::webdb::OperatorType MapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
using ChunkVectorOffset = flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<proto::webdb::QueryResultChunk>>>;
flatbuffers::Offset<proto::webdb::QueryResult> WriteQueryResult(flatbuffers::FlatBufferBuilder& builder,
                                                                duckdb::QueryResult& result, uint64_t queryID,
                                                                ChunkVectorOffset chunks);
/// Write the query result chunk
flatbuffers::Offset<proto::webdb::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder& builder,
                                                                          duckdb::QueryResult& result, uint64_t queryID,
                                                                          duckdb::DataChunk* chunk,
                                                                          const PartitionBoundaries& partitionMask);
/// Write the query plan
flatbuffers::Offset<proto::webdb::QueryPlan> WriteQueryPlan(flatbuffers::FlatBufferBuilder& builder,
                                                            duckdb::LogicalOperator& plan);

}  // namespace webdb
}  // namespace dashql

#endif  // INCLUDE_DUCKDB_WEB_PROTO_CODEC_H_
