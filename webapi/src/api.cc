// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/duckdb_codec.h"
#include "duckdb_webapi/json_conversion.h"
#include "duckdb_webapi/tablegen.h"

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"

#include "spdlog/spdlog.h"

#include "flatbuffers/flatbuffers.h"

#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

namespace fb = flatbuffers;
using namespace duckdb_webapi;

/// Reset the response
void WebAPI::ContextData::clearRequest() {
    requestStatus = proto::StatusCode::SUCCESS;
    requestError.reset();
    requestData = {nullptr, 0};
}

/// Request succeeded
void WebAPI::ContextData::requestSucceeded(fb::DetachedBuffer&& buffer) {
    clearRequest();
    requestStatus = proto::StatusCode::SUCCESS;
    requestData = registerBuffer(std::move(buffer));
}

void WebAPI::ContextData::requestFailed(Error&& err) {
    clearRequest();
    requestStatus = proto::StatusCode::ERROR;
    requestError = move(err);
}

/// Constructor
WebAPI::ContextData::ContextData()
    : detachedBuffers(), adoptedBuffers(), requestStatus(), requestData({nullptr, 0}), requestError() {}

/// Register a buffer
std::pair<void*, size_t> WebAPI::ContextData::registerBuffer(flatbuffers::DetachedBuffer detached) {
    auto dataPtr = detached.data();
    auto dataSize = detached.size();
    detachedBuffers.insert({dataPtr, std::move(detached)});
    return {dataPtr, dataSize};
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::ContextData::registerBuffer(nonstd::span<std::byte> bytes) {
    auto dataPtr = bytes.data();
    auto dataSize = bytes.size();
    adoptedBuffers.insert({dataPtr, AdoptedBuffer{bytes}});
    return {dataPtr, dataSize};
}

/// Release a buffer
void WebAPI::ContextData::releaseBuffer(void* data) {
    detachedBuffers.erase(data);
    adoptedBuffers.erase(data);
}

/// Constructor
WebAPI::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database(std::move(db)), connection(*database), currentQueryID(), currentQueryResult() {}

/// Destructor
WebAPI::Connection::~Connection() {}

/// Run a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::runQuery(std::string_view text) {
    // Create a new connection
    duckdb::Connection conn{*database};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success)
        return { ErrorCode::QUERY_FAILED, move(result->error) };

    // Write the result buffer
    fb::FlatBufferBuilder builder{1024};
    auto queryResultOfs = writeQueryResult(builder, *result, ++currentQueryID);

    // Return buffer
    builder.Finish(queryResultOfs);
    return { builder.Release() };
}

/// Start a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::sendQuery(std::string_view text) {
    // Create a new connection
    duckdb::Connection conn{*database};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success)
        return { ErrorCode::QUERY_FAILED, move(result->error) };

    // Write the result buffer
    fb::FlatBufferBuilder builder{1024};
    auto queryResultOfs = writeQueryResult(builder, *result, ++currentQueryID);

    // Return buffer
    builder.Finish(queryResultOfs);
    return { builder.Release() };
}

/// Fetch query results
ExpectedBuffer<proto::QueryResultChunk> WebAPI::Connection::fetchQueryResults() {
    // Fetch data if a query is active
    std::unique_ptr<duckdb::DataChunk> chunk;
    nonstd::span<duckdb::LogicalType> types;
    if (currentQueryResult != nullptr) {
        chunk = currentQueryResult->Fetch();
        types = currentQueryResult->types;
    }

    // Get query result
    fb::FlatBufferBuilder builder{128};
    auto ofs = writeQueryResultChunk(builder, chunk.get(), types);
    builder.Finish(ofs);
    return { builder.Release() };
}

/// Analyze a SQL query
ExpectedBuffer<proto::QueryPlan> WebAPI::Connection::analyzeQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database};
    duckdb::Parser parser;
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();

    // Invalid statement count?
    if (parser.statements.size() != 1)
        return ErrorCode::INVALID_REQUEST;

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Write the plan buffer
    fb::FlatBufferBuilder builder{1024};
    auto planOfs = writeQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(planOfs);
    return { builder.Release() };
}

/// Format a query plan
ExpectedBuffer<proto::FormattedText> WebAPI::Connection::formatQueryPlan(void* query_plan) {
    auto txt = writeJSON(query_plan, *proto::QueryPlanTypeTable());

    // Encode the query plan
    fb::FlatBufferBuilder builder{txt.size() + 16};
    auto txtOfs = builder.CreateString(txt);
    auto txtBuf = proto::CreateFormattedText(builder, txtOfs);

    // Return buffer
    builder.Finish(txtBuf);
    return { builder.Release() };
}

/// Generate a table
ExpectedSignal WebAPI::Connection::generateTable(proto::TableSpecification& spec) {
    return duckdb_webapi::generateTable(connection, spec);
}

/// Constructor
WebAPI::WebAPI()
    : database(std::make_shared<duckdb::DuckDB>()), connections() {}

/// Create a session
WebAPI::Connection& WebAPI::connect() {
    auto conn = std::make_unique<WebAPI::Connection>(database);
    auto connPtr = conn.get();
    connections.insert({connPtr, move(conn)});
    return *connPtr;
}

/// End a session
void WebAPI::disconnect(Connection* session) {
    connections.erase(session);
}
