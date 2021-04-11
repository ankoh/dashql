// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "arrow/buffer.h"
#include "arrow/status.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/filesystem.h"
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

/// Import CSV from a file
void duckdb_web_csv_import(WASMResponse* packed, ConnectionHdl connHdl, const char* filePath, const char* schemaName,
                           const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    using LT = duckdb::LogicalType;

    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);

    duckdb::BufferedCSVReaderOptions options;
    options.num_cols = 3;
    auto& fs = WebDB::GetInstance().GetFileSystem();
    auto handle = fs.OpenFile(filePath, duckdb::FileFlags::FILE_FLAGS_READ);
    duckdb::web::FileSystemStreamBuffer streambuf(fs, *handle);
    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(&streambuf));
        reader.ParseCSV(output_chunk);
        WASMResponseBuffer::GetInstance().Store(*packed, arrow::Status::OK());
    } catch (const std::exception& e) {
        WASMResponseBuffer::GetInstance().Store(*packed, arrow::Status(arrow::StatusCode::ExecutionError, e.what()));
    }
}

static void RaiseExtensionNotLoaded(WASMResponse* packed, std::string_view ext) {
    WASMResponseBuffer::GetInstance().Store(
        *packed, arrow::Status(arrow::StatusCode::NotImplemented, "Extension is not loaded: " + std::string{ext}));
}

/// Load zip from file
void duckdb_web_zip_load_file(WASMResponse* packed, const char* filePath) {
    auto& webdb = WebDB::GetInstance();
    auto* zip = webdb.Zip();
    if (!zip) return RaiseExtensionNotLoaded(packed, "zip");
    auto status = zip->LoadFromFile(filePath);
}
/// Get the zip entry count
void duckdb_web_zip_read_entry_count(WASMResponse* packed, size_t archiveID) {
    auto& webdb = WebDB::GetInstance();
    auto* zip = webdb.Zip();
    if (zip) return RaiseExtensionNotLoaded(packed, "zip");
    auto count = zip->GetEntryCount(archiveID);
}
/// Get the zip entry count
void duckdb_web_zip_read_entry_info(WASMResponse* packed, size_t archiveID, size_t entryID) {
    auto& webdb = WebDB::GetInstance();
    auto* zip = webdb.Zip();
    if (zip) return RaiseExtensionNotLoaded(packed, "zip");
    auto entry_info = zip->GetEntryInfoAsJSON(archiveID, entryID);
}
}
