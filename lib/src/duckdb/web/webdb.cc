// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <arrow/ipc/options.h>

#include <cstdio>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "arrow/buffer.h"
#include "arrow/c/bridge.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/writer.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "arrow/type_fwd.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/filesystem.h"
#include "parquet-extension.hpp"

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = std::make_unique<WebDB>();
    return *db;
}

/// Constructor
WebDB::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database_(std::move(db)), connection_(*database_), current_query_result_() {}

/// Get the filesystem attached to the database of this connection
duckdb::FileSystem& WebDB::Connection::GetFileSystem() { return database_->GetFileSystem(); }

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunQuery(std::string_view text) {
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
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
        ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

        // Write chunk stream
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Import the data chunk as record batch
            ArrowArray array;
            chunk->ToArrowArray(&array);
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));

            // Write record batch to the output stream
            ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
        }
        ARROW_RETURN_NOT_OK(writer->Close());
        return out->Finish();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::SendQuery(std::string_view text) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return arrow::Status{arrow::StatusCode::ExecutionError, move(result->error)};
        current_query_result_ = move(result);
        current_schema_.reset();

        // Import the schema
        ArrowSchema raw_schema;
        current_query_result_->ToArrowSchema(&raw_schema);
        ARROW_ASSIGN_OR_RAISE(current_schema_, arrow::ImportSchema(&raw_schema));

        // Serialize the schema
        return arrow::ipc::SerializeSchema(*current_schema_);
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        if (current_query_result_ == nullptr) {
            return nullptr;
        }

        // Fetch next result chunk
        chunk = current_query_result_->Fetch();
        if (!current_query_result_->success) {
            return arrow::Status{arrow::StatusCode::ExecutionError, move(current_query_result_->error)};
        }

        // Reached end?
        if (!chunk) {
            current_query_result_.reset();
            current_schema_.reset();
            return nullptr;
        }

        // Serialize the record batch
        ArrowArray array;
        chunk->ToArrowArray(&array);
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, current_schema_));
        return arrow::ipc::SerializeRecordBatch(*batch, arrow::ipc::IpcWriteOptions::Defaults());
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
