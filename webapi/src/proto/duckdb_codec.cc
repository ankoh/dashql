// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/proto/duckdb_codec.h"
#include "duckdb/planner/logical_operator.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/common/vector_operations/unary_executor.hpp"

namespace fb = flatbuffers;

namespace duckdb_webapi {
namespace proto {

#define LOGICAL_OPERATOR_TYPES \
    X(INVALID) \
    X(PROJECTION) \
    X(FILTER) \
    X(AGGREGATE_AND_GROUP_BY) \
    X(WINDOW) \
    X(UNNEST) \
    X(LIMIT) \
    X(ORDER_BY) \
    X(TOP_N) \
    X(COPY_FROM_FILE) \
    X(COPY_TO_FILE) \
    X(DISTINCT) \
    X(INDEX_SCAN) \
    X(GET) \
    X(CHUNK_GET) \
    X(DELIM_GET) \
    X(EXPRESSION_GET) \
    X(TABLE_FUNCTION) \
    X(EMPTY_RESULT) \
    X(JOIN) \
    X(DELIM_JOIN) \
    X(COMPARISON_JOIN) \
    X(ANY_JOIN) \
    X(CROSS_PRODUCT) \
    X(UNION) \
    X(EXCEPT) \
    X(INTERSECT) \
    X(RECURSIVE_CTE) \
    X(INSERT) \
    X(DELETE) \
    X(UPDATE) \
    X(ALTER) \
    X(CREATE_TABLE) \
    X(CREATE_INDEX) \
    X(CREATE_SEQUENCE) \
    X(CREATE_VIEW) \
    X(CREATE_SCHEMA) \
    X(DROP) \
    X(PRAGMA) \
    X(TRANSACTION) \
    X(EXPLAIN) \
    X(PREPARE) \
    X(EXECUTE) \
    X(VACUUM)

proto::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type) {
    using D = duckdb::LogicalOperatorType;
    using P = proto::LogicalOperatorType;
    switch (type) {
#define X(NAME) case duckdb::LogicalOperatorType::NAME: return proto::LogicalOperatorType::NAME;
    LOGICAL_OPERATOR_TYPES
#undef X
        default:
            return proto::LogicalOperatorType::INVALID;
    };
    return proto::LogicalOperatorType::INVALID;
}

/// Iterate over a vector
template <typename T, bool WITH_NULL, typename OP>
void iterVec(duckdb::VectorData& vec, size_t count, OP op) {
    if (vec.sel) {
        for (unsigned i = 0; i < count; ++i) {
            auto s = vec.sel->get_index(i);
            auto n = false;
            if constexpr (WITH_NULL)
                n = (*vec.nullmask)[s];
            auto d = reinterpret_cast<T*>(vec.data)[s];
            op(i, d, n);
        }
    } else {
        for (unsigned i = 0; i < count; ++i) {
            auto d = reinterpret_cast<T*>(vec.data)[i];
            auto n = false;
            if constexpr (WITH_NULL)
                n = (*vec.nullmask)[i];
            op(i, d, n);
        }
    }
}

/// Write a fixed-length result column
template <typename T>
static fb::Offset<proto::QueryResultColumn> writeCol(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type, duckdb::VectorData &vec, size_t count) {
    assert(sizeof(T) == duckdb::GetTypeIdSize(type));

    T *values;
    auto dBuf = builder.CreateUninitializedVector(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> nBuf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        nBuf = builder.CreateUninitializedVector(count, &nullmask);
        iterVec<T, true>(vec, count, [&](unsigned i, T value, bool null) {
            values[i] = value;
            nullmask[i] = null;
        });
    } else {
        iterVec<T, false>(vec, count, [&](unsigned i, T value, bool null) {
            values[i] = value;
        });
    }

    // Build the query result column
    proto::QueryResultColumnBuilder c{builder};
    c.add_physical_type(static_cast<proto::PhysicalTypeID>(type));
    if (nBuf)
        c.add_null_mask(*nBuf);
    if constexpr (std::is_same_v<T, uint8_t>) {
        c.add_rows_u8(dBuf);
    } else if constexpr (std::is_same_v<T, uint16_t>) {
        c.add_rows_u16(dBuf);
    } else if constexpr (std::is_same_v<T, int16_t>) {
        c.add_rows_i16(dBuf);
    } else if constexpr (std::is_same_v<T, int32_t>) {
        c.add_rows_i32(dBuf);
    } else if constexpr (std::is_same_v<T, uint64_t>) {
        c.add_rows_u64(dBuf);
    } else if constexpr (std::is_same_v<T, int64_t>) {
        c.add_rows_i64(dBuf);
    } else if constexpr (std::is_same_v<T, float>) {
        c.add_rows_f32(dBuf);
    } else if constexpr (std::is_same_v<T, double>) {
        c.add_rows_f64(dBuf);
    }
    return c.Finish();
}

/// Write a string result column
static fb::Offset<proto::QueryResultColumn> writeStringCol(fb::FlatBufferBuilder &builder, duckdb::VectorData &vec, size_t count) {
    std::optional<fb::Offset<fb::Vector<uint8_t>>> nBuf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        auto n = builder.CreateUninitializedVector(count, &nullmask);
        builder.StartVector(count, sizeof(fb::Offset<fb::String>));
        auto **source = reinterpret_cast<const char **>(vec.data);

        // Has selection vector?
        if (vec.sel) {
            for (unsigned i = 0; i < count; ++i) {
                auto s = vec.sel->get_index(i);
                builder.PushElement(builder.CreateString(source[s]));
                nullmask[i] = (*vec.nullmask)[s];
            }
        } else {
            for (unsigned i = 0; i < count; ++i) {
                builder.PushElement(builder.CreateString(source[i]));
                nullmask[i] = (*vec.nullmask)[i];
            }
        }
    } else {
        builder.StartVector(count, sizeof(fb::Offset<fb::String>));
        auto **source = reinterpret_cast<const char **>(vec.data);

        // Has selection vector?
        if (vec.sel) {
            for (unsigned i = 0; i < count; ++i)
                builder.PushElement(builder.CreateString(source[vec.sel->get_index(i)]));
        } else {
            for (unsigned i = 0; i < count; ++i)
                builder.PushElement(builder.CreateString(source[i]));
        }
    }
    auto dBuf = builder.EndVector(count);
    proto::QueryResultColumnBuilder c{builder};
    c.add_rows_string(dBuf);
    c.add_physical_type(proto::PhysicalTypeID::STRING);
    if (nBuf)
        c.add_null_mask(*nBuf);
    return c.Finish();
}

/// Write the query result chunk
fb::Offset<proto::QueryResultChunk> writeQueryResultChunk(flatbuffers::FlatBufferBuilder& builder, duckdb::DataChunk* chunkPtr, nonstd::span<duckdb::LogicalType> types) {
    duckdb::DataChunk tmp;
    auto& chunk = (!!chunkPtr) ? *chunkPtr : tmp;

    auto size = chunk.size();
    auto vectors = chunk.Orrify();

    // Write chunk columns
    std::vector<fb::Offset<proto::QueryResultColumn>> columns;
    for (size_t column_id = 0; column_id < chunk.column_count(); ++column_id) {
        auto lType = types[column_id];
        auto pType = lType.InternalType();
        auto vec = vectors.get()[column_id];

        // Ref: src/common/types.cpp
        // We only need to encode types that are actually used in LogicalType::GetInternalType.
        // We try to catch this via tests.

        // Write result column
        auto column = [&]() -> fb::Offset<proto::QueryResultColumn> {
            switch (pType) {
            case duckdb::PhysicalType::INT8:
                return writeCol<int8_t>(builder, pType, vec, size);
            case duckdb::PhysicalType::INT16:
                return writeCol<int16_t>(builder, pType, vec, size);
            case duckdb::PhysicalType::INT32:
                return writeCol<int32_t>(builder, pType, vec, size);
            case duckdb::PhysicalType::INT64:
                return writeCol<int64_t>(builder, pType, vec, size);
            case duckdb::PhysicalType::FLOAT:
                return writeCol<float>(builder, pType, vec, size);
            case duckdb::PhysicalType::DOUBLE:
                return writeCol<double>(builder, pType, vec, size);

            case duckdb::PhysicalType::VARCHAR:
            case duckdb::PhysicalType::STRING:
                return writeStringCol(builder, vec, size);

            case duckdb::PhysicalType::BOOL:
            case duckdb::PhysicalType::INT128:
            case duckdb::PhysicalType::VARBINARY:
            case duckdb::PhysicalType::INTERVAL:
            case duckdb::PhysicalType::STRUCT:
            case duckdb::PhysicalType::LIST:
            default:
                throw "unsupported physical type";
            }
            return {};
        }();

        // Push new chunk column
        columns.push_back(column);
    }
    auto columnOffset = builder.CreateVector(columns);

    // Build result chunk
    proto::QueryResultChunkBuilder chunkBuilder{builder};
    chunkBuilder.add_columns(columnOffset);
    return chunkBuilder.Finish();
}

/// Write the query result
fb::Offset<proto::QueryResultHeader> writeQueryResult(fb::FlatBufferBuilder& builder, duckdb::QueryResult& result, uint64_t queryID) {

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<proto::QueryResultChunk>> chunks;
    for (auto chunk = result.Fetch(); !!chunk && chunk->size() > 0; chunk = result.Fetch())
        chunks.push_back(writeQueryResultChunk(builder, chunk.get(), result.types));
    auto dataChunks = builder.CreateVector(chunks);

    // Write column types
    fb::Offset<fb::Vector<const proto::LogicalType*>> columnTypes;
    {
        proto::LogicalType *writer;
        columnTypes = builder.CreateUninitializedVectorOfStructs<proto::LogicalType>(result.types.size(), &writer);
        for (size_t i = 0; i < result.types.size(); ++i) {
            auto t = result.types[i];
            writer[i] = proto::LogicalType {
                static_cast<proto::LogicalTypeID>(t.id()),
                t.width(),
                t.scale()
            };
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result.names);

    // Write the query result
    proto::QueryResultHeaderBuilder resultBuilder{builder};
    resultBuilder.add_query_id(queryID);
    resultBuilder.add_column_names(columnNames);
    resultBuilder.add_column_types(columnTypes);
    resultBuilder.add_data_chunks(dataChunks);
    return resultBuilder.Finish();
}

/// Write the query plan
fb::Offset<proto::QueryPlan> writeQueryPlan(fb::FlatBufferBuilder& builder, duckdb::LogicalOperator& plan) {
    // Remember the children
    std::vector<duckdb::LogicalOperator*> operators;
    std::vector<std::tuple<size_t, size_t>> operatorChildEdges;
    operators.push_back(&plan);

    // Traverse the plan
    std::vector<size_t> dfsStack;
    dfsStack.push_back(0);
    while (!dfsStack.empty()) {
        // Get next operator
        auto targetID = dfsStack.back();
        dfsStack.pop_back();

        // Add children
        for (auto &child : operators[targetID]->children) {
            auto childID = operators.size();
            operators.push_back(child.get());
            dfsStack.push_back(childID);
            operatorChildEdges.push_back({targetID, childID});
        }
    }

    fb::Offset<fb::Vector<uint8_t>> operatorTypeVector;
    fb::Offset<fb::Vector<uint64_t>> operatorChildVector;
    fb::Offset<fb::Vector<uint64_t>> operatorChildOffsetVector;

    // Write operator types
    {
        uint8_t *writer;
        operatorTypeVector = builder.CreateUninitializedVector<uint8_t>(operators.size(), &writer);
        for (size_t i = 0; i < operators.size(); ++i) {
            writer[i] = static_cast<uint8_t>(mapOperatorType(operators[i]->type));
        }
    }

    // Write the children
    {
        // Encode children 
        std::vector<size_t> operatorChildren;
        std::vector<size_t> operatorChildOffsets;
        std::sort(operatorChildEdges.begin(), operatorChildEdges.end(), [&](auto& l, auto& r) {
            return std::get<0>(l) < std::get<0>(r);
        });
        operatorChildOffsets.resize(operators.size(), 0);

        auto edgeIter = operatorChildEdges.begin();
        for (auto oid = 0; oid < operators.size(); ++oid) {
            operatorChildOffsets[oid] = operatorChildren.size();

            // Reached end?
            if (edgeIter == operatorChildEdges.end())
                continue;

            // At parent of next edge?
            auto& [parent, child] = *edgeIter;
            if (oid != parent)
                continue;

            // Store children 
            operatorChildren.push_back(child);
            edgeIter++;
            for (; edgeIter != operatorChildEdges.end(); ++edgeIter) {
                auto& [nextParent, nextChild] = *edgeIter;
                if (oid != nextParent) {
                    break;
                } else {
                    operatorChildren.push_back(nextChild);
                }
            }
        }

        // Write children
        uint64_t *writer;
        operatorChildVector = builder.CreateUninitializedVector<uint64_t>(operatorChildren.size(), &writer);
        for (size_t i = 0; i < operatorChildren.size(); ++i) {
            writer[i] = static_cast<size_t>(operatorChildren[i]);
        }

        // Write child offsets
        operatorChildOffsetVector = builder.CreateUninitializedVector<uint64_t>(operatorChildOffsets.size(), &writer);
        for (size_t i = 0; i < operatorChildOffsets.size(); ++i) {
            writer[i] = static_cast<size_t>(operatorChildOffsets[i]);
        }
    }

    // Write the query result
    proto::QueryPlanBuilder planBuilder{builder};
    planBuilder.add_operator_types(operatorTypeVector);
    planBuilder.add_operator_children(operatorChildVector);
    planBuilder.add_operator_child_offsets(operatorChildOffsetVector);
    return planBuilder.Finish();
}

}  // namespace proto
}  // namespace duckdb_webapi

