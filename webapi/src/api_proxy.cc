// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/proto/api_generated.h"

#include "flatbuffers/flatbuffers.h"
#include "flatbuffers/idl.h"
#include "spdlog/spdlog.h"
#include "spdlog/sinks/stdout_sinks.h"

#include <iostream>

namespace fb = flatbuffers;
using namespace duckdb_webapi;

static std::unique_ptr<WebAPI> instance;

int main(int argc, char *argv[]) {
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
    return 0;
}

extern "C" {

/// Create a conn
WebAPI::Connection *duckdb_webapi_connect() {
    return &instance->connect();
}
/// End a conn
void duckdb_webapi_disconnect(WebAPI::Connection *conn) {
    instance->disconnect(conn);
}

/// Release a buffer
void duckdb_webapi_register_buffer(WebAPI::Connection *conn, void* buffer, unsigned buffer_length) {
    conn->registerBuffer(nonstd::span{static_cast<std::byte*>(buffer), static_cast<long>(buffer_length)});
}
/// Release a buffer
void duckdb_webapi_release_buffer(WebAPI::Connection *conn, void* buffer) {
    conn->releaseBuffer(buffer);
}

/// Run a query
void duckdb_webapi_query(WebAPI::Response::Packed* response, WebAPI::Connection* conn, const char *text) {
    conn->runQuery(text);
    conn->writePackedResponse(*response);
}

}
