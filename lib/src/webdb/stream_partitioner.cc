#include "dashql/webdb/stream_partitioner.h" 
#include "duckdb/common/types/vector.hpp"

namespace dashql {
namespace webdb {

StreamPartitioner::StreamPartitioner()
    : query_result_(nullptr), partition_columns_(), last_chunk_row_() {}

/// Consume a query result
void StreamPartitioner::prepare(duckdb::QueryResult& result, std::vector<size_t> columns) {
    query_result_ = &result;
    partition_columns_ = {};
    last_chunk_row_ = {};
}

/// Iterate over a vector
template <typename T, bool WITH_NULL, typename OP> void iterVec(duckdb::VectorData &vec, size_t count, OP op) {
    if (vec.sel) {
        for (unsigned i = 0; i < count; ++i) {
            auto s = vec.sel->get_index(i);
            auto n = false;
            if constexpr (WITH_NULL) n = (*vec.nullmask)[s];
            auto d = reinterpret_cast<T *>(vec.data)[s];
            op(i, d, n);
        }
    } else {
        for (unsigned i = 0; i < count; ++i) {
            auto d = reinterpret_cast<T *>(vec.data)[i];
            auto n = false;
            if constexpr (WITH_NULL) n = (*vec.nullmask)[i];
            op(i, d, n);
        }
    }
}

/// Scan a duckdb vector and track positions where value change
template <typename VecType>
static void partition(duckdb::VectorData& vec, size_t count, duckdb::Value& prev, PartitionMask& out) {
    auto& prev_value = prev.GetValueUnsafe<VecType>();
    auto& prev_null = prev.is_null;
    if (out.size() < count) {
        out.resize(count, false);
    }
    if (vec.nullmask) {
        iterVec<VecType, true>(vec, count, [&](unsigned i, VecType value, bool null) {
            out[i] = (null != prev_null) || (!null && value != prev_value);
            prev_null = null;
            prev_value = value;
        });
    } else {
        iterVec<VecType, true>(vec, count, [&](unsigned i, VecType value, bool null) {
            out[i] = value != prev_value;
            prev_value = value;
        });
    }
}

/// Consume the next query result chunk 
void StreamPartitioner::consumeQueryResultChunk(duckdb::DataChunk& chunk, PartitionMask& out) {
    if (!this->query_result_) return;
    if (partition_columns_.empty()) { return; }

    for (size_t pi = 0; pi < partition_columns_.size(); ++pi) {
        auto ci = partition_columns_[pi];
        assert(ci < chunk.ColumnCount());

        // XXX compute partition mask of every column and combine them
    }
}

}  // namespace webdb
}  // namespace dashql
