// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "duckdb/web/webdb.h"
#include "duckdb/web/proto/api_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/sinks/stdout_sinks.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace duckdb::web;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
ConnectionHdl duckdb_web_connect() {
    return reinterpret_cast<ConnectionHdl>(&WebDB::Instance().Connect());
}
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    WebDB::Instance().Disconnect(c);
}

/// Register a buffer
void duckdb_web_register_buffer(ConnectionHdl connHdl, void* buffer, uint32_t buffer_size) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    c->context_data().RegisterBuffer(
        nonstd::span{static_cast<std::byte*>(buffer), static_cast<long>(buffer_size)});
}

/// Release a buffer
void duckdb_web_release_buffer(ConnectionHdl connHdl, BufferHdl bufferHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto b = reinterpret_cast<void*>(bufferHdl);
    c->context_data().ReleaseBuffer(b);
}

/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void duckdb_web_run_query(WebDB::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Send a query
void duckdb_web_send_query(WebDB::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Fetch query results
void duckdb_web_fetch_query_results(WebDB::Response* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    c->context_data().Respond(move(r), *packed);
}

/// Analyze a query
void duckdb_web_analyze_query(WebDB::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    c->context_data().Respond(move(r), *packed);
}

/// Generate a table
void duckdb_web_generate_table(WebDB::Response* response, WebDB::Connection* conn, void* spec_buffer, uint32_t spec_size) {
    // XXX
}

}

#ifdef WITH_WEBDB_MAIN
int main() {
    // Prepare the logger
    auto logSink = std::make_shared<spdlog::sinks::stderr_sink_st>();
    auto logger = std::make_shared<spdlog::logger>("console", logSink);
    logger->set_level(spdlog::level::debug);
    logger->set_pattern(R"RAW({"time":"%T","level":"%l","message":"%v"})RAW");
    spdlog::set_default_logger(logger);
}
#endif
