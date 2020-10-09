// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/codec.h"

#include "duckdb/common/vector_operations/unary_executor.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/planner/logical_operator.hpp"
#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/types.h"

namespace fb = flatbuffers;

namespace duckdb_webapi {

#define LOGICAL_OPERATOR_TYPES \
    X(INVALID)                 \
    X(PROJECTION)              \
    X(FILTER)                  \
    X(AGGREGATE_AND_GROUP_BY)  \
    X(WINDOW)                  \
    X(UNNEST)                  \
    X(LIMIT)                   \
    X(ORDER_BY)                \
    X(TOP_N)                   \
    X(COPY_TO_FILE)            \
    X(DISTINCT)                \
    X(GET)                     \
    X(CHUNK_GET)               \
    X(DELIM_GET)               \
    X(EXPRESSION_GET)          \
    X(EMPTY_RESULT)            \
    X(JOIN)                    \
    X(DELIM_JOIN)              \
    X(COMPARISON_JOIN)         \
    X(ANY_JOIN)                \
    X(CROSS_PRODUCT)           \
    X(UNION)                   \
    X(EXCEPT)                  \
    X(INTERSECT)               \
    X(RECURSIVE_CTE)           \
    X(INSERT)                  \
    X(DELETE)                  \
    X(UPDATE)                  \
    X(ALTER)                   \
    X(CREATE_TABLE)            \
    X(CREATE_INDEX)            \
    X(CREATE_SEQUENCE)         \
    X(CREATE_VIEW)             \
    X(CREATE_SCHEMA)           \
    X(DROP)                    \
    X(PRAGMA)                  \
    X(TRANSACTION)             \
    X(EXPLAIN)                 \
    X(PREPARE)                 \
    X(EXECUTE)                 \
    X(VACUUM)

proto::OperatorType MapOperatorType(duckdb::LogicalOperatorType type) {
    using D = duckdb::LogicalOperatorType;
    using P = proto::OperatorType;
    switch (type) {
#define X(NAME)                             \
    case duckdb::LogicalOperatorType::NAME: \
        return proto::OperatorType::NAME;
        LOGICAL_OPERATOR_TYPES
#undef X
        default:
            return proto::OperatorType::INVALID;
    };
    return proto::OperatorType::INVALID;
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

/// Write a fixed-length result column
template <typename T>
static fb::Offset<proto::Vector> writeCol(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                          duckdb::VectorData &vec, size_t count) {
    assert(sizeof(T) == duckdb::GetTypeIdSize(type));

    T *values;
    auto d_buf = builder.CreateUninitializedVector(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        values = GetMutableTemporaryPointer(builder, d_buf)->data();  // n_buf invalidates values
        iterVec<T, true>(vec, count, [&](unsigned i, T value, bool null) {
            values[i] = value;
            nullmask[i] = null;
        });
    } else {
        iterVec<T, false>(vec, count, [&](unsigned i, T value, bool null) { values[i] = value; });
    }

    // Build the query result column
    fb::Offset<proto::Vector> wrapper;
    auto build = [&](auto &v, auto vt) {
        if (n_buf) v.add_null_mask(*n_buf);
        auto ofs = v.Finish();
        proto::VectorBuilder w{builder};
        w.add_variant(ofs.Union());
        w.add_variant_type(vt);
        wrapper = w.Finish();
    };
    if constexpr (std::is_same_v<T, int8_t>) {
        proto::VectorI8Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorI8);
    } else if constexpr (std::is_same_v<T, uint8_t>) {
        proto::VectorU8Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorU8);
    } else if constexpr (std::is_same_v<T, uint16_t>) {
        proto::VectorU16Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorU16);
    } else if constexpr (std::is_same_v<T, int16_t>) {
        proto::VectorI16Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorI16);
    } else if constexpr (std::is_same_v<T, uint32_t>) {
        proto::VectorU32Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorU32);
    } else if constexpr (std::is_same_v<T, int32_t>) {
        proto::VectorI32Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorI32);
    } else if constexpr (std::is_same_v<T, uint64_t>) {
        proto::VectorU64Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorU64);
    } else if constexpr (std::is_same_v<T, int64_t>) {
        proto::VectorI64Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorI64);
    } else if constexpr (std::is_same_v<T, float>) {
        proto::VectorF32Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorF32);
    } else if constexpr (std::is_same_v<T, double>) {
        proto::VectorF64Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, proto::VectorVariant::VectorF64);
    } else {
        assert(false);
    }
    return wrapper;
}

/// Write a fixed-length result column
static fb::Offset<proto::Vector> writeI128Col(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                              duckdb::VectorData &vec, size_t count) {
    proto::I128 *values;
    auto d_buf = builder.CreateUninitializedVectorOfStructs(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        iterVec<hugeint_t, true>(vec, count, [&](unsigned i, hugeint_t value, bool null) {
            values[i] = proto::I128{value.lower, value.upper};
            nullmask[i] = null;
        });
    } else {
        iterVec<hugeint_t, false>(vec, count, [&](unsigned i, hugeint_t value, bool null) {
            values[i] = proto::I128{value.lower, value.upper};
        });
    }

    // Build the query result column
    proto::VectorI128Builder v_i128_b{builder};
    if (n_buf) v_i128_b.add_null_mask(*n_buf);
    v_i128_b.add_values(d_buf);
    auto v_i128 = v_i128_b.Finish();
    proto::VectorBuilder v{builder};
    v.add_variant(v_i128.Union());
    v.add_variant_type(proto::VectorVariant::VectorI128);
    return v.Finish();
}

/// Write a interval result column
static fb::Offset<proto::Vector> writeIntervalCol(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                                  duckdb::VectorData &vec, size_t count) {
    proto::Interval *values;
    auto d_buf = builder.CreateUninitializedVectorOfStructs(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;
    assert(type == duckdb::PhysicalType::INTERVAL);

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        iterVec<interval_t, true>(vec, count, [&](unsigned i, interval_t value, bool null) {
            values[i] = proto::Interval{value.months, value.days, value.msecs};
            nullmask[i] = null;
        });
    } else {
        iterVec<interval_t, false>(vec, count, [&](unsigned i, interval_t value, bool null) {
            values[i] = proto::Interval{value.months, value.days, value.msecs};
        });
    }

    // Build the query result column
    proto::VectorIntervalBuilder v_interval_b{builder};
    if (n_buf) v_interval_b.add_null_mask(*n_buf);
    v_interval_b.add_values(d_buf);
    auto v_interval = v_interval_b.Finish();
    proto::VectorBuilder v{builder};
    v.add_variant(v_interval.Union());
    v.add_variant_type(proto::VectorVariant::VectorInterval);
    return v.Finish();
}

/// Write a string result column
static fb::Offset<proto::Vector> writeStringCol(fb::FlatBufferBuilder &builder, duckdb::VectorData &vec, size_t count) {
    // First collect string views and copy nulls (if any)
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;
    std::vector<std::string_view> strings{count};
    auto *source = reinterpret_cast<const duckdb::string_t *>(vec.data);
    using ST = std::string_view::size_type;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        auto n = builder.CreateUninitializedVector(count, &nullmask);

        // Has selection vector?
        if (vec.sel) {
            for (unsigned i = 0; i < count; ++i) {
                auto si = vec.sel->get_index(i);
                auto &s = source[si];
                nullmask[i] = (*vec.nullmask)[si];
                strings[i] = std::string_view{s.GetData(), static_cast<ST>(s.GetSize())};
            }
        } else {
            for (unsigned i = 0; i < count; ++i) {
                auto &s = source[i];
                nullmask[i] = (*vec.nullmask)[i];
                strings[i] = std::string_view{s.GetData(), static_cast<ST>(s.GetSize())};
            }
        }
    } else {
        // Has selection vector?
        if (vec.sel) {
            for (unsigned i = 0; i < count; ++i) {
                auto si = vec.sel->get_index(i);
                auto &s = source[si];
                strings[i] = std::string_view{s.GetData(), static_cast<ST>(s.GetSize())};
            }
        } else {
            for (unsigned i = 0; i < count; ++i) {
                auto &s = source[i];
                strings[i] = std::string_view{s.GetData(), static_cast<ST>(s.GetSize())};
            }
        }
    }

    // Copy all strings
    std::vector<fb::Offset<fb::String>> s_ofs;
    for (auto &s : strings) s_ofs.push_back(builder.CreateString(s.data(), s.length()));
    auto d_buf = builder.CreateVector(s_ofs);

    // Build string vector
    proto::VectorStringBuilder v_sb{builder};
    v_sb.add_values(d_buf);
    if (n_buf) v_sb.add_null_mask(*n_buf);
    auto v_sb_ofs = v_sb.Finish();
    proto::VectorBuilder v_b{builder};
    v_b.add_variant(v_sb_ofs.Union());
    v_b.add_variant_type(proto::VectorVariant::VectorString);
    return v_b.Finish();
}

/// Write the query result chunk
fb::Offset<proto::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder &builder, uint64_t queryID,
                                                          duckdb::DataChunk *chunkPtr,
                                                          nonstd::span<duckdb::LogicalType> types) {
    duckdb::DataChunk tmp;
    auto &chunk = (!!chunkPtr) ? *chunkPtr : tmp;
    auto size = chunk.size();
    auto vectors = chunk.Orrify();

    // Write chunk columns
    std::vector<fb::Offset<proto::Vector>> columns;
    for (size_t column_id = 0; column_id < chunk.column_count(); ++column_id) {
        auto l_Type = types[column_id];
        auto p_type = l_Type.InternalType();
        auto vec = vectors.get()[column_id];

        // Ref: src/common/types.cpp
        // We only need to encode types that are actually used in LogicalType::GetInternalType.
        // We try to catch this via tests.

        // Write result column
        auto column = [&]() -> fb::Offset<proto::Vector> {
            switch (p_type) {
                case duckdb::PhysicalType::INT8:
                    return writeCol<int8_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT16:
                    return writeCol<int16_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT32:
                    return writeCol<int32_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT64:
                    return writeCol<int64_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT128:
                    return writeI128Col(builder, p_type, vec, size);
                case duckdb::PhysicalType::FLOAT:
                    return writeCol<float>(builder, p_type, vec, size);
                case duckdb::PhysicalType::DOUBLE:
                    return writeCol<double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INTERVAL:
                    return writeIntervalCol(builder, p_type, vec, size);

                case duckdb::PhysicalType::VARCHAR:
                case duckdb::PhysicalType::STRING:
                    return writeStringCol(builder, vec, size);

                case duckdb::PhysicalType::BOOL:
                case duckdb::PhysicalType::VARBINARY:
                case duckdb::PhysicalType::STRUCT:
                case duckdb::PhysicalType::LIST:
                default:
                    throw Exception{ET::NOT_IMPLEMENTED, "unsupported physical type"};
            }
            return {};
        }();

        // Push new chunk column
        columns.push_back(column);
    }
    auto column_offset = builder.CreateVector(columns);

    // Build result chunk
    proto::QueryResultChunkBuilder chunk_builder{builder};
    chunk_builder.add_query_id(queryID);
    chunk_builder.add_row_count(size);
    chunk_builder.add_columns(column_offset);
    return chunk_builder.Finish();
}

/// Write the query result
fb::Offset<proto::QueryResult> WriteQueryResult(fb::FlatBufferBuilder &builder, duckdb::QueryResult &result,
                                                uint64_t queryID, bool async) {
    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<proto::QueryResultChunk>> chunks;
    if (!async) {
        for (auto chunk = result.Fetch(); !!chunk && chunk->size() > 0; chunk = result.Fetch())
            chunks.push_back(WriteQueryResultChunk(builder, queryID, chunk.get(), result.types));
    }
    auto data_chunks = builder.CreateVector(chunks);

    // Write column types
    fb::Offset<fb::Vector<const proto::SQLType *>> columnTypes;
    {
        proto::SQLType *writer;
        columnTypes = builder.CreateUninitializedVectorOfStructs<proto::SQLType>(result.types.size(), &writer);
        for (size_t i = 0; i < result.types.size(); ++i) {
            auto t = result.types[i];
            writer[i] = proto::SQLType{
                static_cast<proto::SQLTypeID>(t.id()),
                t.width(),
                t.scale(),
            };
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result.names);

    // Write the query result
    proto::QueryResultBuilder result_builder{builder};
    result_builder.add_query_id(queryID);
    result_builder.add_column_names(columnNames);
    result_builder.add_column_types(columnTypes);
    if (!async) result_builder.add_data_chunks(data_chunks);
    return result_builder.Finish();
}

/// Write the query plan
fb::Offset<proto::QueryPlan> WriteQueryPlan(fb::FlatBufferBuilder &builder, duckdb::LogicalOperator &plan) {
    // Remember the children
    std::vector<duckdb::LogicalOperator *> operators;
    std::vector<std::tuple<size_t, size_t>> op_child_edges;
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
            op_child_edges.push_back({targetID, childID});
        }
    }

    fb::Offset<fb::Vector<uint8_t>> op_type_vec;
    fb::Offset<fb::Vector<uint64_t>> op_child_vec;
    fb::Offset<fb::Vector<uint64_t>> op_child_ofs_vec;

    // Write operator types
    {
        uint8_t *writer;
        op_type_vec = builder.CreateUninitializedVector<uint8_t>(operators.size(), &writer);
        for (size_t i = 0; i < operators.size(); ++i)
            writer[i] = static_cast<uint8_t>(MapOperatorType(operators[i]->type));
    }

    // Write the children
    {
        // Encode children
        std::vector<size_t> op_children;
        std::vector<size_t> op_child_offsets;
        std::sort(op_child_edges.begin(), op_child_edges.end(),
                  [&](auto &l, auto &r) { return std::get<0>(l) < std::get<0>(r); });
        op_child_offsets.resize(operators.size(), 0);

        auto edge_iter = op_child_edges.begin();
        for (auto oid = 0; oid < operators.size(); ++oid) {
            op_child_offsets[oid] = op_children.size();

            // Reached end?
            if (edge_iter == op_child_edges.end()) continue;

            // At parent of next edge?
            auto &[parent, child] = *edge_iter;
            if (oid != parent) continue;

            // Store children
            op_children.push_back(child);
            edge_iter++;
            for (; edge_iter != op_child_edges.end(); ++edge_iter) {
                auto &[nextParent, nextChild] = *edge_iter;
                if (oid != nextParent) {
                    break;
                } else {
                    op_children.push_back(nextChild);
                }
            }
        }

        // Write children
        uint64_t *writer;
        op_child_vec = builder.CreateUninitializedVector<uint64_t>(op_children.size(), &writer);
        for (size_t i = 0; i < op_children.size(); ++i) {
            writer[i] = static_cast<size_t>(op_children[i]);
        }

        // Write child offsets
        op_child_ofs_vec = builder.CreateUninitializedVector<uint64_t>(op_child_offsets.size(), &writer);
        for (size_t i = 0; i < op_child_offsets.size(); ++i) {
            writer[i] = static_cast<size_t>(op_child_offsets[i]);
        }
    }

    // Write the query result
    proto::QueryPlanBuilder plan_builder{builder};
    plan_builder.add_operator_types(op_type_vec);
    plan_builder.add_operator_children(op_child_vec);
    plan_builder.add_operator_child_offsets(op_child_ofs_vec);
    return plan_builder.Finish();
}

}  // namespace duckdb_webapi

