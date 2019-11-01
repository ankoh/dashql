//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"

#include "duckdb.hpp"
#include "common/vector_operations/vector_operations.hpp"
#include "main/client_context.hpp"
#include "parser/parser.hpp"
#include "planner/planner.hpp"

#include "spdlog/spdlog.h"

#include "flatbuffers/flatbuffers.h"
#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/proto/tql_generated.h"
#include "tigon/proto/web_api_generated.h"
#include "tigon/common/text_view_stream.h"
#include "tigon/common/variant.h"

#include <cstdio>
#include <memory>
#include <optional>
#include <unordered_map>
#include <string_view>
#include <iostream>

namespace fb = flatbuffers;
using namespace tigon;

/// Reset the response
void WebAPI::Response::clear() {
    status_code = proto::StatusCode::Success;
    error.clear();
    data = {nullptr, 0};
}

/// Write the packed response
void WebAPI::Response::writePacked(WebAPI::Response::Packed& packed) {
    packed.error = error.empty() ? 0 : reinterpret_cast<uintptr_t>(error.data());
    packed.data = reinterpret_cast<uintptr_t>(std::get<0>(data));
    packed.data_size = std::get<1>(data);
    packed.status_code = static_cast<uint32_t>(status_code);
}

/// Request succeeded
void WebAPI::Response::requestSucceeded(fb::DetachedBuffer buffer) {
    clear();
    data = session.registerBuffer(std::move(buffer));
    status_code = proto::StatusCode::Success;
}

void WebAPI::Response::requestFailed(proto::StatusCode status, std::string err) {
    clear();
    status_code = status;
    error = move(err);
}

/// Constructor
WebAPI::Response::Response(WebAPI::Session &session)
    : session(session), status_code(), error(), data({nullptr, 0}) {}

/// Constructor
WebAPI::Response::~Response() {
    clear();
}

/// Constructor
WebAPI::Session::Session(std::shared_ptr<duckdb::DuckDB> database)
    : database(std::move(database)), buffers(), response(*this), nextQueryID() {}

/// Destructor
WebAPI::Session::~Session() {}

/// Write the packed response
void WebAPI::Session::writePackedResponse(Response::Packed& packed) {
    response.writePacked(packed);
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::Session::registerBuffer(flatbuffers::DetachedBuffer detached) {
    auto dataPtr = detached.data();
    auto dataSize = detached.size();
    buffers.insert({dataPtr, std::move(detached)});
    return {dataPtr, dataSize};
}

/// Release a buffer
void WebAPI::Session::releaseBuffer(void* data) { buffers.erase(data); }

/// Parse TQL
void WebAPI::Session::parseTQL(std::string_view text) {
    ITextViewStream in(text);

    // Parse statement
    tql::ParseContext ctx;
    auto program = ctx.Parse(in);

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Encode statements
    std::vector<uint8_t> statementTypes;
    std::vector<flatbuffers::Offset<void>> statements;

    for (auto& statement: program.statements) {
        std::visit(overload {
            // Display statement
            [&](std::unique_ptr<tql::DisplayStatement>& display) {
            },

            // Extract statement
            [&](std::unique_ptr<tql::ExtractStatement>& display) {
            },

            // Load statement
            [&](std::unique_ptr<tql::LoadStatement>& display) {
            },

            // Parameter declaration
            [&](std::unique_ptr<tql::ParameterDeclaration>& display) {
            },

            // SQL statement
            [&](std::unique_ptr<tql::SQLStatement>& display) {
                auto text = builder.CreateString(display->text.data(), display->text.length());
                auto statement = proto::CreateTQLQueryStatement(builder, text);
                statements.push_back(statement.Union());
                statementTypes.push_back(static_cast<uint8_t>(proto::TQLStatement::TQLQueryStatement));
            }
        }, statement);
    }

    // Encode the program
    auto statementTypesOfs = builder.CreateVector(statementTypes);
    auto statementsOfs = builder.CreateVector(statements);
    auto programOfs = proto::CreateTQLProgram(builder, statementTypesOfs, statementsOfs);

    // Finish the flatbuffer
    builder.Finish(programOfs);
    // Mark as successfull
    response.requestSucceeded(builder.Release());
}

/// Write a fixed-length result column
template <typename T>
static fb::Offset<proto::QueryResultColumn> writeFixedLengthResultColumn(fb::FlatBufferBuilder &builder,
                                                                         duckdb::Vector &vec) {
    uint8_t *nullmask;
    uint8_t *data;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    auto d = builder.CreateUninitializedVector(vec.count, sizeof(T), &data);
    duckdb::VectorOperations::Exec(vec.sel_vector, 0,
                                   [&](duckdb::index_t i, duckdb::index_t k) {
                                       nullmask[k] = vec.nullmask[i];
                                       reinterpret_cast<T *>(data)[k] = vec.data[i];
                                   },
                                   0);
    proto::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<proto::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_fixed_length_data(d);
    return c.Finish();
}

/// Write a string result column
static fb::Offset<proto::QueryResultColumn> writeStringResultColumn(fb::FlatBufferBuilder &builder,
                                                                    duckdb::Vector &vec) {
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

/// Run a query
void WebAPI::Session::runQuery(std::string_view text) {
    auto queryID = allocateQueryID();
    // Create a new connection
    duckdb::Connection conn{*database};
    // Send the query to the existing database
    auto result = conn.SendQuery(std::string{text});

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Query failed?
    if (!result->success) {
        response.requestFailed(proto::StatusCode::GenericError, result->error);
        return;
    }

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<proto::QueryResultChunk>> chunks;
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
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
        columnRawTypes = builder.CreateUninitializedVector<uint8_t>(result->types.size(), &writer);
        for (size_t i = 0; i < result->types.size(); ++i) {
            writer[i] = static_cast<uint8_t>(result->types[i]);
        }
    }

    // Write column sql types
    fb::Offset<fb::Vector<const proto::SQLType *>> columnSQLTypes;
    {
        proto::SQLType *writer;
        columnSQLTypes = builder.CreateUninitializedVectorOfStructs<proto::SQLType>(result->sql_types.size(), &writer);
        for (size_t i = 0; i < result->sql_types.size(); ++i) {
            writer[i] = proto::SQLType{static_cast<proto::SQLTypeID>(result->sql_types[i].id),
                                       result->sql_types[i].width, result->sql_types[i].scale};
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result->names);

    // Write the query result
    proto::QueryResultBuilder resultBuilder{builder};
    resultBuilder.add_query_id(queryID);
    resultBuilder.add_column_names(columnNames);
    resultBuilder.add_column_raw_types(columnRawTypes);
    resultBuilder.add_column_sql_types(columnSQLTypes);
    resultBuilder.add_data_chunks(dataChunks);
    auto queryResult = resultBuilder.Finish();

    // Finish the flatbuffer
    builder.Finish(queryResult);
    // Mark as successfull
    response.requestSucceeded(builder.Release());
}

/// Plan a sql statement
void WebAPI::Session::planQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database};
    duckdb::Parser parser(*conn.context);
    parser.ParseQuery(std::string(text));

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Begin transaction
    conn.context->transaction.BeginTransaction();

    // Invalid statement count?
    if (parser.statements.size() != 1) {
        spdlog::warn("invalid number of statements");
        return;
    }

    // Plan the statement
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));

    // Remember the children
    std::vector<duckdb::LogicalOperator*> operators;
    std::vector<std::tuple<size_t, size_t>> operatorChildEdges;
    operators.push_back(planner.plan.get());

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

    // End transaction
    conn.context->transaction.Rollback();

    fb::Offset<fb::Vector<uint8_t>> operatorTypeVector;
    fb::Offset<fb::Vector<uint64_t>> operatorChildVector;
    fb::Offset<fb::Vector<uint64_t>> operatorChildOffsetVector;

    // Write operator types
    {
        uint8_t *writer;
        operatorTypeVector = builder.CreateUninitializedVector<uint8_t>(operators.size(), &writer);
        for (size_t i = 0; i < operators.size(); ++i) {
            using D = duckdb::LogicalOperatorType;
            using P = proto::LogicalOperatorType;
            P protoType;
            switch (operators[i]->type) {
                case D::INVALID: protoType = P::INVALID;
                case D::PROJECTION: protoType = P::PROJECTION;
                case D::FILTER: protoType = P::FILTER;
                case D::AGGREGATE_AND_GROUP_BY: protoType = P::AGGREGATE_AND_GROUP_BY;
                case D::WINDOW: protoType = P::WINDOW;
                case D::LIMIT: protoType = P::LIMIT;
                case D::ORDER_BY: protoType = P::ORDER_BY;
                case D::TOP_N: protoType = P::TOP_N;
                case D::COPY_FROM_FILE: protoType = P::COPY_FROM_FILE;
                case D::COPY_TO_FILE: protoType = P::COPY_TO_FILE;
                case D::DISTINCT: protoType = P::DISTINCT;
                case D::INDEX_SCAN: protoType = P::INDEX_SCAN;
                case D::GET: protoType = P::GET;
                case D::CHUNK_GET: protoType = P::CHUNK_GET;
                case D::DELIM_GET: protoType = P::DELIM_GET;
                case D::EXPRESSION_GET: protoType = P::EXPRESSION_GET;
                case D::TABLE_FUNCTION: protoType = P::TABLE_FUNCTION;
                case D::SUBQUERY: protoType = P::SUBQUERY;
                case D::EMPTY_RESULT: protoType = P::EMPTY_RESULT;
                case D::JOIN: protoType = P::JOIN;
                case D::DELIM_JOIN: protoType = P::DELIM_JOIN;
                case D::COMPARISON_JOIN: protoType = P::COMPARISON_JOIN;
                case D::ANY_JOIN: protoType = P::ANY_JOIN;
                case D::CROSS_PRODUCT: protoType = P::CROSS_PRODUCT;
                case D::UNION: protoType = P::UNION;
                case D::EXCEPT: protoType = P::EXCEPT;
                case D::INTERSECT: protoType = P::INTERSECT;
                case D::INSERT: protoType = P::INSERT;
                case D::DELETE: protoType = P::DELETE;
                case D::UPDATE: protoType = P::UPDATE;
                case D::CREATE_TABLE: protoType = P::CREATE_TABLE;
                case D::CREATE_INDEX: protoType = P::CREATE_INDEX;
                case D::EXPLAIN: protoType = P::EXPLAIN;
                case D::PRUNE_COLUMNS: protoType = P::PRUNE_COLUMNS;
                case D::PREPARE: protoType = P::PREPARE;
                case D::EXECUTE: protoType = P::EXECUTE;
            };
            writer[i] = static_cast<uint8_t>(operators[i]->type);
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
    auto plan = planBuilder.Finish();

    // Finish the flatbuffer
    builder.Finish(plan);
    // Mark as successfull
    response.requestSucceeded(builder.Release());
}

/// Constructor
WebAPI::WebAPI()
    : database(std::make_shared<duckdb::DuckDB>()), sessions() {}

/// Create a session
WebAPI::Session& WebAPI::createSession() {
    auto session = std::make_unique<WebAPI::Session>(database);
    auto sessionPtr = session.get();
    sessions.insert({sessionPtr, move(session)});
    return *sessionPtr;
}

/// End a session
void WebAPI::endSession(Session* session) {
    sessions.erase(session);
}
