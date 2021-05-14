// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <arrow/ipc/options.h>
#include <rapidjson/document.h>

#include <cstdio>
#include <duckdb/common/file_system.hpp>
#include <duckdb/common/types/data_chunk.hpp>
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
#include "dashql/common/defer.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/io/arrow_ifstream.h"
#include "duckdb/web/io/buffered_filesystem.h"
#include "duckdb/web/io/default_filesystem.h"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/io/web_filesystem.h"
#include "duckdb/web/json_table_options.h"
#include "parquet-extension.hpp"

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = std::make_unique<WebDB>();
    return *db;
}

/// Constructor
WebDB::Connection::Connection(WebDB& webdb) : webdb_(webdb), connection_(*webdb.database_) {}

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
            // Write record batch to the output stream
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
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

/// Import a csv file
arrow::Status WebDB::Connection::ImportCSVTable(std::string_view path, std::string_view options_json) {
    try {
        /// Read table options
        rapidjson::Document options_doc;
        options_doc.Parse(options_json.begin(), options_json.size());
        json::TableReaderOptions options;
        ARROW_RETURN_NOT_OK(options.ReadFrom(options_doc));

        /// Read relevant table options
        auto schema_name = options.schema_name.empty() ? "main" : options.schema_name;
        if (options.table_name.empty()) return arrow::Status::Invalid("missing 'name' option");

        // TODO explicitly provided arrow types

        /// Execute the table  function
        std::vector<Value> params;
        params.emplace_back(std::string{path});
        connection_.TableFunction("read_csv_auto", params)->Create(schema_name, options.table_name);

    } catch (const std::exception& e) {
        return arrow::Status::UnknownError(e.what());
    }
    return arrow::Status::OK();
}

/// Import a json file
arrow::Status WebDB::Connection::ImportJSONTable(std::string_view path, std::string_view options) {
    return arrow::Status::NotImplemented("JSON import");
}

/// Constructor
WebDB::WebDB(std::unique_ptr<duckdb::FileSystem> fs)
    : filesystem_buffer_(std::make_shared<io::FileSystemBuffer>(std::move(fs))),
      database_(),
      connections_(),
      db_config_() {
    auto buffered_filesystem = std::make_unique<io::BufferedFileSystem>(filesystem_buffer_);
    db_config_.file_system = std::move(std::move(buffered_filesystem));
    database_ = std::make_shared<duckdb::DuckDB>(nullptr, &db_config_);
    database_->LoadExtension<duckdb::ParquetExtension>();
    zip_ = std::make_unique<Zipper>(filesystem_buffer_);
}

/// Get the version
std::string_view WebDB::GetVersion() { return database_->LibraryVersion(); }

/// Create a session
WebDB::Connection* WebDB::Connect() {
    auto conn = std::make_unique<WebDB::Connection>(*this);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, move(conn)});
    return conn_ptr;
}

/// End a session
void WebDB::Disconnect(Connection* session) { connections_.erase(session); }
/// Flush all file buffers
void WebDB::FlushFiles() { filesystem_buffer_->Flush(); }
/// Flush file by path
void WebDB::FlushFile(std::string_view path) { filesystem_buffer_->FlushFile(path); }

}  // namespace web
}  // namespace duckdb
