// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_CODEC_H_
#define INCLUDE_DUCKDB_WEB_CODEC_H_

#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"
#include "duckdb/web/partitioner.h"
#include "flatbuffers/flatbuffers.h"

namespace duckdb {
namespace web {

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
proto::OperatorType MapOperatorType(duckdb::LogicalOperatorType type);

/// Write the query result
using ChunkVectorOffset = flatbuffers::Offset<flatbuffers::Vector<flatbuffers::Offset<proto::QueryResultChunk>>>;
flatbuffers::Offset<proto::QueryResult> WriteQueryResult(flatbuffers::FlatBufferBuilder& builder,
                                                         duckdb::QueryResult& result, uint64_t queryID,
                                                         ChunkVectorOffset chunks);
/// Write the query result chunk
flatbuffers::Offset<proto::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder& builder,
                                                                   duckdb::QueryResult& result, uint64_t queryID,
                                                                   duckdb::DataChunk* chunk,
                                                                   const PartitionBoundaries& partitionMask);
/// Write the query plan
flatbuffers::Offset<proto::QueryPlan> WriteQueryPlan(flatbuffers::FlatBufferBuilder& builder,
                                                     duckdb::LogicalOperator& plan);

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_PROTO_CODEC_H_
