// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <arrow/c/bridge.h>

#include <cstdio>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "arrow/io/memory.h"
#include "arrow/ipc/writer.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/filesystem.h"
#include "parquet-extension.hpp"

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = nullptr;
    return *db;
}

/// Constructor
WebDB::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database_(std::move(db)), connection_(*database_), current_query_result_() {}

/// Get the filesystem attached to the database of this connection
duckdb::FileSystem& WebDB::Connection::GetFileSystem() { return database_->GetFileSystem(); }

arrow::Result<nonstd::span<uint8_t>> WebDB::Connection::RunQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, move(result->error)};
        current_query_result_.reset();
        current_schema_.reset();

        // Configure the output writer
        ArrowSchema raw_schema;
        result->ToArrowSchema(&raw_schema);
        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::ipc::MakeFileWriter(&output_stream_buffer_, schema));

        // Write chunk stream
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Import the data chunk as record batch
            ArrowArray array;
            chunk->ToArrowArray(&array);
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));

            // Write record batch to the output stream
            ARROW_RETURN_NOT_OK(out->WriteRecordBatch(*batch));
        }
        ARROW_RETURN_NOT_OK(out->Close());

        return output_stream_buffer_.Access();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<duckdb::QueryResult*> WebDB::Connection::SendQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, move(result->error)};
        current_query_result_ = move(result);

        // Setup record batch stream
        ArrowSchema raw_schema;
        result->ToArrowSchema(&raw_schema);
        ARROW_ASSIGN_OR_RAISE(current_schema_, arrow::ImportSchema(&raw_schema));
        ARROW_ASSIGN_OR_RAISE(current_output_stream_,
                              arrow::ipc::MakeStreamWriter(&output_stream_buffer_, current_schema_));

        return current_query_result_.get();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<nonstd::span<uint8_t>> WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        nonstd::span<duckdb::LogicalType> types;
        if (current_query_result_ != nullptr) {
            chunk = current_query_result_->Fetch();
            types = current_query_result_->types;
        }
        if (!current_query_result_->success)
            return arrow::Status{arrow::StatusCode::ExecutionError, move(current_query_result_->error)};

        // Import the data chunk as record batch
        ArrowArray array;
        chunk->ToArrowArray(&array);
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, current_schema_));

        // Write record batch
        ARROW_RETURN_NOT_OK(output_stream_buffer_.Clear());
        ARROW_RETURN_NOT_OK(current_output_stream_->WriteRecordBatch(*batch));

        // Return view into buffer
        return output_stream_buffer_.Access();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

/// Constructor
WebDB::WebDB() : database_(), connections_(), db_config_() {
    db_config_.file_system = std::make_unique<WebDBFileSystem>();
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
