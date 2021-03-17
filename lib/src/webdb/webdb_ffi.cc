// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/filesystem.h"
#include "dashql/webdb/webdb.h"
#include "parquet-extension.hpp"

using namespace dashql;
using namespace dashql::webdb;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
ConnectionHdl dashql_webdb_connect() { return reinterpret_cast<ConnectionHdl>(WebDB::GetInstance().Connect()); }
/// End a conn
void dashql_webdb_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    WebDB::GetInstance().Disconnect(c);
}

/// Access a buffer
void* dashql_webdb_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void dashql_webdb_run_query(FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::webdb::QueryArguments>(args_buffer);
    QueryRunOptions options;
    if (auto pb = args->partition_boundaries()) {
        options.partition_boundaries = {pb->begin(), pb->end()};
    }
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(args->script()->string_view(), options);
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Send a query
void dashql_webdb_send_query(FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::webdb::QueryArguments>(args_buffer);
    QueryRunOptions options;
    if (auto pb = args->partition_boundaries()) {
        options.partition_boundaries = {pb->begin(), pb->end()};
    }
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(args->script()->string_view(), options);
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Fetch query results
void dashql_webdb_fetch_query_results(FFIResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Analyze a query
void dashql_webdb_analyze_query(FFIResponse* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Small test for WebDB file system
bool dashql_webdb_fs_test(FFIResponse* packed) {
    duckdb::DBConfig config;
    config.file_system = std::make_unique<WebDBFileSystem>();

    auto db = std::make_unique<duckdb::DuckDB>(nullptr, &config);
    db->LoadExtension<duckdb::ParquetExtension>();
    auto con = duckdb::Connection{*db};
    auto result = con.Query("SELECT * FROM parquet_scan('./data/studenten.parquet');");
    return result->ToString() ==
           "MatrNr\tName\tSemester\t\nINTEGER\tVARCHAR\tINTEGER\t\n"
           "[ Rows: 8]\n"
           "24002\tXenokrates\t18\t\n"
           "25403\tJonas\t12\t\n"
           "26120\tFichte\t10\t\n"
           "26830\tAristoxenos\t8\t\n"
           "27550\tSchopenhauer\t6\t\n"
           "28106\tCarnap\t3\t\n"
           "29120\tTheophrastos\t2\t\n"
           "29555\tFeuerbach\t2\t\n\n";
}
}
