//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "duckdb/common/enums/logical_operator_type.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "tigon/proto/duckdb_codec.h"

namespace protobuf = google::protobuf;

namespace tigon {

#define LOGICAL_OPERATOR_TYPES                                                                                                                                                                         \
    X(INVALID)                                                                                                                                                                                         \
    X(PROJECTION)                                                                                                                                                                                      \
    X(FILTER)                                                                                                                                                                                          \
    X(AGGREGATE_AND_GROUP_BY)                                                                                                                                                                          \
    X(WINDOW)                                                                                                                                                                                          \
    X(UNNEST)                                                                                                                                                                                          \
    X(LIMIT)                                                                                                                                                                                           \
    X(ORDER_BY)                                                                                                                                                                                        \
    X(TOP_N)                                                                                                                                                                                           \
    X(COPY_FROM_FILE)                                                                                                                                                                                  \
    X(COPY_TO_FILE)                                                                                                                                                                                    \
    X(DISTINCT)                                                                                                                                                                                        \
    X(INDEX_SCAN)                                                                                                                                                                                      \
                                                                                                                                                                                                       \
    X(GET)                                                                                                                                                                                             \
    X(CHUNK_GET)                                                                                                                                                                                       \
    X(DELIM_GET)                                                                                                                                                                                       \
    X(EXPRESSION_GET)                                                                                                                                                                                  \
    X(TABLE_FUNCTION)                                                                                                                                                                                  \
    X(EMPTY_RESULT)                                                                                                                                                                                    \
    X(CTE_REF)                                                                                                                                                                                         \
                                                                                                                                                                                                       \
    X(JOIN)                                                                                                                                                                                            \
    X(DELIM_JOIN)                                                                                                                                                                                      \
    X(COMPARISON_JOIN)                                                                                                                                                                                 \
    X(ANY_JOIN)                                                                                                                                                                                        \
    X(CROSS_PRODUCT)                                                                                                                                                                                   \
                                                                                                                                                                                                       \
    X(UNION)                                                                                                                                                                                           \
    X(EXCEPT)                                                                                                                                                                                          \
    X(INTERSECT)                                                                                                                                                                                       \
    X(RECURSIVE_CTE)                                                                                                                                                                                   \
                                                                                                                                                                                                       \
    X(INSERT)                                                                                                                                                                                          \
    X(DELETE)                                                                                                                                                                                          \
    X(UPDATE)                                                                                                                                                                                          \
                                                                                                                                                                                                       \
    X(ALTER)                                                                                                                                                                                           \
    X(CREATE_TABLE)                                                                                                                                                                                    \
    X(CREATE_INDEX)                                                                                                                                                                                    \
    X(CREATE_SEQUENCE)                                                                                                                                                                                 \
    X(CREATE_VIEW)                                                                                                                                                                                     \
    X(CREATE_SCHEMA)                                                                                                                                                                                   \
    X(DROP)                                                                                                                                                                                            \
    X(PRAGMA)                                                                                                                                                                                          \
    X(TRANSACTION)                                                                                                                                                                                     \
                                                                                                                                                                                                       \
    X(EXPLAIN)                                                                                                                                                                                         \
                                                                                                                                                                                                       \
    X(PREPARE)                                                                                                                                                                                         \
    X(EXECUTE)                                                                                                                                                                                         \
    X(VACUUM)

    static proto::engine::LogicalOperatorType mapOperatorType(duckdb::LogicalOperatorType type) {
        using D = duckdb::LogicalOperatorType;
        using P = proto::engine::LogicalOperatorType;
        switch (type) {
#define X(NAME)                                                                                                                                                                                        \
    case D::NAME:                                                                                                                                                                                      \
        return P::OP_##NAME;
            LOGICAL_OPERATOR_TYPES
#undef X
        };
        return P::OP_INVALID;
    }

    /// Write the query plan
    proto::engine::QueryPlan* encodeQueryPlan(protobuf::Arena& arena, duckdb::LogicalOperator& planRoot) {
        auto* plan = protobuf::Arena::CreateMessage<proto::engine::QueryPlan>(&arena);

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
            for (auto& child : operators[targetID]->children) {
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
        std::sort(operatorChildEdges.begin(), operatorChildEdges.end(), [&](auto& l, auto& r) { return std::get<0>(l) < std::get<0>(r); });

        auto edgeIter = operatorChildEdges.begin();
        for (auto oid = 0; oid < operators.size(); ++oid) {
            opChildOffsets->Add(opChildren->size());

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

    /// Write the query result
    proto::engine::QueryResult* encodeQueryResult(protobuf::Arena& arena, duckdb::QueryResult& queryResult, uint64_t queryID) {
        auto& result = *protobuf::Arena::CreateMessage<proto::engine::QueryResult>(&arena);
        auto& chunks = *result.mutable_data_chunks();
        auto& names = *result.mutable_column_names();
        auto& sqlTypes = *result.mutable_column_sql_types();

        size_t columnCount = queryResult.names.size();
        size_t rowCount = 0;

        result.set_query_id(queryID);

        for (size_t columnIndex = 0; columnIndex < columnCount; columnIndex++) {
            auto name = queryResult.names[columnIndex];
            names.Add(std::string(name));

            auto sqlType = queryResult.sql_types[columnIndex];
            auto& type = *sqlTypes.Add();

            type.set_type_id(static_cast<tigon::proto::engine::SQLTypeID>(sqlType.id));
            type.set_width(sqlType.width);
            type.set_scale(sqlType.scale);
            type.set_collation(sqlType.collation);
        }

        while (true) {
            auto data = queryResult.Fetch();

            if (!data) {
                // TODO: Handle failure
                break;
            }

            auto dataSize = data->size();

            if (dataSize <= 0) {
                break;
            }

            assert(data->column_count() == columnCount);

            auto& chunk = *chunks.Add();
            chunk.set_row_count(dataSize);
            chunk.set_row_offset(rowCount);

            for (size_t columnIndex = 0; columnIndex < columnCount; columnIndex++) {
                auto& column = *chunk.mutable_columns()->Add();
                auto type = queryResult.sql_types[columnIndex];
                auto& nullMask = *column.mutable_null_mask();

                for (size_t rowIndex = 0; rowIndex < dataSize; rowIndex++) {
                    auto value = data->GetValue(columnIndex, rowIndex);

                    nullMask.Add(value.is_null);

                    if (value.is_null) {
                        continue;
                    }

                    switch (value.type) {
                        case duckdb::TypeId::NA:
                            break;
                        case duckdb::TypeId::BOOL:
                            column.mutable_rows_bool()->Add(value.value_.boolean);
                            break;
                        case duckdb::TypeId::UINT8:
                            column.mutable_rows_u32()->Add(value.value_.tinyint);
                            break;
                        case duckdb::TypeId::INT8:
                            column.mutable_rows_i32()->Add(value.value_.tinyint);
                            break;
                        case duckdb::TypeId::UINT16:
                            column.mutable_rows_u32()->Add(value.value_.smallint);
                            break;
                        case duckdb::TypeId::INT16:
                            column.mutable_rows_i32()->Add(value.value_.smallint);
                            break;
                        case duckdb::TypeId::UINT32:
                            column.mutable_rows_u32()->Add(value.value_.integer);
                            break;
                        case duckdb::TypeId::INT32:
                            column.mutable_rows_i32()->Add(value.value_.integer);
                            break;
                        case duckdb::TypeId::UINT64:
                            column.mutable_rows_u64()->Add(value.value_.bigint);
                            break;
                        case duckdb::TypeId::INT64:
                            column.mutable_rows_i64()->Add(value.value_.bigint);
                            break;
                        case duckdb::TypeId::HALF_FLOAT:
                            column.mutable_rows_f32()->Add(value.value_.smallint);
                            break;
                        case duckdb::TypeId::FLOAT:
                            column.mutable_rows_f32()->Add(value.value_.float_);
                            break;
                        case duckdb::TypeId::DOUBLE:
                            column.mutable_rows_f64()->Add(value.value_.double_);
                            break;
                        case duckdb::TypeId::STRING:
                            column.mutable_rows_str()->Add(std::string(value.str_value));
                            break;
                        case duckdb::TypeId::BINARY:
                            // TODO
                            break;
                        case duckdb::TypeId::FIXED_SIZE_BINARY:
                            // TODO
                            break;
                        case duckdb::TypeId::DATE32:
                            column.mutable_rows_i32()->Add(value.value_.integer);
                            break;
                        case duckdb::TypeId::DATE64:
                            column.mutable_rows_i64()->Add(value.value_.bigint);
                            break;
                        case duckdb::TypeId::TIMESTAMP:
                            column.mutable_rows_i64()->Add(value.value_.bigint);
                            break;
                        case duckdb::TypeId::TIME32:
                            column.mutable_rows_i64()->Add(value.value_.integer);
                            break;
                        case duckdb::TypeId::TIME64:
                            column.mutable_rows_i64()->Add(value.value_.bigint);
                            break;
                        case duckdb::TypeId::INTERVAL:
                            // TODO
                            break;
                        case duckdb::TypeId::DECIMAL:
                            column.mutable_rows_f64()->Add(value.value_.double_);
                            break;
                        case duckdb::TypeId::LIST:
                            // TODO
                            break;
                        case duckdb::TypeId::STRUCT:
                            // TODO
                            break;
                        case duckdb::TypeId::UNION:
                            // TODO
                            break;
                        case duckdb::TypeId::DICTIONARY:
                            // TODO
                            break;
                        case duckdb::TypeId::MAP:
                            // TODO
                            break;
                        case duckdb::TypeId::EXTENSION:
                            // TODO
                            break;
                        case duckdb::TypeId::FIXED_SIZE_LIST:
                            // TODO
                            break;
                        case duckdb::TypeId::DURATION:
                            // TODO
                            break;
                        case duckdb::TypeId::LARGE_STRING:
                            column.mutable_rows_str()->Add(std::string(value.str_value));
                            break;
                        case duckdb::TypeId::LARGE_BINARY:
                            // TODO
                            break;
                        case duckdb::TypeId::LARGE_LIST:
                            // TODO
                            break;
                        case duckdb::TypeId::VARCHAR:
                            column.mutable_rows_str()->Add(std::string(value.str_value));
                            break;
                        case duckdb::TypeId::VARBINARY:
                            // TODO
                            break;
                        case duckdb::TypeId::POINTER:
                            // TODO
                            break;
                        case duckdb::TypeId::HASH:
                            // TODO
                            break;
                        case duckdb::TypeId::INVALID:
                            // TODO
                            break;
                    }
                }
            }

            rowCount += dataSize;
        }

        result.set_column_count(columnCount);
        result.set_row_count(rowCount);

        return &result;
    }
} // namespace tigon
