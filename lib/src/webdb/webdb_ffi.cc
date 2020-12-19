// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "dashql/common/ffi_response.h"
#include "dashql/common/span.h"
#include "dashql/webdb/webdb.h"
#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/sinks/stdout_sinks.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
using namespace dashql;
using namespace dashql::webdb;

namespace {

WebDB& GetWebDB() {
    static std::unique_ptr<WebDB> db = nullptr;
    if (db == nullptr) {
        db = std::make_unique<WebDB>();
    }
    return *db;
}

FFIResponseBuffer& GetResponseBuffer() {
    static FFIResponseBuffer buffer;
    return buffer;
}

}

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Clear the response
void dashql_webdb_clear_response() {
    GetResponseBuffer().Clear();
}

/// Create a conn
ConnectionHdl dashql_webdb_connect() {
    return reinterpret_cast<ConnectionHdl>(GetWebDB().Connect());
}
/// End a conn
void dashql_webdb_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    GetWebDB().Disconnect(c);
}

/// Access a buffer
void* dashql_webdb_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void dashql_webdb_run_query(FFIResponse* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(text);
    GetResponseBuffer().Store(*packed, std::move(r));
}

/// Send a query
void dashql_webdb_send_query(FFIResponse* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(text);
    GetResponseBuffer().Store(*packed, std::move(r));
}

/// Fetch query results
void dashql_webdb_fetch_query_results(FFIResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    GetResponseBuffer().Store(*packed, std::move(r));
}

/// Analyze a query
void dashql_webdb_analyze_query(FFIResponse* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    GetResponseBuffer().Store(*packed, std::move(r));
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
