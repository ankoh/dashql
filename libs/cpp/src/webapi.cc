// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/webapi.h"

#include <cstdio>
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

/// Run a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::RunQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_ = move(result);

        // Write the result buffer
        fb::FlatBufferBuilder builder{1024};
        auto query_result_ofs = WriteQueryResult(builder, *current_query_result_, ++current_query_id_, false);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Start a SQL query
ExpectedBuffer<proto::QueryResult> WebAPI::Connection::SendQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_ = move(result);

        // Write the result buffer
        fb::FlatBufferBuilder builder{1024};
        auto query_result_ofs = WriteQueryResult(builder, *current_query_result_, ++current_query_id_, true);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Fetch query results
ExpectedBuffer<proto::QueryResultChunk> WebAPI::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        nonstd::span<duckdb::LogicalType> types;
        if (current_query_result_ != nullptr) {
            chunk = current_query_result_->Fetch();
            types = current_query_result_->types;
        }
        if (!current_query_result_->success) return {ErrorCode::QUERY_FAILED, move(current_query_result_->error)};

        // Get query result
        fb::FlatBufferBuilder builder{128};
        auto ofs = WriteQueryResultChunk(builder, current_query_id_, chunk.get(), types);
        builder.Finish(ofs);

        // Last chunk?
        if (chunk && chunk->size() == 0) current_query_result_.reset();
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
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
    auto plan_ofs = WriteQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(plan_ofs);
    return {builder.Release()};
}

/// Format a query plan
ExpectedBuffer<proto::FormattedText> WebAPI::Connection::FormatQueryPlan(void* query_plan) {
    auto txt = writeJSON(query_plan, *proto::QueryPlanTypeTable());

    // Encode the query plan
    fb::FlatBufferBuilder builder{txt.size() + 16};
    auto txt_ofs = builder.CreateString(txt);
    auto txt_buf = proto::CreateFormattedText(builder, txt_ofs);

    // Return buffer
    builder.Finish(txt_buf);
    return {builder.Release()};
}

/// Generate a table
ExpectedSignal WebAPI::Connection::GenerateTable(proto::TableSpecification& spec) {
    return duckdb_webapi::generateTable(connection_, spec);
}

/// Constructor
WebAPI::WebAPI() : database_(std::make_shared<duckdb::DuckDB>()), connections_() {}

/// Create a session
WebAPI::Connection& WebAPI::Connect() {
    auto conn = std::make_unique<WebAPI::Connection>(database_);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, move(conn)});
    return *conn_ptr;
}

/// End a session
void WebAPI::Disconnect(Connection* session) { connections_.erase(session); }
