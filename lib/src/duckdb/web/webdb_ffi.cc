// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "duckdb/catalog/catalog.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parsed_data/create_schema_info.hpp"
#include "duckdb/parser/parsed_data/create_table_info.hpp"
#include "duckdb/planner/binder.hpp"
#include "duckdb/web/filesystem.h"
#include "duckdb/web/webdb.h"
#include "parquet-extension.hpp"

using namespace duckdb::web;

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
ConnectionHdl duckdb_web_connect() { return reinterpret_cast<ConnectionHdl>(WebDB::GetInstance().Connect()); }
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
void duckdb_web_run_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::QueryArguments>(args_buffer);
    QueryRunOptions options;
    if (auto pb = args->partition_boundaries()) {
        options.partition_boundaries = {pb->begin(), pb->end()};
    }
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(args->script()->string_view(), options);
    dashql::FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Send a query
void duckdb_web_send_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const void* args_buffer) {
    auto* args = flatbuffers::GetRoot<proto::QueryArguments>(args_buffer);
    QueryRunOptions options;
    if (auto pb = args->partition_boundaries()) {
        options.partition_boundaries = {pb->begin(), pb->end()};
    }
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(args->script()->string_view(), options);
    dashql::FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Fetch query results
void duckdb_web_fetch_query_results(dashql::FFIResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    dashql::FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Analyze a query
void duckdb_web_analyze_query(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* text) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->AnalyzeQuery(text);
    dashql::FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Import CSV from a file
void duckdb_web_import_csv(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* filePath,
                           const char* schemaName, const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    duckdb::DataChunk output_chunk;
    duckdb::BufferedCSVReaderOptions options;
    options.auto_detect = true;
    auto& fs = WebDB::GetInstance().GetFileSystem();
    auto handle = fs.OpenFile(filePath, duckdb::FileFlags::FILE_FLAGS_READ);
    duckdb::web::FileSystemStreamBuffer streambuf(fs, *handle);

    std::vector<duckdb::ColumnDefinition> columns;

    // Parse CSV
    try {
        duckdb::BufferedCSVReader reader(options, {}, std::make_unique<std::istream>(&streambuf));
        output_chunk.Initialize(reader.sql_types);
        reader.ParseCSV(output_chunk);

        for (size_t i = 0; i < reader.col_names.size(); i++) {
            columns.emplace_back(reader.col_names[i], reader.sql_types[i]);
        }
    } catch (const std::exception& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
        return;
    }

    // Create Table
    auto& ctx = *c->GetConnection().context;
    auto& catalog = duckdb::Catalog::GetCatalog(ctx);

    duckdb::SchemaCatalogEntry* schema = nullptr;
    try {
        schema = catalog.GetSchema(ctx, schemaName);
    } catch (duckdb::CatalogException const& e) {
        auto info = std::make_unique<duckdb::CreateSchemaInfo>();
        info->schema = schemaName;
        schema = (duckdb::SchemaCatalogEntry*)catalog.CreateSchema(ctx, info.get());
    }

    try {
        auto info = std::make_unique<duckdb::CreateTableInfo>(schemaName, tableName);
        info->columns = std::move(columns);

        duckdb::Binder binder(ctx);
        auto bound_info = binder.BindCreateTableInfo(move(info));
        catalog.CreateTable(ctx, bound_info.get());
    } catch (const std::exception& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
        return;
    }

    // Insert Data
    try {
        ctx.Append(*ctx.TableInfo(schemaName, tableName), output_chunk);
    } catch (const std::exception& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
        return;
    }

    dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Signal::OK());
}

void duckdb_web_import_json(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* jsonString,
                            const char* schemaName, const char* tableName) {}
}
