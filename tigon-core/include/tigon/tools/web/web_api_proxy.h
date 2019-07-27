//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_TOOLS_WEB_WEB_API_PROXY_H_
#define INCLUDE_TIGON_TOOLS_WEB_WEB_API_PROXY_H_

#include "tigon/proto/web_api_generated.h"
#include "tigon/tools/web/web_api.h"

extern "C" {

/// Create a session
tigon::WebAPI::Session *tigon_create_session();
/// End a session
void tigon_end_session(tigon::WebAPI::Session *session);

/// Get a buffer size
int tigon_get_buffer_size(tigon::WebAPI::Buffer* buffer);
/// Release a buffer
void tigon_release_buffer(tigon::WebAPI::Session *session, tigon::WebAPI::Buffer *buffer);

/// Get the response status
tigon::proto::StatusCode tigon_get_response_status(tigon::WebAPI::Session *session);
/// Get the response error message
const char *tigon_get_response_error_message(tigon::WebAPI::Session *session);
/// Get the response data
tigon::WebAPI::Buffer *tigon_get_response_data(tigon::WebAPI::Session *session);

/// Run a query
void tigon_query(tigon::WebAPI::Session *session, const char *text);
}

#endif // INCLUDE_TIGON_TOOLS_WEB_WEB_API_PROXY_H_
