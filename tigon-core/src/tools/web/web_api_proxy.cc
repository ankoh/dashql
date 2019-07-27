//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api_proxy.h"

namespace fb = flatbuffers;
using namespace tigon;

static std::unique_ptr<WebAPI> instance;

int main() {
    instance = std::make_unique<WebAPI>();
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

/// Run a query
void tigon_query(WebAPI::Session *session, const char *text) { session->query(text); }
}
