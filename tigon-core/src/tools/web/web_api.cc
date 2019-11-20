//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"

#include "spdlog/spdlog.h"

#include "flatbuffers/flatbuffers.h"

#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/proto/duckdb_codec.h"
#include "tigon/proto/json_conversion.h"
#include "tigon/proto/tql_codec.h"
#include "tigon/proto/tql.pb.h"
#include "tigon/proto/web_api.pb.h"
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
WebAPI::Response::Response(WebAPI::Session &session)
    : session(session), status_code(), error(), data({nullptr, 0}) {}

/// Constructor
WebAPI::Response::~Response() {
    clear();
}

/// Constructor
WebAPI::Session::Session(std::shared_ptr<duckdb::DuckDB> database)
    : database(std::move(database)), detachedBuffers(), adoptedBuffers(), response(*this), nextQueryID() {}

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
    detachedBuffers.insert({dataPtr, std::move(detached)});
    return {dataPtr, dataSize};
}

/// Register a buffer
std::pair<void*, size_t> WebAPI::Session::registerBuffer(nonstd::span<std::byte> bytes) {
    auto dataPtr = bytes.data();
    auto dataSize = bytes.size();
    adoptedBuffers.insert({dataPtr, AdoptedBuffer{bytes}});
    return {dataPtr, dataSize};
}

/// Release a buffer
void WebAPI::Session::releaseBuffer(void* data) {
    detachedBuffers.erase(data);
    adoptedBuffers.erase(data);
}

/// Parse TQL
void WebAPI::Session::parseTQL(std::string_view text) {
    // Parse statement
    tql::ParseContext ctx;
    auto module = ctx.Parse(text);

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};
    auto moduleOfs = proto::writeTQLModule(builder, module);

    // Return buffer
    builder.Finish(moduleOfs);
    response.requestSucceeded(builder.Release());
}

/// Run a query
void WebAPI::Session::runQuery(std::string_view text) {
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
void WebAPI::Session::planQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database};
    duckdb::Parser parser(*conn.context);
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

/// Format TQL
void WebAPI::Session::formatTQLModule(void* tql_module) {
    auto txt = proto::writeJSON(tql_module, *proto::TQLModuleTypeTable());

    // Encode the tql module
    fb::FlatBufferBuilder builder{txt.size() + 16};
    auto txtOfs = builder.CreateString(txt);
    auto txtBuf = proto::CreateFormattedText(builder, txtOfs);

    // Return buffer
    builder.Finish(txtBuf);
    response.requestSucceeded(builder.Release());
}

/// Format a query plan
void WebAPI::Session::formatQueryPlan(void* query_plan) {
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
