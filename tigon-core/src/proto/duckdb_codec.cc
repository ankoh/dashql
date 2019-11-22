//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/proto/duckdb_codec.h"
#include "duckdb/common/vector_operations/vector_operations.hpp"

namespace protobuf = google::protobuf;

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

static proto::duckdb::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type) {
    using D = duckdb::LogicalOperatorType;
    using P = proto::duckdb::LogicalOperatorType;
    switch (type) {
#define X(NAME) case D::NAME: return P::OP_##NAME;
    LOGICAL_OPERATOR_TYPES
#undef X
    };
    return P::OP_INVALID;
}

/// Write the query plan
proto::duckdb::QueryPlan* encodeQueryPlan(protobuf::Arena& arena, duckdb::LogicalOperator& planRoot) {
    auto* plan = protobuf::Arena::CreateMessage<proto::duckdb::QueryPlan>(&arena);

    // Remember the children
    std::vector<duckdb::LogicalOperator*> operators;
    std::vector<std::tuple<size_t, size_t>> operatorChildEdges;
    operators.push_back(&planRoot);

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

    // Write operator types
    auto* opTypes = plan->mutable_operator_types();
    opTypes->Reserve(operators.size());
    for (size_t i = 0; i < operators.size(); ++i) {
        opTypes->Add(static_cast<uint8_t>(mapOperatorType(operators[i]->type)));
    }

    // Encode children 
    auto* opChildren = plan->mutable_operator_children();
    auto* opChildOffsets = plan->mutable_operator_child_offsets();
    opChildOffsets->Reserve(operators.size());
    std::sort(operatorChildEdges.begin(), operatorChildEdges.end(), [&](auto& l, auto& r) {
        return std::get<0>(l) < std::get<0>(r);
    });

    auto edgeIter = operatorChildEdges.begin();
    for (auto oid = 0; oid < operators.size(); ++oid) {
        opChildOffsets->Add(opChildren->size());

        // Reached end?
        if (edgeIter == operatorChildEdges.end()) { continue; }

        // At parent of next edge?
        auto& [parent, child] = *edgeIter;
        if (oid != parent) { continue; }

        // Store children 
        opChildren->Add(child);
        edgeIter++;
        for (; edgeIter != operatorChildEdges.end(); ++edgeIter) {
            auto& [nextParent, nextChild] = *edgeIter;
            if (oid != nextParent) {
                break;
            } else {
                opChildren->Add(nextChild);
            }
        }
    }

    return plan;
}
  
/// Write a fixed-length res column
template <typename DUCKDB_TYPE, typename PROTO_TYPE>
static void encodeNumericColumn(protobuf::Arena& arena, proto::duckdb::QueryResultColumn* column, duckdb::Vector &vec) {
    // Create column
    column->set_type_id(static_cast<proto::duckdb::RawTypeID>(vec.type));

    // Create nullmask buffer
    auto* nullmask = column->mutable_null_mask();
    nullmask->Reserve(vec.count);

    // Create data buffer
    protobuf::RepeatedField<PROTO_TYPE>* data;
    if constexpr (std::is_same_v<PROTO_TYPE, int32_t>) {
        data = column->mutable_rows_i32();
    } else if constexpr (std::is_same_v<PROTO_TYPE, uint32_t>) {
        data = column->mutable_rows_u32();
    } else if constexpr (std::is_same_v<PROTO_TYPE, int64_t>) {
        data = column->mutable_rows_i64();
    } else if constexpr (std::is_same_v<PROTO_TYPE, uint64_t>) {
        data = column->mutable_rows_u64();
    } else if constexpr (std::is_same_v<PROTO_TYPE, float>) {
        data = column->mutable_rows_f32();
    } else if constexpr (std::is_same_v<PROTO_TYPE, double>) {
        data = column->mutable_rows_f64();
    } else {
        return;
    }
    data->Reserve(vec.count);

    // Run the vector operations
    duckdb::VectorOperations::Exec(vec.sel_vector, 0, [&](duckdb::index_t i, duckdb::index_t k) {
        nullmask->Add(vec.nullmask[i]);
        data->Add(reinterpret_cast<DUCKDB_TYPE*>(vec.data)[i]);
    }, 0);
}

/// Write a fixed-length res column
static void encodeStringColumn(protobuf::Arena& arena, proto::duckdb::QueryResultColumn* column, duckdb::Vector &vec) {
    column->set_type_id(static_cast<proto::duckdb::RawTypeID>(vec.type));

    // Create nullmask buffer
    auto* nullmask = column->mutable_null_mask();
    nullmask->Reserve(vec.count);

    // Create data buffer
    auto data = column->mutable_rows_str();
    data->Reserve(vec.count);

    // Run the vector operations
    duckdb::VectorOperations::Exec(vec.sel_vector, 0, [&](duckdb::index_t i, duckdb::index_t k) {
        nullmask->Add(vec.nullmask[i]);
        auto s = reinterpret_cast<char**>(vec.data)[i];
        data->Add()->assign(s);
    }, 0);
}

/// Write the query result
proto::duckdb::QueryResult* encodeQueryResult(protobuf::Arena& arena, duckdb::QueryResult& queryResult, uint64_t queryID) {
    auto* res = protobuf::Arena::CreateMessage<proto::duckdb::QueryResult>(&arena);
    auto* chunks = res->mutable_data_chunks();
    uint32_t rowCount = 0;
    uint32_t colCount = 0;
    res->set_query_id(queryID);

    // Fetch res rows and immediately write them into a flatbuffer
    for (auto c = queryResult.Fetch(); !!c && c->size() > 0; c = queryResult.Fetch()) {
        rowCount += c->size();
        colCount = colCount;

        // Build res chunk
        auto* chunk = chunks->Add();
        auto* cols = chunk->mutable_columns();
        cols->Reserve(c->column_count);

        // Write chunk cols
        for (size_t v = 0; v < c->column_count; ++v) {
            auto &vec = c->GetVector(v);
            auto* column = cols->Add();
            switch (vec.type) {
            case duckdb::TypeId::INVALID:
            case duckdb::TypeId::VARBINARY:
                // TODO
                break;
            case duckdb::TypeId::BOOLEAN:
                encodeNumericColumn<int8_t, int32_t>(arena, column, vec);
                break;
            case duckdb::TypeId::TINYINT:
                encodeNumericColumn<int16_t, int32_t>(arena, column, vec);
                break;
            case duckdb::TypeId::SMALLINT:
                encodeNumericColumn<int32_t, int32_t>(arena, column, vec);
                break;
            case duckdb::TypeId::INTEGER:
                encodeNumericColumn<int64_t, int64_t>(arena, column, vec);
                break;
            case duckdb::TypeId::BIGINT:
                encodeNumericColumn<int64_t, int64_t>(arena, column, vec);
                break;
            case duckdb::TypeId::POINTER:
                encodeNumericColumn<uint64_t, uint64_t>(arena, column, vec);
                break;
            case duckdb::TypeId::HASH:
                encodeNumericColumn<uint64_t, uint64_t>(arena, column, vec);
                break;
            case duckdb::TypeId::FLOAT:
                encodeNumericColumn<float, float>(arena, column, vec);
                break;
            case duckdb::TypeId::DOUBLE:
                encodeNumericColumn<double, double>(arena, column, vec);
                break;
            case duckdb::TypeId::VARCHAR:
                encodeStringColumn(arena, column, vec);
                break;
            }
        }
    }

    // Write row and column count
    res->set_column_count(colCount);
    res->set_row_count(rowCount);

    // Write column types
    auto* rawTypes = res->mutable_column_raw_types();
    rawTypes->Reserve(queryResult.types.size());
    for (size_t i = 0; i < queryResult.types.size(); ++i) {
        rawTypes->Add(static_cast<uint8_t>(queryResult.types[i]));
    }

    // Write column sql types
    auto* sqlTypes = res->mutable_column_sql_types();
    sqlTypes->Reserve(queryResult.sql_types.size());
    for (size_t i = 0; i < queryResult.sql_types.size(); ++i) {
        auto* sqlType = sqlTypes->Add();
        sqlType->set_type_id(static_cast<proto::duckdb::SQLTypeID>(queryResult.sql_types[i].id));
        sqlType->set_width(queryResult.sql_types[i].width);
        sqlType->set_scale(queryResult.sql_types[i].scale);
    }
    
    // Write column names
    auto* names = res->mutable_column_names();
    names->Reserve(queryResult.names.size());
    for (auto& name: queryResult.names) {
        names->Add()->assign(name);
    }

    // Return result
    return res;
}

}  // namespace tigon
