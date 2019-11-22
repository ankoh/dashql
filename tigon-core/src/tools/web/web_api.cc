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
    status_code = proto::web_api::StatusCode::SUCCESS;
    error.clear();
    data = {};
}

/// Write the packed response
void WebAPI::Response::writePacked(WebAPI::Response::Packed& packed) {
    packed.error = error.empty() ? 0 : reinterpret_cast<uintptr_t>(error.data());
    packed.data = reinterpret_cast<uintptr_t>(data.data());
    packed.data_size = data.size();
    packed.status_code = static_cast<uint32_t>(status_code);
}

/// Request succeeded
void WebAPI::Response::requestSucceeded(nonstd::span<std::byte> d) {
    clear();
    status_code = proto::web_api::StatusCode::SUCCESS;
    data = d;
}

void WebAPI::Response::requestFailed(proto::web_api::StatusCode status, std::string err) {
    clear();
    status_code = status;
    error = move(err);
}

/// Constructor
WebAPI::Response::Response(WebAPI::Session &session)
    : session(session), status_code(), error(), data() {}

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

/// Encode a message
nonstd::span<std::byte> WebAPI::Session::serializeMessage(google::protobuf::MessageLite& msg) {
    // Serialize the message
    auto size = msg.ByteSizeLong();
    auto bytes = std::unique_ptr<std::byte[]>(new std::byte[size]);
    msg.SerializeToArray(bytes.get(), size);

    // Register the buffer
    return registerBuffer(std::move(bytes), size);
}

/// Register a buffer
nonstd::span<std::byte> WebAPI::Session::registerBuffer(std::unique_ptr<std::byte[]> data, size_t dataSize) {
    Buffer buffer{std::move(data), dataSize};
    auto span = buffer.asSpan();
    auto ptr = span.data();
    buffers.insert({ptr, std::move(buffer)});
    return span;
}

/// Release a buffer
void WebAPI::Session::releaseBuffer(void* data) {
    buffers.erase(data);
}

/// Parse TQL
void WebAPI::Session::parseTQL(std::string_view text) {
    // Parse statement
    tql::ParseContext ctx;
    auto module = ctx.Parse(text);

    // Encode the tql module
    google::protobuf::Arena arena;
    auto msg = encodeTQLModule(arena, module);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
}

/// Run a query
void WebAPI::Session::runQuery(std::string_view text) {
    auto queryID = allocateQueryID();

    // Create a new connection
    duckdb::Connection conn{*database};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success) {
        response.requestFailed(proto::web_api::StatusCode::ERROR, result->error);
        return;
    }

    // Encode the result
    google::protobuf::Arena arena;
    auto msg = encodeQueryResult(arena, *result, queryID);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
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

    // Encode the query plan
    google::protobuf::Arena arena;
    auto msg = encodeQueryPlan(arena, *planner.plan);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
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
