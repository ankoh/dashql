//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------


#include "tigon/tools/web/web_api.h"
#include "tigon/proto/web_api.pb.h"
#include "spdlog/spdlog.h"
#include "spdlog/sinks/stdout_sinks.h"
#include <iostream>

using namespace tigon;

static std::unique_ptr<WebAPI> instance;

int main(int argc, char *argv[]) {
    (void)argc;
    (void)argv;

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

/// Create a session
WebAPI::Session *tigon_create_session() {
    return &instance->createSession();
}

/// End a session
void tigon_end_session(WebAPI::Session *session) {
    instance->endSession(session);
}

/// Release a buffer
void tigon_register_buffer(WebAPI::Session *session, void* buffer_ptr, unsigned buffer_length) {
    std::unique_ptr<std::byte[]> bytes{static_cast<std::byte*>(buffer_ptr)};
    session->registerBuffer(std::move(bytes), buffer_length);
}

/// Release a buffer
void tigon_release_buffer(WebAPI::Session *session, void* buffer) {
    session->releaseBuffer(buffer);
}

/// Parse tql
void tigon_parse_tql(WebAPI::Response::Packed* response, WebAPI::Session *session, const char *text) {
    session->parseTQL(text);
    session->writePackedResponse(*response);
}

/// Run a query
void tigon_run_query(WebAPI::Response::Packed* response, WebAPI::Session* session, const char *text) {
    session->runQuery(text);
    session->writePackedResponse(*response);
}

/// Explain a query
void tigon_plan_query(WebAPI::Response::Packed* response, WebAPI::Session *session, const char* text) {
    session->planQuery(text);
    session->writePackedResponse(*response);
}

/// Extract data
void tigon_extract_data(WebAPI::Response::Packed* response, WebAPI::Session* session, void* tql_module, unsigned tql_statement, void* data) {
    spdlog::info("extract data");
}

/// Compute a grid layout
void tigon_compute_grid_layout(void* element_buffer, unsigned element_count) {
    auto elements = nonstd::span<WebAPI::GridElement>(reinterpret_cast<WebAPI::GridElement*>(element_buffer), element_count);
    nonstd::span<WebAPI::GridArea> out; // XXX
    WebAPI::computeGridLayout(elements, out, 12);
}

}


