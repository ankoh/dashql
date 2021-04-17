// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "arrow/buffer.h"
#include "arrow/status.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/wasm_response.h"
#include "duckdb/web/webdb.h"

using namespace duckdb::web;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Clear the response buffer
void duckdb_web_clear_response() { WASMResponseBuffer::GetInstance().Clear(); }

/// Create a conn
ConnectionHdl duckdb_web_connect() {
    auto conn = reinterpret_cast<ConnectionHdl>(WebDB::GetInstance().Connect());
    return conn;
}
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    WebDB::GetInstance().Disconnect(c);
}
/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}
/// Flush all file buffers
void duckdb_web_flush_files() {
    auto& webdb = WebDB::GetInstance();
    webdb.FlushFiles();
}
/// Flush file buffer by path
void duckdb_web_flush_file(const char* path) {
    auto& webdb = WebDB::GetInstance();
    webdb.FlushFile(path);
}
/// Run a query
void duckdb_web_query_run(WASMResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(script);
    WASMResponseBuffer::GetInstance().Store(*packed, std::move(r));
}
/// Send a query
void duckdb_web_query_send(WASMResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(script);
    WASMResponseBuffer::GetInstance().Store(*packed, std::move(r));
}
/// Fetch query results
void duckdb_web_query_fetch_results(WASMResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    WASMResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

static void RaiseExtensionNotLoaded(WASMResponse* packed, std::string_view ext) {
    WASMResponseBuffer::GetInstance().Store(
        *packed, arrow::Status(arrow::StatusCode::NotImplemented, "Extension is not loaded: " + std::string{ext}));
}

/// Load zip from file
void duckdb_web_zip_load_file(WASMResponse* packed, const char* filePath) {
    auto& webdb = WebDB::GetInstance();
    if (!webdb.zip()) return RaiseExtensionNotLoaded(packed, "zip");
    auto archiveID = webdb.zip()->LoadFromFile(filePath);
    WASMResponseBuffer::GetInstance().Store(*packed, archiveID);
}
/// Get the zip entry count
void duckdb_web_zip_read_entry_count(WASMResponse* packed) {
    auto& webdb = WebDB::GetInstance();
    if (!webdb.zip()) return RaiseExtensionNotLoaded(packed, "zip");
    auto count = webdb.zip()->ReadEntryCount();
    WASMResponseBuffer::GetInstance().Store(*packed, count);
}
/// Get the zip entry count
void duckdb_web_zip_read_entry_info(WASMResponse* packed, size_t entryID) {
    auto& webdb = WebDB::GetInstance();
    if (!webdb.zip()) return RaiseExtensionNotLoaded(packed, "zip");
    auto entry_info = webdb.zip()->ReadEntryInfoAsJSON(entryID);
    WASMResponseBuffer::GetInstance().Store(*packed, entry_info);
}
/// Extract entry to file
void duckdb_web_zip_extract_entry_to_file(WASMResponse* packed, size_t entryID, const char* out) {
    auto& webdb = WebDB::GetInstance();
    if (!webdb.zip()) return RaiseExtensionNotLoaded(packed, "zip");
    auto bytes = webdb.zip()->ExtractEntryToFile(entryID, out);
    WASMResponseBuffer::GetInstance().Store(*packed, bytes);
}
}
