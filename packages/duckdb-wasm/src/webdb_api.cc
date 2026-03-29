#include <cstring>
#include <stdexcept>

#include "arrow/status.h"
#include "duckdb/web/config.h"
#include "duckdb/web/utils/wasm_response.h"
#include "duckdb/web/webdb.h"

using namespace duckdb::web;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Clear the response buffer
void duckdb_web_clear_response() { WASMResponseBuffer::Get().Clear(); }

/// Throw a (wasm) exception
extern "C" void duckdb_web_fail_with(const char* path) { throw std::runtime_error{std::string{path}}; }

#define GET_WEBDB(PACKED)                                              \
    auto maybe_webdb = WebDB::Get();                                   \
    if (!maybe_webdb.ok()) {                                           \
        WASMResponseBuffer::Get().Store(PACKED, maybe_webdb.status()); \
        return;                                                        \
    }                                                                  \
    auto& webdb = maybe_webdb.ValueUnsafe().get();

#define GET_WEBDB_OR_RETURN(DEFAULT) \
    auto maybe_webdb = WebDB::Get(); \
    if (!maybe_webdb.ok()) {         \
        return DEFAULT;              \
    }                                \
    auto& webdb = maybe_webdb.ValueUnsafe().get();

/// Reset the database
void duckdb_web_reset(WASMResponse* packed) {
    GET_WEBDB(*packed);
    WASMResponseBuffer::Get().Store(*packed, webdb.Reset());
}

/// Create a conn
ConnectionHdl duckdb_web_connect() {
    GET_WEBDB_OR_RETURN(0);
    auto conn = reinterpret_cast<ConnectionHdl>(webdb.Connect());
    return conn;
}
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl) {
    GET_WEBDB_OR_RETURN();
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    webdb.Disconnect(c);
}
/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}
/// Open a database
void duckdb_web_open(WASMResponse* packed, const char* args) {
    GET_WEBDB(*packed);
    WASMResponseBuffer::Get().Store(*packed, webdb.Open(args));
}

/// Get the duckdb version
void duckdb_web_get_version(WASMResponse* packed) {
    GET_WEBDB(*packed);
    WASMResponseBuffer::Get().Store(*packed, webdb.GetVersion());
}

/// Prepare a query statement
void duckdb_web_prepared_create(WASMResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->CreatePreparedStatement(script);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Prepare a query statement
void duckdb_web_prepared_create_buffer(WASMResponse* packed, ConnectionHdl connHdl, const uint8_t* buffer,
                                       size_t buffer_length) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    std::string_view script(reinterpret_cast<const char*>(buffer), buffer_length);
    auto r = c->CreatePreparedStatement(script);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Close a prepared statement
void duckdb_web_prepared_close(WASMResponse* packed, ConnectionHdl connHdl, size_t statement_id) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->ClosePreparedStatement(statement_id);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Execute a prepared statement and fully materialize result
void duckdb_web_prepared_run(WASMResponse* packed, ConnectionHdl connHdl, size_t statement_id, const char* args_json) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunPreparedStatement(statement_id, args_json);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Execute a prepared statement and fully materialize result
void duckdb_web_prepared_send(WASMResponse* packed, ConnectionHdl connHdl, size_t statement_id, const char* args_json) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendPreparedStatement(statement_id, args_json);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Run a query
void duckdb_web_query_run(WASMResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(script);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}

/// Run a query (as a buffer)
void duckdb_web_query_run_buffer(WASMResponse* packed, ConnectionHdl connHdl, const uint8_t* buffer,
                                 size_t buffer_length) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    std::string_view S(reinterpret_cast<const char*>(buffer), buffer_length);
    auto r = c->RunQuery(S);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Start a pending query
void duckdb_web_pending_query_start(WASMResponse* packed, ConnectionHdl connHdl, const char* script,
                                    bool allow_stream_result) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->PendingQuery(script, allow_stream_result);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Start a pending query
void duckdb_web_pending_query_start_buffer(WASMResponse* packed, ConnectionHdl connHdl, const uint8_t* buffer,
                                           size_t buffer_length, bool allow_stream_result) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    std::string_view S(reinterpret_cast<const char*>(buffer), buffer_length);
    auto r = c->PendingQuery(S, allow_stream_result);
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Poll a pending query
void duckdb_web_pending_query_poll(WASMResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->PollPendingQuery();
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
/// Cancel a pending query
bool duckdb_web_pending_query_cancel(ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    return c->CancelPendingQuery();
}
/// Fetch query results
void duckdb_web_query_fetch_results(WASMResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    WASMResponseBuffer::Get().Store(*packed, r);
}
/// Insert arrow from an ipc stream
void duckdb_web_insert_arrow_from_ipc_stream(WASMResponse* packed, ConnectionHdl connHdl, const uint8_t* buffer,
                                             size_t buffer_length, const char* options) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->InsertArrowFromIPCStream(std::span{buffer, buffer_length}, std::string_view{options});
    WASMResponseBuffer::Get().Store(*packed, std::move(r));
}
}
