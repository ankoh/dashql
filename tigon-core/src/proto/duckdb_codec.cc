//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/duckdb_codec.h"
#include "common/vector_operations/vector_operations.hpp"

namespace fb = flatbuffers;

namespace tigon {

#define LOGICAL_OPERATOR_TYPES \
    X(INVALID) \
    X(PROJECTION) \
    X(FILTER) \
    X(AGGREGATE_AND_GROUP_BY) \
    X(WINDOW) \
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
    X(SUBQUERY) \
    X(EMPTY_RESULT) \
    X(JOIN) \
    X(DELIM_JOIN) \
    X(COMPARISON_JOIN) \
    X(ANY_JOIN) \
    X(CROSS_PRODUCT) \
    X(UNION) \
    X(EXCEPT) \
    X(INTERSECT) \
    X(INSERT) \
    X(DELETE) \
    X(UPDATE) \
    X(CREATE_TABLE) \
    X(CREATE_INDEX) \
    X(EXPLAIN) \
    X(PRUNE_COLUMNS) \
    X(PREPARE) \
    X(EXECUTE)

proto::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type) {
    using D = duckdb::LogicalOperatorType;
    using P = proto::LogicalOperatorType;
    switch (type) {
#define X(NAME) case duckdb::LogicalOperatorType::NAME: return proto::LogicalOperatorType::NAME;
    LOGICAL_OPERATOR_TYPES
#undef X
    };
    return proto::LogicalOperatorType::INVALID;
}


/// Write a fixed-length result column
template <typename T>
static fb::Offset<proto::QueryResultColumn> writeFixedLengthResultColumn(fb::FlatBufferBuilder &builder, duckdb::Vector &vec) {
    uint8_t *nullmask;
    uint8_t *data;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    auto d = builder.CreateUninitializedVector(vec.count, sizeof(T), &data);
    duckdb::VectorOperations::Exec(vec.sel_vector, 0, [&](duckdb::index_t i, duckdb::index_t k) {
        nullmask[k] = vec.nullmask[i];
        reinterpret_cast<T *>(data)[k] = vec.data[i];
    }, 0);
    proto::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<proto::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_fixed_length_data(d);
    return c.Finish();
}

/// Write a string result column
static fb::Offset<proto::QueryResultColumn> writeStringResultColumn(fb::FlatBufferBuilder &builder, duckdb::Vector &vec) {
    uint8_t *nullmask;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    builder.StartVector(vec.count, sizeof(fb::Offset<fb::String>));
    auto **source = reinterpret_cast<const char **>(vec.data);
    for (size_t i = 0; i < vec.count; ++i) {
        nullmask[i] = source[i] == nullptr;
        builder.PushElement(builder.CreateString(source[i]));
    }
    proto::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<proto::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_string_data({builder.EndVector(vec.count)});
    return c.Finish();
}

/// Write the query result
fb::Offset<proto::QueryResult> writeQueryResult(fb::FlatBufferBuilder& builder, duckdb::QueryResult& result, uint64_t queryID) {

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<proto::QueryResultChunk>> chunks;
    for (auto chunk = result.Fetch(); !!chunk && chunk->size() > 0; chunk = result.Fetch()) {
        // Write chunk columns
        std::vector<fb::Offset<proto::QueryResultColumn>> columns;
        for (size_t v = 0; v < chunk->column_count; ++v) {
            auto &vec = chunk->GetVector(v);

            // Write result column
            fb::Offset<proto::QueryResultColumn> column;
            switch (vec.type) {
            case duckdb::TypeId::INVALID:
            case duckdb::TypeId::VARBINARY:
                // TODO
                break;
            case duckdb::TypeId::BOOLEAN:
                column = writeFixedLengthResultColumn<bool>(builder, vec);
                break;
            case duckdb::TypeId::TINYINT:
                column = writeFixedLengthResultColumn<int16_t>(builder, vec);
                break;
            case duckdb::TypeId::SMALLINT:
                column = writeFixedLengthResultColumn<int32_t>(builder, vec);
                break;
            case duckdb::TypeId::INTEGER:
                column = writeFixedLengthResultColumn<int64_t>(builder, vec);
                break;
            case duckdb::TypeId::BIGINT:
                column = writeFixedLengthResultColumn<int64_t>(builder, vec);
                break;
            case duckdb::TypeId::POINTER:
                column = writeFixedLengthResultColumn<uint64_t>(builder, vec);
                break;
            case duckdb::TypeId::HASH:
                column = writeFixedLengthResultColumn<uint64_t>(builder, vec);
                break;
            case duckdb::TypeId::FLOAT:
                column = writeFixedLengthResultColumn<float>(builder, vec);
                break;
            case duckdb::TypeId::DOUBLE:
                column = writeFixedLengthResultColumn<double>(builder, vec);
                break;
            case duckdb::TypeId::VARCHAR:
                column = writeStringResultColumn(builder, vec);
                break;
            }

            // Push new chunk column
            columns.push_back(column);
        }
        auto columnOffset = builder.CreateVector(columns);

        // Build result chunk
        proto::QueryResultChunkBuilder chunkBuilder{builder};
        chunkBuilder.add_columns(columnOffset);
        chunks.push_back(chunkBuilder.Finish());
    }
    auto dataChunks = builder.CreateVector(chunks);

    // Write column types
    fb::Offset<fb::Vector<uint8_t>> columnRawTypes;
    {
        uint8_t *writer;
        columnRawTypes = builder.CreateUninitializedVector<uint8_t>(result.types.size(), &writer);
        for (size_t i = 0; i < result.types.size(); ++i) {
            writer[i] = static_cast<uint8_t>(result.types[i]);
        }
    }

    // Write column sql types
    fb::Offset<fb::Vector<const proto::SQLType *>> columnSQLTypes;
    {
        proto::SQLType *writer;
        columnSQLTypes = builder.CreateUninitializedVectorOfStructs<proto::SQLType>(result.sql_types.size(), &writer);
        for (size_t i = 0; i < result.sql_types.size(); ++i) {
            writer[i] = proto::SQLType{
                static_cast<proto::SQLTypeID>(result.sql_types[i].id),
                result.sql_types[i].width,
                result.sql_types[i].scale
            };
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result.names);

    // Write the query result
    proto::QueryResultBuilder resultBuilder{builder};
    resultBuilder.add_query_id(queryID);
    resultBuilder.add_column_names(columnNames);
    resultBuilder.add_column_raw_types(columnRawTypes);
    resultBuilder.add_column_sql_types(columnSQLTypes);
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
            if (edgeIter == operatorChildEdges.end()) {
                continue;
            }

            // At parent of next edge?
            auto& [parent, child] = *edgeIter;
            if (oid != parent) {
                continue;
            }

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

}
