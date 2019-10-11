//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api_proxy.h"
#include <iostream>

namespace fb = flatbuffers;
using namespace tigon;

static std::unique_ptr<WebAPI> instance;

int main() {
    instance = std::make_unique<WebAPI>();
    std::cout << "foo" << std::endl;
    return 0;
}

extern "C" {

/// Create a session
WebAPI::Session *tigon_create_session() { return &instance->createSession(); }
/// End a session
void tigon_end_session(WebAPI::Session *session) { instance->endSession(session); }

/// Get a buffer size
int tigon_get_buffer_size(tigon::WebAPI::Buffer* buffer) {
    return (!!buffer) ? buffer->getSize() : 0;
}

/// Release a buffer
void tigon_release_buffer(WebAPI::Session *session, WebAPI::Buffer *buffer) { session->releaseBuffer(buffer); }

/// Get the response status
proto::StatusCode tigon_get_response_status(WebAPI::Session *session) { return session->getResponseStatus(); }

/// Get the response error message
const char *tigon_get_response_error_message(WebAPI::Session *session) {
    return session->getResponseErrorMessage().c_str();
}

/// Get the response data
WebAPI::Buffer *tigon_get_response_data(WebAPI::Session *session) { return session->getResponseData(); }

/// Parse tql
void tigon_parse_tql(WebAPI::Session *session, const char *text) { session->parseTQL(text); }
/// Run a query
void tigon_run_query(WebAPI::Session *session, const char *text) { session->runQuery(text); }
/// Explain a query
void tigon_plan_query(WebAPI::Session *session, const char* text) { session->planQuery(text); }

}
