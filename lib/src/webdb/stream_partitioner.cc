#include "dashql/webdb/stream_partitioner.h" 
#include "dashql/webdb/codec.h" 
#include "duckdb/common/types/vector.hpp"
#include "duckdb/common/types/string_type.hpp"
#include "duckdb/common/types.hpp"
#include <string_view>
#include <vector>

namespace dashql {
namespace webdb {

StreamPartitioner::StreamPartitioner()
    : query_result_(nullptr), partition_columns_(), previous_values_() {}

/// Consume a query result
void StreamPartitioner::prepare(duckdb::QueryResult& result, std::vector<size_t> columns) {
    query_result_ = &result;
    partition_columns_ = {};
    previous_values_ = {};
}

/// Scan a duckdb vector and track positions where values change
template <typename VecType>
static void partition(duckdb::VectorData& vec, size_t count, duckdb::Value& prev, PartitionMask& out) {
    auto prev_value = prev.GetValueUnsafe<VecType>();
    auto prev_null = prev.is_null;
    assert(out.size() >= count);
    if (vec.nullmask) {
        iterateVector<VecType, true>(vec, count, [&](unsigned i, VecType& value, bool null) {
            out[i] = out[i] | ((null != prev_null) || (!null && value != prev_value));
            prev_null = null;
            prev_value = value;
        });
    } else {
        iterateVector<VecType, true>(vec, count, [&](unsigned i, VecType& value, bool null) {
            out[i] = out[i] | (value != prev_value);
            prev_value = value;
        });
    }
    prev.GetValueUnsafe<VecType>() = prev_value;
    prev.is_null = prev_null;
}

/// Partition strings
static void partitionStrings(duckdb::VectorData& vec, size_t count, duckdb::Value& prev, PartitionMask& out) {
    auto prev_value = duckdb::string_t{prev.GetValueUnsafe<std::string>()};
    auto prev_null = prev.is_null;
    assert(out.size() >= count);
    // XXX DuckDB could also just use string_view (polyfill)?
    auto strv = [](duckdb::string_t& str) {
        return std::string_view{str.GetDataUnsafe(), static_cast<std::string_view::size_type>(str.GetSize())};
    };
    if (vec.nullmask) {
        iterateVector<duckdb::string_t, true>(vec, count, [&](unsigned i, duckdb::string_t& value, bool null) {
            out[i] = out[i] | ((null != prev_null) || (!null && strv(value) != strv(prev_value)));
            prev_null = null;
            prev_value = value;
        });
    } else {
        iterateVector<duckdb::string_t, true>(vec, count, [&](unsigned i, duckdb::string_t& value, bool null) {
            out[i] = out[i] | (strv(value) != strv(prev_value));
            prev_value = value;
        });
    }
    prev.GetValueUnsafe<std::string>() = prev_value.GetString();
    prev.is_null = prev_null;
}

/// Consume the next query result chunk 
void StreamPartitioner::consumeQueryResultChunk(duckdb::DataChunk& chunk, PartitionMask& out) {
    if (!this->query_result_) return;
    if (partition_columns_.empty()) { return; }
    assert(out.size() >= chunk.size());
    auto size = chunk.size();
    auto vectors = chunk.Orrify();

    auto local = out;

    for (size_t pi = 0; pi < partition_columns_.size(); ++pi) {
        auto ci = partition_columns_[pi];
        assert(ci < chunk.ColumnCount());

        switch (chunk.GetTypes()[ci].InternalType()) {
            case duckdb::PhysicalType::BOOL:
                partition<uint8_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::INT8:
                partition<int8_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::INT16:
                partition<int16_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::INT32:
                partition<int32_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::INT64:
                partition<int64_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::INT128:
                partition<duckdb::hugeint_t>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::FLOAT:
                partition<float>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::DOUBLE:
                partition<double>(vectors[ci], size, previous_values_[pi], out);
                break;
            case duckdb::PhysicalType::VARCHAR:
            case duckdb::PhysicalType::STRING:
                partitionStrings(vectors[ci], size, previous_values_[pi], out);
                break;
            default:
                assert(false);
        }
    }


}

}  // namespace webdb
}  // namespace dashql
