// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "duckdb/webapi/webapi.h"
#include "duckdb/webapi/proto/api_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/sinks/stdout_sinks.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace duckdb_webapi;

static std::unique_ptr<WebAPI> instance;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
void duckdb_webapi_init() {
    // Prepare the logger
    auto logSink = std::make_shared<spdlog::sinks::stderr_sink_st>();
    auto logger = std::make_shared<spdlog::logger>("console", logSink);
    logger->set_level(spdlog::level::debug);
    logger->set_pattern(R"RAW({"time":"%T","level":"%l","message":"%v"})RAW");
    spdlog::set_default_logger(logger);
    // XXX log to buffer
    // spdlog::info("initialized logger");

    // Create the instance
    instance = std::make_unique<WebAPI>();
    // spdlog::info("initialized web api");
}
/// Create a conn
ConnectionHdl duckdb_webapi_connect() {
    return reinterpret_cast<ConnectionHdl>(&instance->Connect());
}
/// End a conn
void duckdb_webapi_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    instance->Disconnect(c);
}

/// Register a buffer
void duckdb_webapi_register_buffer(ConnectionHdl connHdl, void* buffer, uint32_t buffer_size) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    c->context_data().RegisterBuffer(
        nonstd::span{static_cast<std::byte*>(buffer), static_cast<long>(buffer_size)});
}

/// Release a buffer
void duckdb_webapi_release_buffer(ConnectionHdl connHdl, BufferHdl bufferHdl) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    auto b = reinterpret_cast<void*>(bufferHdl);
    c->context_data().ReleaseBuffer(b);
}

/// Access a buffer
void* duckdb_webapi_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void duckdb_webapi_run_query(WebAPI::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    auto r = c->RunQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Send a query
void duckdb_webapi_send_query(WebAPI::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    auto r = c->SendQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Fetch query results
void duckdb_webapi_fetch_query_results(WebAPI::Response* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    c->context_data().Respond(move(r), *packed);
}

/// Analyze a query
void duckdb_webapi_analyze_query(WebAPI::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebAPI::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Generate a table
void duckdb_webapi_generate_table(WebAPI::Response* response, WebAPI::Connection* conn, void* spec_buffer, uint32_t spec_size) {
    // XXX
}

}

#ifdef WITH_WEBAPI_MAIN
int main() {
    duckdb_webapi_init();
}
#endif
