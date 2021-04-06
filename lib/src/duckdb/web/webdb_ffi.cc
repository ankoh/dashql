// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <unordered_set>

#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/main/appender.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/web/filesystem.h"
#include "duckdb/web/webdb.h"
#include "parquet-extension.hpp"
#include "rapidjson/document.h"
#include "rapidjson/error/en.h"
#include "rapidjson/reader.h"

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

    std::string schemaStr(schemaName);
    std::string tableStr(tableName);

    c->RunQuery("CREATE IGNORE SCHEMA \"" + schemaStr + "\";");

    std::string create = "CREATE TABLE \"" + schemaStr + "\".\"" + tableStr + "\" (";
    for (size_t i = 0; i < columns.size(); ++i) {
        auto const& c = columns[i];
        create += c.name + " " + c.type.ToString();
        if (i < columns.size() - 1) create += ",";
    }
    create += ");";

    auto createTable = c->RunQuery(create);
    if (!createTable.IsOk()) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, createTable.ReleaseError());
        return;
    }

    // Insert Data
    try {
        auto& ctx = *c->GetConnection().context;
        auto table = ctx.TableInfo(schemaStr, tableStr);
        ctx.Append(*table, output_chunk);
    } catch (const std::exception& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
        return;
    }

    dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Signal::OK());
}

void duckdb_web_import_json(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* jsonString,
                            const char* schemaName, const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    std::string schemaStr(schemaName);
    std::string tableStr(tableName);

    rapidjson::Document document;
    rapidjson::ParseResult ok = document.Parse(jsonString);
    if (!ok) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << rapidjson::GetParseError_En(ok.Code()));
        return;
    }

    if (!document.IsArray()) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << "Top-level element must be array type.");
        return;
    }
    if (document.Size() == 0) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << "Top-level array was found empty.");
        return;
    }

    auto const& array = document.GetArray();

    std::vector<duckdb::ColumnDefinition> columns;
    std::unordered_set<const char*> nullColumns;

    // go through array to collect first per-column type information
    // (need to check multiple rows in case a value is null)
    for (size_t i = 0; i < std::min((size_t)5, (size_t)array.Size()); ++i) {
        auto const& row = array[i];

        if (!row.IsObject()) {
            dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                        << "Array elements must be objects.");
            return;
        }

        for (auto const& member : row.GetObject()) {
            duckdb::LogicalType type;
            auto const name = member.name.GetString();
            switch (member.value.GetType()) {
                case rapidjson::Type::kTrueType:
                case rapidjson::Type::kFalseType:
                    type = duckdb::LogicalType::BOOLEAN;
                    break;
                case rapidjson::Type::kStringType:
                    type = duckdb::LogicalType::VARCHAR;
                    break;
                case rapidjson::Type::kNumberType:
                    if (member.value.IsInt()) {
                        type = duckdb::LogicalType::INTEGER;
                        break;
                    } else if (member.value.IsUint()) {
                        type = duckdb::LogicalType::UINTEGER;
                        break;
                    } else if (member.value.IsInt64()) {
                        type = duckdb::LogicalType::BIGINT;
                        break;
                    } else if (member.value.IsUint64()) {
                        type = duckdb::LogicalType::UBIGINT;
                        break;
                    } else {
                        type = duckdb::LogicalType::DOUBLE;
                        break;
                    }
                case rapidjson::Type::kNullType:
                    // ignore value and process next row
                    break;
                default:
                    dashql::FFIResponseBuffer::GetInstance().Store(
                        *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                     << "Unsupported JSON member type for column \"" << name << '"');
                    return;
            }

            if (type != duckdb::LogicalType::INVALID) {
                nullColumns.erase(name);
                columns.emplace_back(std::string(name), type);
            } else {
                nullColumns.emplace(name);
            }
        }

        // all columns cleared? exit out
        if (nullColumns.empty()) break;
    }

    if (!nullColumns.empty()) {
        auto err = dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                   << "Could not determine column type for column(s): ";
        for (auto const& c : nullColumns) err << c << ',';

        dashql::FFIResponseBuffer::GetInstance().Store(*packed, err);
        return;
    }

    auto createSchema = c->RunQuery("CREATE SCHEMA \"" + schemaStr + "\";");
    if (!createSchema.IsOk()) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, createSchema.ReleaseError());
        return;
    }

    std::string create = "CREATE TABLE \"" + schemaStr + "\".\"" + tableStr + "\" (";
    for (size_t i = 0; i < columns.size(); ++i) {
        auto const& c = columns[i];
        create += '"' + c.name + "\" " + c.type.ToString();
        if (i < columns.size() - 1) create += ",";
    }
    create += ");";

    auto createTable = c->RunQuery(create);
    if (!createTable.IsOk()) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, createTable.ReleaseError());
        return;
    }

    try {
        duckdb::Appender appender(c->GetConnection(), schemaStr, tableStr);
        for (size_t i = 0; i < array.Size(); ++i) {
            auto const& row = array[i];
            if (!row.IsObject()) {
                dashql::FFIResponseBuffer::GetInstance().Store(
                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR) << "Array elements must be objects.");
                return;
            }

            auto const& obj = row.GetObject();

            appender.BeginRow();
            for (auto const& col : columns) {
                auto const& val = obj[col.name.c_str()];

                if (val.IsNull()) {
                    appender.Append(duckdb::Value());
                } else {
                    switch (col.type.id()) {
                        case duckdb::LogicalTypeId::BOOLEAN: {
                            if (!val.IsBool()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected boolean value in column \"" << col.name << "\" in row "
                                                 << i);
                                return;
                            }
                            appender.Append(val.GetBool());
                            break;
                        }
                        case duckdb::LogicalTypeId::CHAR:
                        case duckdb::LogicalTypeId::VARCHAR: {
                            if (!val.IsString()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected string value in column \"" << col.name << "\" in row "
                                                 << i);
                                return;
                            }
                            appender.Append(val.GetString());
                            break;
                        }
                        case duckdb::LogicalTypeId::INTEGER: {
                            if (!val.IsInt()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected int value in column \"" << col.name << "\" in row " << i);
                                return;
                            }
                            appender.Append(val.GetInt());
                            break;
                        }
                        case duckdb::LogicalTypeId::UINTEGER: {
                            if (!val.IsUint()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected unsigned int value in column \"" << col.name
                                                 << "\" in row " << i);
                                return;
                            }
                            appender.Append(val.GetUint());
                            break;
                        }
                        case duckdb::LogicalTypeId::BIGINT: {
                            if (!val.IsInt64()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected int64 value in column \"" << col.name << "\" in row "
                                                 << i);
                                return;
                            }
                            appender.Append(val.GetInt64());
                            break;
                        }
                        case duckdb::LogicalTypeId::UBIGINT: {
                            if (!val.IsUint64()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected unsigned int64 value in column \"" << col.name
                                                 << "\" in row " << i);
                                return;
                            }
                            appender.Append(val.GetUint64());
                            break;
                        }
                        case duckdb::LogicalTypeId::DOUBLE: {
                            if (!val.IsDouble()) {
                                dashql::FFIResponseBuffer::GetInstance().Store(
                                    *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                 << "Expected double value in column \"" << col.name << "\" in row "
                                                 << i);
                                return;
                            }
                            appender.Append(val.GetDouble());
                            break;
                        }
                        default:
                            dashql::FFIResponseBuffer::GetInstance().Store(
                                *packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                             << "Unexpected JSON value encountered for column \"" << col.name << '"');
                            return;
                    }
                }
            }
            appender.EndRow();
        }
        appender.Close();
    } catch (std::exception const& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
        return;
    }

    dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Signal::OK());
}
}
