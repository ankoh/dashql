// Copyright (c) 2020 The DashQL Authors

#include <cstdint>

#include "dashql/common/ffi_response.h"

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
ConnectionHdl duckdb_web_connect();
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl);
/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl);
/// Run a query
void duckdb_web_run_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer);
/// Send a query
void duckdb_web_send_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer);
/// Fetch query results
void duckdb_web_fetch_query_results(dashql::FFIResponse* packed, ConnectionHdl connHdl);
/// Analyze a query
void duckdb_web_analyze_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* text);
/// Import CSV from a file
void duckdb_web_import_csv(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* filePath,
                           const char* schemaName, const char* tableName);
/// Import JSON from string
void duckdb_web_import_json(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* jsonString,
                            const char* schemaName, const char* tableName);
}
