// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/codec.h"

#include <flatbuffers/flatbuffers.h>

#include <iostream>

#include "dashql/proto_generated.h"
#include "duckdb/common/vector_operations/unary_executor.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/planner/logical_operator.hpp"

namespace fb = flatbuffers;
namespace p = dashql::proto::webdb;
using namespace duckdb;

namespace dashql {
namespace webdb {

#define LOGICAL_OPERATOR_TYPES        \
    X(LOGICAL_INVALID)                \
    X(LOGICAL_PROJECTION)             \
    X(LOGICAL_FILTER)                 \
    X(LOGICAL_AGGREGATE_AND_GROUP_BY) \
    X(LOGICAL_WINDOW)                 \
    X(LOGICAL_UNNEST)                 \
    X(LOGICAL_LIMIT)                  \
    X(LOGICAL_ORDER_BY)               \
    X(LOGICAL_TOP_N)                  \
    X(LOGICAL_COPY_TO_FILE)           \
    X(LOGICAL_DISTINCT)               \
    X(LOGICAL_GET)                    \
    X(LOGICAL_CHUNK_GET)              \
    X(LOGICAL_DELIM_GET)              \
    X(LOGICAL_EXPRESSION_GET)         \
    X(LOGICAL_DUMMY_SCAN)             \
    X(LOGICAL_EMPTY_RESULT)           \
    X(LOGICAL_CTE_REF)                \
    X(LOGICAL_JOIN)                   \
    X(LOGICAL_DELIM_JOIN)             \
    X(LOGICAL_COMPARISON_JOIN)        \
    X(LOGICAL_ANY_JOIN)               \
    X(LOGICAL_CROSS_PRODUCT)          \
    X(LOGICAL_UNION)                  \
    X(LOGICAL_EXCEPT)                 \
    X(LOGICAL_INTERSECT)              \
    X(LOGICAL_RECURSIVE_CTE)          \
    X(LOGICAL_INSERT)                 \
    X(LOGICAL_DELETE)                 \
    X(LOGICAL_UPDATE)                 \
    X(LOGICAL_ALTER)                  \
    X(LOGICAL_CREATE_TABLE)           \
    X(LOGICAL_CREATE_INDEX)           \
    X(LOGICAL_CREATE_SEQUENCE)        \
    X(LOGICAL_CREATE_VIEW)            \
    X(LOGICAL_CREATE_SCHEMA)          \
    X(LOGICAL_CREATE_MACRO)           \
    X(LOGICAL_DROP)                   \
    X(LOGICAL_PRAGMA)                 \
    X(LOGICAL_TRANSACTION)            \
    X(LOGICAL_EXPLAIN)                \
    X(LOGICAL_PREPARE)                \
    X(LOGICAL_EXECUTE)                \
    X(LOGICAL_EXPORT)                 \
    X(LOGICAL_VACUUM)

p::OperatorType MapOperatorType(duckdb::LogicalOperatorType type) {
    using D = duckdb::LogicalOperatorType;
    using P = p::OperatorType;
    switch (type) {
#define X(NAME)                             \
    case duckdb::LogicalOperatorType::NAME: \
        return p::OperatorType::NAME;
        LOGICAL_OPERATOR_TYPES
#undef X
        default:
            return p::OperatorType::LOGICAL_INVALID;
    };
    return p::OperatorType::LOGICAL_INVALID;
}

/// Write a fixed-length result column
template <typename VecType, typename FlatbufferType>
static fb::Offset<p::Vector> writeCol(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                      duckdb::VectorData &vec, size_t count) {
    assert(sizeof(VecType) == duckdb::GetTypeIdSize(type));

    FlatbufferType *values;
    auto d_buf = builder.CreateUninitializedVector(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        values = GetMutableTemporaryPointer(builder, d_buf)->data();  // n_buf invalidates values
        iterateVector<VecType, true>(vec, count, [&](unsigned i, VecType value, bool null) {
            values[i] = value;
            nullmask[i] = null;
        });
    } else {
        iterateVector<VecType, false>(vec, count, [&](unsigned i, VecType value, bool null) { values[i] = value; });
    }

    // Build the query result column
    fb::Offset<p::Vector> wrapper;
    auto build = [&](auto &v, auto vt) {
        if (n_buf) v.add_null_mask(*n_buf);
        auto ofs = v.Finish();
        p::VectorBuilder w{builder};
        w.add_variant(ofs.Union());
        w.add_variant_type(vt);
        wrapper = w.Finish();
    };
    if constexpr (std::is_same_v<FlatbufferType, uint8_t>) {
        p::VectorU8Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, p::VectorVariant::VectorU8);
    } else if constexpr (std::is_same_v<FlatbufferType, int64_t>) {
        p::VectorI64Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, p::VectorVariant::VectorI64);
    } else if constexpr (std::is_same_v<FlatbufferType, double>) {
        p::VectorF64Builder vec{builder};
        vec.add_values(d_buf);
        build(vec, p::VectorVariant::VectorF64);
    } else {
        assert(false);
    }
    return wrapper;
}

/// Write a fixed-length result column
static fb::Offset<p::Vector> writeI128Col(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                          duckdb::VectorData &vec, size_t count) {
    p::I128 *values;
    auto d_buf = builder.CreateUninitializedVectorOfStructs(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        iterateVector<hugeint_t, true>(vec, count, [&](unsigned i, hugeint_t value, bool null) {
            values[i] = p::I128{value.lower, value.upper};
            nullmask[i] = null;
        });
    } else {
        iterateVector<hugeint_t, false>(vec, count, [&](unsigned i, hugeint_t value, bool null) {
            values[i] = p::I128{value.lower, value.upper};
        });
    }

    // Build the query result column
    p::VectorI128Builder v_i128_b{builder};
    if (n_buf) v_i128_b.add_null_mask(*n_buf);
    v_i128_b.add_values(d_buf);
    auto v_i128 = v_i128_b.Finish();
    p::VectorBuilder v{builder};
    v.add_variant(v_i128.Union());
    v.add_variant_type(p::VectorVariant::VectorI128);
    return v.Finish();
}

/// Write a interval result column
static fb::Offset<p::Vector> writeIntervalCol(fb::FlatBufferBuilder &builder, duckdb::PhysicalType type,
                                              duckdb::VectorData &vec, size_t count) {
    p::Interval *values;
    auto d_buf = builder.CreateUninitializedVectorOfStructs(count, &values);
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;
    assert(type == duckdb::PhysicalType::INTERVAL);

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        iterateVector<interval_t, true>(vec, count, [&](unsigned i, interval_t value, bool null) {
            values[i] = p::Interval{value.months, value.days, value.micros};
            nullmask[i] = null;
        });
    } else {
        iterateVector<interval_t, false>(vec, count, [&](unsigned i, interval_t value, bool null) {
            values[i] = p::Interval{value.months, value.days, value.micros};
        });
    }

    // Build the query result column
    p::VectorIntervalBuilder v_interval_b{builder};
    if (n_buf) v_interval_b.add_null_mask(*n_buf);
    v_interval_b.add_values(d_buf);
    auto v_interval = v_interval_b.Finish();
    p::VectorBuilder v{builder};
    v.add_variant(v_interval.Union());
    v.add_variant_type(p::VectorVariant::VectorInterval);
    return v.Finish();
}

/// Write a string result column
static fb::Offset<p::Vector> writeStringCol(fb::FlatBufferBuilder &builder, duckdb::VectorData &vec, size_t count) {
    // First collect string views and copy nulls (if any)
    std::optional<fb::Offset<fb::Vector<uint8_t>>> n_buf = std::nullopt;
    std::vector<std::string_view> strings{count};
    using ST = std::string_view::size_type;

    // Has null mask?
    if (vec.nullmask) {
        uint8_t *nullmask;
        n_buf = builder.CreateUninitializedVector(count, &nullmask);
        iterateVector<duckdb::string_t, true>(vec, count, [&](unsigned i, duckdb::string_t &value, bool null) {
            nullmask[i] = null;
            strings[i] = std::string_view{value.GetDataUnsafe(), static_cast<ST>(value.GetSize())};
        });
    } else {
        iterateVector<duckdb::string_t, false>(vec, count, [&](unsigned i, duckdb::string_t &value, bool null) {
            strings[i] = std::string_view{value.GetDataUnsafe(), static_cast<ST>(value.GetSize())};
        });
    }

    // Copy all strings
    std::vector<fb::Offset<fb::String>> s_ofs;
    for (auto &s : strings) s_ofs.push_back(builder.CreateString(s.data(), s.length()));
    auto d_buf = builder.CreateVector(s_ofs);

    // Build string vector
    p::VectorStringBuilder v_sb{builder};
    v_sb.add_values(d_buf);
    if (n_buf) v_sb.add_null_mask(*n_buf);
    auto v_sb_ofs = v_sb.Finish();
    p::VectorBuilder v_b{builder};
    v_b.add_variant(v_sb_ofs.Union());
    v_b.add_variant_type(p::VectorVariant::VectorString);
    return v_b.Finish();
}

/// Write the query result chunk
fb::Offset<p::QueryResultChunk> WriteQueryResultChunk(flatbuffers::FlatBufferBuilder &builder,
                                                      duckdb::QueryResult &result, uint64_t queryID,
                                                      duckdb::DataChunk *chunkPtr) {
    duckdb::DataChunk tmp;
    auto &chunk = (!!chunkPtr) ? *chunkPtr : tmp;
    auto size = chunk.size();
    auto vectors = chunk.Orrify();

    // Write chunk columns
    std::vector<fb::Offset<p::Vector>> columns;
    for (size_t column_id = 0; column_id < chunk.ColumnCount(); ++column_id) {
        auto l_Type = result.types[column_id];
        auto p_type = l_Type.InternalType();
        auto vec = vectors.get()[column_id];

        // Ref: src/common/types.cpp
        // We only need to encode types that are actually used in LogicalType::GetInternalType.
        // We try to catch this via tests.

        // Write result column
        auto column = [&]() -> fb::Offset<p::Vector> {
            switch (p_type) {
                case duckdb::PhysicalType::BOOL:
                    // XXX It would be rather easy to bitpack booleans into u8 vectors, implement later
                    //     (Iterator must not assume vector.size() == row_count)
                    return writeCol<bool, uint8_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT8:
                    return writeCol<int8_t, double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT16:
                    return writeCol<int16_t, double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT32:
                    return writeCol<int32_t, double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT64:
                    return writeCol<int64_t, int64_t>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INT128:
                    return writeI128Col(builder, p_type, vec, size);
                case duckdb::PhysicalType::FLOAT:
                    return writeCol<float, double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::DOUBLE:
                    return writeCol<double, double>(builder, p_type, vec, size);
                case duckdb::PhysicalType::INTERVAL:
                    return writeIntervalCol(builder, p_type, vec, size);
                case duckdb::PhysicalType::VARCHAR:
                case duckdb::PhysicalType::STRING:
                    return writeStringCol(builder, vec, size);
                default:
                    assert(false);
                    /// XXX
            }
            return {};
        }();

        // Push new chunk column
        columns.push_back(column);
    }
    auto column_offset = builder.CreateVector(columns);

    // Build result chunk
    p::QueryResultChunkBuilder chunk_builder{builder};
    chunk_builder.add_query_id(queryID);
    chunk_builder.add_row_count(size);
    chunk_builder.add_columns(column_offset);
    return chunk_builder.Finish();
}

/// Write the query result
fb::Offset<p::QueryResult> WriteQueryResult(fb::FlatBufferBuilder &builder, duckdb::QueryResult &result,
                                            uint64_t queryID, ChunkVectorOffset data_chunks) {
    // Write column types
    fb::Offset<fb::Vector<const p::SQLType *>> columnTypes;
    {
        p::SQLType *writer;
        columnTypes = builder.CreateUninitializedVectorOfStructs<p::SQLType>(result.types.size(), &writer);
        for (size_t i = 0; i < result.types.size(); ++i) {
            auto t = result.types[i];
            writer[i] = p::SQLType{
                static_cast<p::SQLTypeID>(t.id()),
                t.width(),
                t.scale(),
            };
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result.names);

    // Write the query result
    p::QueryResultBuilder result_builder{builder};
    result_builder.add_query_id(queryID);
    result_builder.add_column_names(columnNames);
    result_builder.add_column_types(columnTypes);
    result_builder.add_data_chunks(data_chunks);
    return result_builder.Finish();
}

/// Write the query plan
fb::Offset<p::QueryPlan> WriteQueryPlan(fb::FlatBufferBuilder &builder, duckdb::LogicalOperator &plan) {
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
                auto &[next_parent, next_child] = *edge_iter;
                if (oid != next_parent) {
                    break;
                } else {
                    op_children.push_back(next_child);
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
    p::QueryPlanBuilder plan_builder{builder};
    plan_builder.add_operator_types(op_type_vec);
    plan_builder.add_operator_children(op_child_vec);
    plan_builder.add_operator_child_offsets(op_child_ofs_vec);
    return plan_builder.Finish();
}

}  // namespace webdb
}  // namespace dashql
