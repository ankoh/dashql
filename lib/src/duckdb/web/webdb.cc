// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <cstdio>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "dashql/proto_generated.h"
#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/main/appender.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"
#include "duckdb/web/codec.h"
#include "duckdb/web/filesystem.h"
#include "duckdb/web/partitioner.h"
#include "flatbuffers/flatbuffers.h"
#include "parquet-extension.hpp"
#include "rapidjson/error/en.h"
#include "rapidjson/reader.h"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
namespace p = duckdb::web::proto;

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = nullptr;
    if (db == nullptr) {
        db = std::make_unique<WebDB>();
    }
    return *db;
}

/// Constructor
WebDB::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database_(std::move(db)),
      connection_(*database_),
      current_query_id_(),
      current_query_result_(),
      current_stream_partitioner_() {}

/// Get the filesystem attached to the database of this connection
duckdb::FileSystem& WebDB::Connection::GetFileSystem() { return database_->GetFileSystem(); }

/// Run a SQL query
dashql::ExpectedBuffer<p::QueryResult> WebDB::Connection::RunQuery(std::string_view text,
                                                                   const QueryRunOptions& options) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {dashql::ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_.reset();
        current_stream_partitioner_.reset();
        auto query_id = ++current_query_id_;

        // Create stream partitioner (if necessary)
        std::optional<Partitioner> partitioner = std::nullopt;
        if (!options.partition_boundaries.empty()) {
            partitioner.emplace(Partitioner{*result, options.partition_boundaries});
        }
        PartitionBoundaries partitionBoundaries;

        // Encode result chunks
        fb::FlatBufferBuilder builder{1024};
        std::vector<flatbuffers::Offset<proto::QueryResultChunk>> chunks;
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Pass chunk to stream partitioner
            if (partitioner) {
                if (partitionBoundaries.size() < chunk->size()) {
                    partitionBoundaries.resize(chunk->size(), 0);
                }
                std::fill(partitionBoundaries.begin(), partitionBoundaries.begin() + chunk->size(), 0);
                partitioner->consumeChunk(*chunk, partitionBoundaries);
            }

            // Write flatbuffer
            auto chunk_ofs = WriteQueryResultChunk(builder, *result, query_id, chunk.get(), partitionBoundaries);
            chunks.push_back(chunk_ofs);
        }
        auto chunkVec = builder.CreateVector(std::move(chunks));

        // Write the result buffer
        auto query_result_ofs = WriteQueryResult(builder, *result, query_id, chunkVec);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {dashql::ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Start a SQL query
dashql::ExpectedBuffer<p::QueryResult> WebDB::Connection::SendQuery(std::string_view text,
                                                                    const QueryRunOptions& options) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {dashql::ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_ = move(result);
        current_stream_partitioner_.reset();

        // Create stream partitioner (if necessary)
        if (!options.partition_boundaries.empty()) {
            current_stream_partitioner_ = std::make_unique<Partitioner>(*result, options.partition_boundaries);
        }

        // Encode no result chunks
        fb::FlatBufferBuilder builder{1024};
        std::vector<flatbuffers::Offset<proto::QueryResultChunk>> chunks;
        auto chunkVec = builder.CreateVector(std::move(chunks));
        auto query_result_ofs = WriteQueryResult(builder, *current_query_result_, ++current_query_id_, chunkVec);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {dashql::ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Fetch query results
dashql::ExpectedBuffer<p::QueryResultChunk> WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        nonstd::span<duckdb::LogicalType> types;
        if (current_query_result_ != nullptr) {
            chunk = current_query_result_->Fetch();
            types = current_query_result_->types;
        }
        if (!current_query_result_->success)
            return {dashql::ErrorCode::QUERY_FAILED, move(current_query_result_->error)};

        // Encode the partition mask (if configured)
        PartitionBoundaries partitionBoundaries;
        if (current_stream_partitioner_ && !!chunk) {
            partitionBoundaries.resize(chunk->size(), 0);
            current_stream_partitioner_->consumeChunk(*chunk, partitionBoundaries);
        }

        // Get query result
        fb::FlatBufferBuilder builder{128};
        auto ofs =
            WriteQueryResultChunk(builder, *current_query_result_, current_query_id_, chunk.get(), partitionBoundaries);
        builder.Finish(ofs);

        // Last chunk?
        if (chunk && chunk->size() == 0) current_query_result_.reset();
        return {builder.Release()};
    } catch (std::exception& e) {
        return {dashql::ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Analyze a SQL query
dashql::ExpectedBuffer<p::QueryPlan> WebDB::Connection::AnalyzeQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database_};
    duckdb::Parser parser;
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();
    // Invalid statement count?
    if (parser.statements.size() != 1) return dashql::ErrorCode::INVALID_REQUEST;

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Write the plan buffer
    fb::FlatBufferBuilder builder{1024};
    auto plan_ofs = WriteQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(plan_ofs);
    return {builder.Release()};
}

/// Import CSV from a file
dashql::Signal WebDB::Connection::ImportCSV(std::string filePath, std::string schema, std::string table) {
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
        return dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR) << e.what();
    }

    auto createSchema = RunQuery("CREATE SCHEMA IF NOT EXISTS " + schema);
    if (createSchema.IsErr()) {
        return createSchema.ReleaseError();
    }

    std::string create = "CREATE TABLE " + schema + "." + table + " (";
    for (size_t i = 0; i < columns.size(); ++i) {
        auto const& c = columns[i];
        create += c.name + " " + c.type.ToString();
        if (i < columns.size() - 1) create += ',';
    }
    create += ");";

    auto createTable = RunQuery(create);
    if (createTable.IsErr()) {
        return createTable.ReleaseError();
    }

    // Insert Data
    try {
        auto ctx = connection_.context;
        ctx->Append(*ctx->TableInfo(schema.data(), table.data()), output_chunk);

        return dashql::Signal::OK();
    } catch (const std::exception& e) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << e.what();
    }
}

static dashql::Signal ImportJSONAppendValue(duckdb::Appender& appender, duckdb::ColumnDefinition const& col, size_t row,
                                            rapidjson::Value const& val) {
    if (val.IsNull()) {
        appender.Append(duckdb::Value());
        return dashql::Signal::OK();
    }

    switch (col.type.id()) {
        case duckdb::LogicalTypeId::BOOLEAN: {
            if (!val.IsBool()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected boolean value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetBool());
            break;
        }
        case duckdb::LogicalTypeId::CHAR:
        case duckdb::LogicalTypeId::VARCHAR: {
            if (!val.IsString()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected string value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetString());
            break;
        }
        case duckdb::LogicalTypeId::INTEGER: {
            if (!val.IsInt()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected int value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetInt());
            break;
        }
        case duckdb::LogicalTypeId::UINTEGER: {
            if (!val.IsUint()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected unsigned int value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetUint());
            break;
        }
        case duckdb::LogicalTypeId::BIGINT: {
            if (!val.IsInt64()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected int64 value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetInt64());
            break;
        }
        case duckdb::LogicalTypeId::UBIGINT: {
            if (!val.IsUint64()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected unsigned int64 value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetUint64());
            break;
        }
        case duckdb::LogicalTypeId::DOUBLE: {
            if (!val.IsDouble()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                       << "Expected double value in column \"" << col.name << "\" in row " << row;
            }
            appender.Append(val.GetDouble());
            break;
        }
        default:
            return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                   << "Unexpected JSON value encountered in column \"" << col.name << "\" in row " << row;
    }

    return dashql::Signal::OK();
}

dashql::Signal WebDB::Connection::ImportJSONColumnMajor(rapidjson::Document const& json, std::string schema,
                                                        std::string table) {
    if (json.MemberCount() == 0) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << "Top-level object was found empty.";
    }
    auto const& object = json.GetObject();

    std::vector<duckdb::ColumnDefinition> columns;
    std::unordered_set<std::string> nullColumns;
    size_t columnLength = 0;

    // go through array to collect first per-column type information
    // (need to check multiple rows in case a value is null)
    for (auto const& member : object) {
        auto const& array = member.value.GetArray();
        const std::string name(member.name.GetString());
        if (array.Size() == 0) {
            return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                   << "Array for column \"" << name << "\" was found empty.";
        }

        if (columnLength == 0) {
            columnLength = array.Size();
        } else if (columnLength != array.Size()) {
            return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << "Inconsistent array lengths encountered.";
        }

        for (size_t i = 0; i < std::min((size_t)5, (size_t)array.Size()); ++i) {
            auto const& value = array[i];
            duckdb::LogicalType type;

            switch (value.GetType()) {
                case rapidjson::Type::kTrueType:
                case rapidjson::Type::kFalseType:
                    type = duckdb::LogicalType::BOOLEAN;
                    break;
                case rapidjson::Type::kStringType:
                    type = duckdb::LogicalType::VARCHAR;
                    break;
                case rapidjson::Type::kNumberType:
                    if (value.IsInt()) {
                        type = duckdb::LogicalType::INTEGER;
                        break;
                    } else if (value.IsUint()) {
                        type = duckdb::LogicalType::UINTEGER;
                        break;
                    } else if (value.IsInt64()) {
                        type = duckdb::LogicalType::BIGINT;
                        break;
                    } else if (value.IsUint64()) {
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
                    return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                           << "Unsupported JSON member type for column \"" << name << '"';
            }

            if (type != duckdb::LogicalType::INVALID) {
                nullColumns.erase(name);
                columns.emplace_back(name, type);
                break;
            } else {
                nullColumns.emplace(name);
            }
        }
    }

    if (!nullColumns.empty()) {
        auto err = dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                   << "Could not determine column type for column(s): ";
        for (auto const& c : nullColumns) err << c << ',';

        return err;
    }

    auto createSchema = RunQuery("CREATE SCHEMA IF NOT EXISTS " + schema);
    if (createSchema.IsErr()) {
        return createSchema.ReleaseError();
    }

    std::string create = "CREATE TABLE " + schema + "." + table + " (";
    for (size_t i = 0; i < columns.size(); ++i) {
        auto const& c = columns[i];
        create += c.name + " " + c.type.ToString();
        if (i < columns.size() - 1) create += ",";
    }
    create += ");";

    auto createTable = RunQuery(create);
    if (createTable.IsErr()) {
        return createTable.ReleaseError();
    }

    try {
        duckdb::Appender appender(connection_, schema, table);
        for (size_t i = 0; i < columnLength; ++i) {
            appender.BeginRow();
            size_t columnIndex = 0;
            for (auto const& member : object) {
                auto const& val = member.value.GetArray()[i];

                auto result = ImportJSONAppendValue(appender, columns[columnIndex], i, val);

                if (result.IsErr()) {
                    return result.ReleaseError();
                }

                columnIndex++;
            }
            appender.EndRow();
        }
        appender.Close();
    } catch (std::exception const& e) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << e.what();
    }

    return dashql::Signal::OK();
}

dashql::Signal WebDB::Connection::ImportJSONRowMajor(rapidjson::Document const& json, std::string schema,
                                                     std::string table) {
    if (json.Size() == 0) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << "Top-level array was found empty.";
    }
    auto const& array = json.GetArray();

    std::vector<duckdb::ColumnDefinition> columns;
    std::unordered_map<std::string, duckdb::LogicalType> typedColumns;
    std::unordered_set<std::string> nullColumns;

    // go through array to collect first per-column type information
    // (need to check multiple rows in case a value is null)
    for (size_t i = 0; i < std::min((size_t)5, (size_t)array.Size()); ++i) {
        auto const& row = array[i];

        if (!row.IsObject()) {
            return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << "Array elements must be objects.";
        }

        for (auto const& member : row.GetObject()) {
            duckdb::LogicalType type;
            const std::string name(member.name.GetString());
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
                    return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                           << "Unsupported JSON member type for column \"" << name << '"';
            }

            auto existing = typedColumns.find(name);

            if (type != duckdb::LogicalType::INVALID) {
                if (existing != typedColumns.end() && existing->second != type) {
                    return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                           << "Conflicting value types encountered for column \"" << name << '"';
                }
                nullColumns.erase(name);
                typedColumns.emplace(name, type);
                columns.emplace_back(name, type);
            } else if (existing == typedColumns.end()) {
                // only mark as null column if no type previously encountered
                nullColumns.emplace(name);
            }
        }

        // all columns cleared? exit out
        if (nullColumns.empty()) break;
    }

    if (!nullColumns.empty()) {
        auto err = dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                   << "Could not determine column type for column(s): ";
        for (auto const& c : nullColumns) err << c << ',';

        return err;
    }

    auto createSchema = RunQuery("CREATE SCHEMA IF NOT EXISTS " + schema);
    if (createSchema.IsErr()) {
        return createSchema.ReleaseError();
    }

    std::string create = "CREATE TABLE " + schema + "." + table + " (";
    for (size_t i = 0; i < columns.size(); ++i) {
        auto const& c = columns[i];
        create += c.name + " " + c.type.ToString();
        if (i < columns.size() - 1) create += ",";
    }
    create += ");";

    auto createTable = RunQuery(create);
    if (createTable.IsErr()) {
        return createTable.ReleaseError();
    }

    try {
        duckdb::Appender appender(connection_, schema, table);
        for (size_t i = 0; i < array.Size(); ++i) {
            auto const& row = array[i];
            if (!row.IsObject()) {
                return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << "Array elements must be objects.";
            }

            auto const& obj = row.GetObject();

            appender.BeginRow();
            for (auto const& col : columns) {
                if (!obj.HasMember(col.name.c_str())) {
                    return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
                           << "Missing value in column \"" << col.name << "\" in row " << i;
                }

                auto const& val = obj[col.name.c_str()];

                auto result = ImportJSONAppendValue(appender, col, i, val);

                if (result.IsErr()) {
                    return result.ReleaseError();
                }
            }
            appender.EndRow();
        }
        appender.Close();
    } catch (std::exception const& e) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << e.what();
    }

    return dashql::Signal::OK();
}

/// Import JSON string (object of columns or array of rows) into the given table
dashql::Signal WebDB::Connection::ImportJSON(std::string_view json, std::string schema, std::string table) {
    rapidjson::Document document;
    rapidjson::ParseResult ok = document.Parse(json.data());
    if (!ok) {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR) << rapidjson::GetParseError_En(ok.Code());
    }

    if (document.IsArray()) {
        return ImportJSONRowMajor(document, schema, table);
    } else if (document.IsObject()) {
        return ImportJSONColumnMajor(document, schema, table);
    } else {
        return dashql::Error(dashql::ErrorCode::INTERNAL_ERROR)
               << "Unexpected top level JSON element. Must be array of objects or object of arrays";
    }
}

/// Constructor
WebDB::WebDB() : database_(), connections_(), db_config_() {
#ifdef EMSCRIPTEN
    db_config_.file_system = std::make_unique<WebDBFileSystem>();
#endif
    database_ = std::make_shared<duckdb::DuckDB>(nullptr, &db_config_);
    database_->LoadExtension<duckdb::ParquetExtension>();
}

/// Create a session
WebDB::Connection* WebDB::Connect() {
    auto conn = std::make_unique<WebDB::Connection>(database_);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, move(conn)});
    return conn_ptr;
}

/// Get the filesystem attached to the database
duckdb::FileSystem& WebDB::GetFileSystem() { return database_->GetFileSystem(); }

/// End a session
void WebDB::Disconnect(Connection* session) { connections_.erase(session); }

}  // namespace web
}  // namespace duckdb
