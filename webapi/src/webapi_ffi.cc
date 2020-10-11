// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "duckdb_webapi/webapi.h"
#include "duckdb_webapi/proto/api_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/sinks/stdout_sinks.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace duckdb_webapi;

static std::unique_ptr<WebAPI> instance;

extern "C" {

using ConnectionHandle = uint64_t;
using BufferHandle = uint64_t;

/// Create a conn
void duckdb_webapi_init() {
    // Prepare the logger
    auto logSink = std::make_shared<spdlog::sinks::stderr_sink_st>();
    auto logger = std::make_shared<spdlog::logger>("console", logSink);
    logger->set_level(spdlog::level::debug);
    logger->set_pattern(R"RAW({"time":"%T","level":"%l","message":"%v"})RAW");
    spdlog::set_default_logger(logger);
    spdlog::info("initialized logger");

    // Create the instance
    instance = std::make_unique<WebAPI>();
    spdlog::info("initialized web api");
}
/// Create a conn
ConnectionHandle duckdb_webapi_connect() {
    return reinterpret_cast<uintptr_t>(&instance->Connect());
}
/// End a conn
void duckdb_webapi_disconnect(ConnectionHandle conn) {
    instance->Disconnect(reinterpret_cast<WebAPI::Connection*>(conn));
}

/// Get a buffer
WebAPI::Connection* duckdb_webapi_get_buffer(ConnectionHandle conn, BufferHandle buffer) {
    return reinterpret_cast<WebAPI::Connection*>(conn);
}

/// Register a buffer
BufferHandle duckdb_webapi_register_buffer(ConnectionHandle conn, void* buffer, uint32_t buffer_size) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    c->context_data().RegisterBuffer(
        nonstd::span{static_cast<std::byte*>(buffer), static_cast<long>(buffer_size)});
    return reinterpret_cast<uintptr_t>(buffer);
}

/// Release a buffer
void duckdb_webapi_release_buffer(ConnectionHandle conn, BufferHandle buffer) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    auto b = reinterpret_cast<void*>(buffer);
    c->context_data().ReleaseBuffer(b);
}

/// Run a query
void duckdb_webapi_run_query(WebAPI::Response* packed, ConnectionHandle conn, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    auto r = c->RunQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Send a query
void duckdb_webapi_send_query(WebAPI::Response* packed, ConnectionHandle conn, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    auto r = c->SendQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Fetch query results
void duckdb_webapi_fetch_query_results(WebAPI::Response* packed, ConnectionHandle conn) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    auto r = c->FetchQueryResults();
    c->context_data().Respond(move(r), *packed);
}

/// Analyze a query
void duckdb_webapi_analyze_query(WebAPI::Response* packed, ConnectionHandle conn, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(conn);
    auto r = c->AnalyzeQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Generate a table
void duckdb_webapi_generate_table(WebAPI::Response* response, ConnectionHandle conn, void* spec_buffer, uint32_t spec_size) {
    // XXX
}

}

#ifdef EMSCRIPTEN
int main() {
    duckdb_webapi_init();
}
#endif
