// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/proto/duckdb_codec.h"
#include "duckdb_webapi/proto/json_conversion.h"

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
void WebAPI::Response::clear() {
    status_code = proto::StatusCode::SUCCESS;
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
    status_code = proto::StatusCode::SUCCESS;
}

void WebAPI::Response::requestFailed(proto::StatusCode status, std::string err) {
    clear();
    status_code = status;
    error = move(err);
}

/// Constructor
WebAPI::Response::Response(WebAPI::Connection &session)
    : session(session), status_code(), error(), data({nullptr, 0}) {}

/// Constructor
WebAPI::Response::~Response() {
    clear();
}

/// Constructor
WebAPI::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database(std::move(db)), connection(*database), detachedBuffers(), adoptedBuffers(), response(*this), nextQueryID() {}

/// Destructor
WebAPI::Connection::~Connection() {}

/// Write the packed response
void WebAPI::Connection::writePackedResponse(Response::Packed& packed) {
    response.writePacked(packed);
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::Connection::registerBuffer(flatbuffers::DetachedBuffer detached) {
    auto dataPtr = detached.data();
    auto dataSize = detached.size();
    detachedBuffers.insert({dataPtr, std::move(detached)});
    return {dataPtr, dataSize};
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::Connection::registerBuffer(nonstd::span<std::byte> bytes) {
    auto dataPtr = bytes.data();
    auto dataSize = bytes.size();
    adoptedBuffers.insert({dataPtr, AdoptedBuffer{bytes}});
    return {dataPtr, dataSize};
}

/// Release a buffer
void WebAPI::Connection::releaseBuffer(void* data) {
    detachedBuffers.erase(data);
    adoptedBuffers.erase(data);
}

/// Run a query
void WebAPI::Connection::runQuery(std::string_view text) {
    auto queryID = allocateQueryID();

    // Create a new connection
    duckdb::Connection conn{*database};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success) {
        response.requestFailed(proto::StatusCode::ERROR, result->error);
        return;
    }

    // Write the result buffer
    fb::FlatBufferBuilder builder{1024};
    auto queryResultOfs = proto::writeQueryResult(builder, *result, queryID);

    // Return buffer
    builder.Finish(queryResultOfs);
    response.requestSucceeded(builder.Release());
}

/// Plan a sql statement
void WebAPI::Connection::planQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database};
    duckdb::Parser parser;
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();

    // Invalid statement count?
    if (parser.statements.size() != 1) {
        spdlog::warn("invalid number of statements");
        return;
    }

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Write the plan buffer
    fb::FlatBufferBuilder builder{1024};
    auto planOfs = proto::writeQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(planOfs);
    response.requestSucceeded(builder.Release());
}

/// Format a query plan
void WebAPI::Connection::formatQueryPlan(void* query_plan) {
    auto txt = proto::writeJSON(query_plan, *proto::QueryPlanTypeTable());

    // Encode the query plan
    fb::FlatBufferBuilder builder{txt.size() + 16};
    auto txtOfs = builder.CreateString(txt);
    auto txtBuf = proto::CreateFormattedText(builder, txtOfs);

    // Return buffer
    builder.Finish(txtBuf);
    response.requestSucceeded(builder.Release());
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
