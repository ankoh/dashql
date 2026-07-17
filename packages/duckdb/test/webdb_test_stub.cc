// Test stub implementation for WebDB (native builds only)
#include <rapidjson/document.h>

#include "arrow/buffer.h"
#include "arrow/c/bridge.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/writer.h"
#include "duckdb.hpp"
#include "duckdb/common/arrow/arrow_converter.hpp"
#include "duckdb/web/webdb.h"

namespace duckdb {
namespace web {

WebDB::WebDB(WebTag) : WebDB(NativeTag{}) {}

WebDB::WebDB(NativeTag, duckdb::unique_ptr<duckdb::FileSystem> fs) {
    config_ = std::make_shared<WebDBConfig>();
    DBConfig db_config;
    db_config.SetOptionByName("autoinstall_known_extensions", Value::BOOLEAN(false));
    db_config.SetOptionByName("autoload_known_extensions", Value::BOOLEAN(false));
    database_ = duckdb::make_shared_ptr<DuckDB>(nullptr, &db_config);
}

WebDB::~WebDB() { connections_.clear(); }

WebDB::Connection::Connection(WebDB& webdb)
    : webdb_(webdb), connection_(*webdb.database_), arrow_ipc_stream_(nullptr) {}

WebDB::Connection::~Connection() = default;

// Run query
arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunQuery(std::string_view text) {
    try {
        auto result = connection_.SendQuery(std::string{text});
        if (result->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::string("Query error: ") + result->GetError()};
        }

        // Configure Arrow schema
        try {
            ArrowSchema raw_schema;
            ClientProperties options("UTC", ArrowOffsetSize::REGULAR, false, false, false, ArrowFormatVersion::V1_0,
                                     connection_.context);
            // Note: extension types not supported in test stub - use empty map
            duckdb::unordered_map<idx_t, const duckdb::shared_ptr<ArrowTypeExtensionData>> extension_type_cast;
            ArrowConverter::ToArrowSchema(&raw_schema, result->types, result->names, options);
            ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

            // Create Arrow IPC file writer
            ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
            ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

            // Write data chunks
            for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
                ArrowArray array;
                ArrowConverter::ToArrowArray(*chunk, &array, options, extension_type_cast);
                ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
                ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
            }
            ARROW_RETURN_NOT_OK(writer->Close());
            return out->Finish();
        } catch (std::exception& e) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::string("Arrow conversion error: ") + e.what()};
        }
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, std::string("SendQuery error: ") + e.what()};
    }
}

// Stream query result
arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::StreamQueryResult(
    duckdb::unique_ptr<duckdb::QueryResult> result) {
    return arrow::Status::NotImplemented("StreamQueryResult stub");
}

// Execute prepared statement
arrow::Result<duckdb::unique_ptr<duckdb::QueryResult>> WebDB::Connection::ExecutePreparedStatement(
    size_t statement_id, std::string_view args_json) {
    try {
        auto it = prepared_statements_.find(statement_id);
        if (it == prepared_statements_.end()) {
            return arrow::Status{arrow::StatusCode::Invalid, "statement not found"};
        }

        // Parse JSON args if provided
        duckdb::vector<duckdb::Value> values;
        if (!args_json.empty()) {
            rapidjson::Document args_doc;
            rapidjson::ParseResult ok = args_doc.Parse(args_json.data(), args_json.size());
            if (!ok) {
                return arrow::Status{arrow::StatusCode::Invalid, "Failed to parse arguments JSON"};
            }
            if (!args_doc.IsArray()) {
                return arrow::Status{arrow::StatusCode::Invalid, "Arguments must be given as array"};
            }

            for (const auto& v : args_doc.GetArray()) {
                if (v.IsLosslessDouble())
                    values.emplace_back(v.GetDouble());
                else if (v.IsString())
                    values.emplace_back(duckdb::string_t(v.GetString(), v.GetStringLength()));
                else if (v.IsNull())
                    values.emplace_back(nullptr);
                else if (v.IsBool())
                    values.emplace_back(v.GetBool());
                else
                    return arrow::Status{arrow::StatusCode::Invalid, "Invalid argument type"};
            }
        }

        auto result = it->second->Execute(values);
        if (result->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, result->GetError()};
        }
        return result;
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

// Pending query
arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::PendingQuery(std::string_view text,
                                                                              bool allow_stream_result) {
    return RunQuery(text);  // Simple implementation: run synchronously
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::PollPendingQuery() {
    return arrow::Status::NotImplemented("PollPendingQuery stub");
}

bool WebDB::Connection::CancelPendingQuery() { return false; }

DuckDBWasmResultsWrapper WebDB::Connection::FetchQueryResults() {
    return DuckDBWasmResultsWrapper(arrow::Status::NotImplemented("FetchQueryResults stub"));
}

// Prepared statements
arrow::Result<size_t> WebDB::Connection::CreatePreparedStatement(std::string_view text) {
    try {
        auto stmt = connection_.Prepare(std::string{text});
        if (stmt->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, stmt->GetError()};
        }
        size_t id = next_prepared_statement_id_++;
        prepared_statements_[id] = std::move(stmt);
        return id;
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunPreparedStatement(size_t statement_id,
                                                                                      std::string_view args_json) {
    try {
        ARROW_ASSIGN_OR_RAISE(auto result, ExecutePreparedStatement(statement_id, args_json));
        if (result->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, result->GetError()};
        }

        // Configure Arrow schema
        ArrowSchema raw_schema;
        ClientProperties options("UTC", ArrowOffsetSize::REGULAR, false, false, false, ArrowFormatVersion::V1_0,
                                 connection_.context);
        duckdb::unordered_map<idx_t, const duckdb::shared_ptr<ArrowTypeExtensionData>> extension_type_cast;
        ArrowConverter::ToArrowSchema(&raw_schema, result->types, result->names, options);
        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

        // Create Arrow IPC file writer
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
        ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, schema));

        // Write data chunks
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            ArrowArray array;
            ArrowConverter::ToArrowArray(*chunk, &array, options, extension_type_cast);
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
            ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
        }
        ARROW_RETURN_NOT_OK(writer->Close());
        return out->Finish();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::SendPreparedStatement(size_t statement_id,
                                                                                       std::string_view args_json) {
    return RunPreparedStatement(statement_id, args_json);
}

arrow::Status WebDB::Connection::ClosePreparedStatement(size_t statement_id) {
    if (prepared_statements_.erase(statement_id) == 0) {
        return arrow::Status{arrow::StatusCode::Invalid, "statement not found"};
    }
    return arrow::Status::OK();
}

arrow::Status WebDB::Connection::InsertArrowFromIPCStream(std::span<const uint8_t> stream, std::string_view options) {
    return arrow::Status::NotImplemented("InsertArrowFromIPCStream stub");
}

// WebDB methods
std::string_view WebDB::GetVersion() { return DuckDB::LibraryVersion(); }

WebDB::Connection* WebDB::Connect() {
    auto conn = duckdb::make_uniq<Connection>(*this);
    auto* ptr = conn.get();
    connections_[ptr] = std::move(conn);
    return ptr;
}

void WebDB::Disconnect(Connection* connection) { connections_.erase(connection); }

arrow::Status WebDB::Reset() {
    connections_.clear();
    database_.reset();
    DBConfig db_config;
    database_ = duckdb::make_shared_ptr<DuckDB>(nullptr, &db_config);
    return arrow::Status::OK();
}

arrow::Status WebDB::Open(std::string_view args_json) { return arrow::Status::OK(); }

}  // namespace web
}  // namespace duckdb
