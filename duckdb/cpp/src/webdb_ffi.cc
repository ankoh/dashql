// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "dashql/common/span.h"
#include "dashql/common/ffi_response.h"
#include "duckdb/web/webdb.h"
#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/sinks/stdout_sinks.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace duckdb::web;

namespace {

WebDB& GetWebDB() {
    static std::unique_ptr<WebDB> db = nullptr;
    if (db == nullptr) {
        db = std::make_unique<WebDB>();
    }
    return *db;
}

dashql::ResponseBuffer& GetResponseBuffer() {
    static dashql::ResponseBuffer buffer;
    return buffer;
}

}

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Clear the response
void duckdb_web_clear_response() {
    GetResponseBuffer().Clear();
}

/// Create a conn
ConnectionHdl duckdb_web_connect() {
    return reinterpret_cast<ConnectionHdl>(GetWebDB().Connect());
}
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    GetWebDB().Disconnect(c);
}

/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void duckdb_web_run_query(dashql::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(text);
    GetResponseBuffer().Store(*packed, move(r));
}

/// Send a query
void duckdb_web_send_query(dashql::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(text);
    GetResponseBuffer().Store(*packed, move(r));
}

/// Fetch query results
void duckdb_web_fetch_query_results(dashql::Response* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    GetResponseBuffer().Store(*packed, move(r));
}

/// Analyze a query
void duckdb_web_analyze_query(dashql::Response* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    GetResponseBuffer().Store(*packed, move(r));
}

/// Generate a table
void duckdb_web_generate_table(dashql::Response* response, WebDB::Connection* conn, void* spec_buffer, uint32_t spec_size) {
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
