// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"

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
}
