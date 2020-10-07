// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/api.h"

#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"
#include "duckdb_webapi/codec.h"
#include "duckdb_webapi/json.h"
#include "duckdb_webapi/tablegen.h"
#include "flatbuffers/flatbuffers.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace duckdb_webapi;

/// Reset the response
void WebAPI::ContextData::clearRequest() {
    request_status_ = proto::StatusCode::SUCCESS;
    request_error_.reset();
    request_data_ = {nullptr, 0};
}

/// Request succeeded
void WebAPI::ContextData::requestSucceeded(fb::DetachedBuffer&& buffer) {
    clearRequest();
    request_status_ = proto::StatusCode::SUCCESS;
    request_data_ = RegisterBuffer(std::move(buffer));
}

/// Request failed
void WebAPI::ContextData::requestFailed(Error&& err) {
    clearRequest();
    request_status_ = proto::StatusCode::ERROR;
    request_error_ = move(err);
}

/// Constructor
WebAPI::ContextData::ContextData()
    : detached_buffers_(), adopted_buffers_(), request_status_(), request_data_({nullptr, 0}), request_error_() {}

/// Register a buffer
std::pair<void*, size_t> WebAPI::ContextData::RegisterBuffer(flatbuffers::DetachedBuffer detached) {
    auto data_ptr = detached.data();
    auto data_size = detached.size();
    detached_buffers_.insert({data_ptr, std::move(detached)});
    return {data_ptr, data_size};
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::ContextData::RegisterBuffer(nonstd::span<std::byte> bytes) {
    auto data_ptr = bytes.data();
    auto data_size = bytes.size();
    adopted_buffers_.insert({data_ptr, AdoptedBuffer{bytes}});
    return {data_ptr, data_size};
}

/// Release a buffer
void WebAPI::ContextData::ReleaseBuffer(void* data) {
    detached_buffers_.erase(data);
    adopted_buffers_.erase(data);
}

/// Constructor
WebAPI::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database_(std::move(db)),
      connection_(*database_),
      context_data_(std::make_unique<ContextData>()),
      current_query_id_(),
      current_query_result_() {}

/// Destructor
WebAPI::Connection::~Connection() {}

/// Run a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::RunQuery(std::string_view text) {
    // Create a new connection
    duckdb::Connection conn{*database_};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};

    // Write the result buffer
    fb::FlatBufferBuilder builder{1024};
    auto query_result_ofs = writeQueryResult(builder, *result, ++current_query_id_);

    // Return buffer
    builder.Finish(query_result_ofs);
    return {builder.Release()};
}

/// Start a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::SendQuery(std::string_view text) {
    // Create a new connection
    duckdb::Connection conn{*database_};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};

    // Write the result buffer
    fb::FlatBufferBuilder builder{1024};
    auto query_result_ofs = writeQueryResult(builder, *result, ++current_query_id_);

    // Return buffer
    builder.Finish(query_result_ofs);
    return {builder.Release()};
}

/// Fetch query results
ExpectedBuffer<proto::QueryResultChunk> WebAPI::Connection::FetchQueryResults() {
    // Fetch data if a query is active
    std::unique_ptr<duckdb::DataChunk> chunk;
    nonstd::span<duckdb::LogicalType> types;
    if (current_query_result_ != nullptr) {
        chunk = current_query_result_->Fetch();
        types = current_query_result_->types;
    }

    // Get query result
    fb::FlatBufferBuilder builder{128};
    auto ofs = writeQueryResultChunk(builder, current_query_id_, chunk.get(), types);
    builder.Finish(ofs);
    return {builder.Release()};
}

/// Analyze a SQL query
ExpectedBuffer<proto::QueryPlan> WebAPI::Connection::AnalyzeQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database_};
    duckdb::Parser parser;
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();

    // Invalid statement count?
    if (parser.statements.size() != 1) return ErrorCode::INVALID_REQUEST;

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Write the plan buffer
    fb::FlatBufferBuilder builder{1024};
    auto planOfs = writeQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(planOfs);
    return {builder.Release()};
}

/// Format a query plan
ExpectedBuffer<proto::FormattedText> WebAPI::Connection::FormatQueryPlan(void* query_plan) {
    auto txt = writeJSON(query_plan, *proto::QueryPlanTypeTable());

    // Encode the query plan
    fb::FlatBufferBuilder builder{txt.size() + 16};
    auto txtOfs = builder.CreateString(txt);
    auto txtBuf = proto::CreateFormattedText(builder, txtOfs);

    // Return buffer
    builder.Finish(txtBuf);
    return {builder.Release()};
}

/// Generate a table
ExpectedSignal WebAPI::Connection::GenerateTable(proto::TableSpecification& spec) {
    return duckdb_webapi::generateTable(connection_, spec);
}

/// Constructor
WebAPI::WebAPI() : database(std::make_shared<duckdb::DuckDB>()), connections() {}

/// Create a session
WebAPI::Connection& WebAPI::Connect() {
    auto conn = std::make_unique<WebAPI::Connection>(database);
    auto connPtr = conn.get();
    connections.insert({connPtr, move(conn)});
    return *connPtr;
}

/// End a session
void WebAPI::Disconnect(Connection* session) { connections.erase(session); }
