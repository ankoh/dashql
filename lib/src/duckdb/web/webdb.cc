// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/webdb.h"

#include <arrow/ipc/options.h>

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
#include "duckdb/web/io/web_filesystem.h"
#include "parquet-extension.hpp"

namespace duckdb {
namespace web {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = std::make_unique<WebDB>();
    return *db;
}

/// Constructor
WebDB::Connection::Connection(WebDB& webdb) : webdb_(webdb), connection_(*webdb.database_), current_query_result_() {}

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
        // XXX
        std::vector<ArrowSchema*> cols;
        for (auto i = 0; i < raw_schema.n_children; ++i) {
            cols.push_back(raw_schema.children[i]);
        }
        // XXX
        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
        ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

        // Write chunk stream
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Import the data chunk as record batch
            ArrowArray array;
            chunk->ToArrowArray(&array);
            // XXX
            std::vector<ArrowArray*> cols;
            for (auto i = 0; i < array.n_children; ++i) {
                cols.push_back(array.children[i]);
            }
            // XXX
            // Write record batch to the output stream
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
            ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
            // XXX
            for (auto* col : cols) {
                col->release(col);
            }
            // XXX
        }
        // XXX
        for (auto* schema : cols) {
            schema->release(schema);
        }
        // XXX
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

        // XXX
        std::vector<ArrowSchema*> cols;
        for (auto i = 0; i < raw_schema.n_children; ++i) {
            cols.push_back(raw_schema.children[i]);
        }
        // XXX

        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

        // XXX
        for (auto* col : cols) {
            col->release(col);
        }
        // XXX

        // Serialize the schema
        return arrow::ipc::SerializeSchema(*schema);
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
WebDB::WebDB()
    : buffer_manager_(std::make_shared<io::BufferManager>(io::CreateDefaultFileSystem())),
      database_(),
      connections_(),
      db_config_() {
    auto buffered_filesystem = std::make_unique<io::BufferedFileSystem>(buffer_manager_);
    db_config_.file_system = std::move(std::move(buffered_filesystem));
    database_ = std::make_shared<duckdb::DuckDB>(nullptr, &db_config_);
    database_->LoadExtension<duckdb::ParquetExtension>();
    zip_ = std::make_unique<Zipper>(buffer_manager_);
}

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
void WebDB::FlushFiles() { buffer_manager_->Flush(); }

}  // namespace web
}  // namespace duckdb
