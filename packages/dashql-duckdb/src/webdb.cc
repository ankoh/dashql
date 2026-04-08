#define RAPIDJSON_HAS_STDSTRING 1

#include "duckdb/web/webdb.h"

#ifdef EMSCRIPTEN
#include <emscripten/val.h>
#endif
#include <rapidjson/document.h>
#include <rapidjson/error/en.h>

#include <chrono>
#include <cstddef>
#include <cstdio>
#include <functional>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string_view>

#include "arrow/buffer.h"
#include "arrow/io/memory.h"
#include "arrow/ipc/options.h"
#include "arrow/ipc/type_fwd.h"
#include "arrow/ipc/writer.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "arrow/type_fwd.h"
#include "duckdb/common/arrow/arrow.hpp"
#include "duckdb/common/arrow/arrow_converter.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/types.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/common/types/vector.hpp"
#include "duckdb/function/table/arrow/arrow_duck_schema.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/arrow_bridge.h"
#include "duckdb/web/arrow_casts.h"
#include "duckdb/web/arrow_insert_options.h"
#include "duckdb/web/arrow_stream_buffer.h"
#include "duckdb/web/config.h"
#include "duckdb/web/environment.h"
#include "duckdb/web/utils/debug.h"
#include "duckdb/web/utils/wasm_response.h"

namespace duckdb {
namespace web {

static constexpr int64_t DEFAULT_QUERY_POLLING_INTERVAL = 100;

/// Create the default webdb database
duckdb::unique_ptr<WebDB> WebDB::Create() {
    if constexpr (ENVIRONMENT == Environment::WEB) {
        return duckdb::make_uniq<WebDB>(WEB);
    } else {
        auto fs = duckdb::FileSystem::CreateLocal();
        return duckdb::make_uniq<WebDB>(NATIVE, std::move(fs));
    }
}
/// Get the static webdb instance
arrow::Result<std::reference_wrapper<WebDB>> WebDB::Get() {
    static duckdb::unique_ptr<WebDB> db = nullptr;
    if (db == nullptr) {
        db = Create();
    }
    return *db;
}

/// Constructor
WebDB::Connection::Connection(WebDB& webdb)
    : webdb_(webdb), connection_(*webdb.database_), arrow_ipc_stream_(nullptr) {}
/// Constructor
WebDB::Connection::~Connection() = default;

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::StreamQueryResult(
    duckdb::unique_ptr<duckdb::QueryResult> result) {
    current_query_result_ = std::move(result);
    current_schema_.reset();
    current_schema_patched_.reset();

    // Import the schema
    ArrowSchema raw_schema;
    bool lossless_conversion = webdb_.config_->arrow_lossless_conversion;
    ClientProperties options("UTC", ArrowOffsetSize::REGULAR, false, false, lossless_conversion,
                             ArrowFormatVersion::V1_0, connection_.context);
    options.arrow_offset_size = ArrowOffsetSize::REGULAR;
    ArrowConverter::ToArrowSchema(&raw_schema, current_query_result_->types, current_query_result_->names, options);
    ARROW_ASSIGN_OR_RAISE(current_schema_, arrow::ImportSchema(&raw_schema));
    current_schema_patched_ = patchSchema(current_schema_, webdb_.config_->query);

    // Serialize the schema
    return arrow::ipc::SerializeSchema(*current_schema_patched_);
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunQuery(std::string_view text) {
    try {
        auto result = connection_.SendQuery(std::string{text});
        if (result->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::move(result->GetError())};
        }

        // Configure Arrow schema
        ArrowSchema raw_schema;
        bool lossless_conversion = webdb_.config_->arrow_lossless_conversion;
        ClientProperties options("UTC", ArrowOffsetSize::REGULAR, false, false, lossless_conversion,
                                 ArrowFormatVersion::V1_0, connection_.context);
        auto extension_type_cast = ArrowTypeExtensionData::GetExtensionTypes(*connection_.context, result->types);
        ArrowConverter::ToArrowSchema(&raw_schema, result->types, result->names, options);
        ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

        // Patch the schema with query config casts
        auto patched_schema = patchSchema(schema, webdb_.config_->query);

        // Create Arrow IPC file writer
        ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
        ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, patched_schema));

        // Write data chunks
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            ArrowArray array;
            ArrowConverter::ToArrowArray(*chunk, &array, options, extension_type_cast);
            ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
            ARROW_ASSIGN_OR_RAISE(batch, patchRecordBatch(batch, patched_schema, webdb_.config_->query));
            ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
        }
        ARROW_RETURN_NOT_OK(writer->Close());
        return out->Finish();
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    } catch (...) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "unknown exception"};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::PendingQuery(std::string_view text,
                                                                              bool allow_stream_result) {
    try {
        auto statements = connection_.ExtractStatements(std::string{text});
        if (statements.size() == 0) {
            return arrow::Status{arrow::StatusCode::ExecutionError, "no statements"};
        }
        current_pending_statements_ = std::move(statements);
        current_pending_statement_index_ = 0;
        current_allow_stream_result_ = allow_stream_result;
        // Send the first query
        auto result = connection_.PendingQuery(std::move(current_pending_statements_[current_pending_statement_index_]),
                                               current_allow_stream_result_);
        if (result->HasError()) {
            current_pending_statements_.clear();
            return arrow::Status{arrow::StatusCode::ExecutionError, std::move(result->GetError())};
        }
        current_pending_query_result_ = std::move(result);
        current_pending_query_was_canceled_ = false;
        current_query_result_.reset();
        current_schema_.reset();
        current_schema_patched_.reset();
        if (webdb_.config_->query.query_polling_interval.value_or(DEFAULT_QUERY_POLLING_INTERVAL) > 0) {
            return PollPendingQuery();
        } else {
            return nullptr;
        }
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    } catch (...) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "unknown exception"};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::PollPendingQuery() {
    if (current_pending_query_was_canceled_) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "query was canceled"};
    } else if (current_pending_query_result_ == nullptr) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "no active pending query"};
    }
    auto before = std::chrono::steady_clock::now();
    uint64_t elapsed;
    auto polling_interval = webdb_.config_->query.query_polling_interval.value_or(DEFAULT_QUERY_POLLING_INTERVAL);
    do {
        switch (current_pending_query_result_->ExecuteTask()) {
            case PendingExecutionResult::EXECUTION_FINISHED:
            case PendingExecutionResult::RESULT_READY: {
                auto result = current_pending_query_result_->Execute();
                current_pending_statement_index_++;
                // If this was the last statement, then return the result
                if (current_pending_statement_index_ == current_pending_statements_.size()) {
                    return StreamQueryResult(std::move(result));
                }
                // Otherwise, start the next statement
                auto pending_result =
                    connection_.PendingQuery(std::move(current_pending_statements_[current_pending_statement_index_]),
                                             current_allow_stream_result_);
                if (pending_result->HasError()) {
                    current_pending_query_result_.reset();
                    current_pending_statements_.clear();
                    return arrow::Status{arrow::StatusCode::ExecutionError, std::move(pending_result->GetError())};
                }
                current_pending_query_result_ = std::move(pending_result);
                break;
            }
            case PendingExecutionResult::BLOCKED:
            case PendingExecutionResult::NO_TASKS_AVAILABLE:
                return nullptr;
            case PendingExecutionResult::RESULT_NOT_READY:
                break;
            case PendingExecutionResult::EXECUTION_ERROR: {
                auto err = current_pending_query_result_->GetError();
                current_pending_query_result_.reset();
                current_pending_statements_.clear();
                return arrow::Status{arrow::StatusCode::ExecutionError, err};
            }
        }
        auto after = std::chrono::steady_clock::now();
        elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(after - before).count();
    } while (elapsed < polling_interval);
    return nullptr;
}

bool WebDB::Connection::CancelPendingQuery() {
    // Only reset the pending query if it hasn't completed yet
    if (current_pending_query_result_ != nullptr && current_query_result_ == nullptr) {
        current_pending_query_was_canceled_ = true;
        current_pending_query_result_.reset();
        current_pending_statements_.clear();
        return true;
    } else {
        return false;
    }
}

DuckDBWasmResultsWrapper WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        duckdb::unique_ptr<duckdb::DataChunk> chunk;
        if (current_query_result_ == nullptr) {
            return DuckDBWasmResultsWrapper{nullptr};
        }

        if (current_query_result_->type == QueryResultType::STREAM_RESULT) {
            auto& stream_result = current_query_result_->Cast<duckdb::StreamQueryResult>();

            auto before = std::chrono::steady_clock::now();
            uint64_t elapsed;
            auto polling_interval =
                webdb_.config_->query.query_polling_interval.value_or(DEFAULT_QUERY_POLLING_INTERVAL);
            bool ready = false;
            do {
                switch (stream_result.ExecuteTask()) {
                    case StreamExecutionResult::EXECUTION_ERROR:
                        return arrow::Status{arrow::StatusCode::ExecutionError,
                                             std::move(current_query_result_->GetError())};
                    case StreamExecutionResult::EXECUTION_CANCELLED:
                        return arrow::Status{arrow::StatusCode::ExecutionError,
                                             "The execution of the query was cancelled before it could finish, likely "
                                             "caused by executing a different query"};
                    case StreamExecutionResult::CHUNK_READY:
                    case StreamExecutionResult::EXECUTION_FINISHED:
                        ready = true;
                        break;
                    case StreamExecutionResult::BLOCKED:
                        stream_result.WaitForTask();
                        return DuckDBWasmResultsWrapper::ResponseStatus::DUCKDB_WASM_RETRY;
                    case StreamExecutionResult::NO_TASKS_AVAILABLE:
                        return DuckDBWasmResultsWrapper::ResponseStatus::DUCKDB_WASM_RETRY;
                    case StreamExecutionResult::CHUNK_NOT_READY:
                        break;
                }

                auto after = std::chrono::steady_clock::now();
                elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(after - before).count();
            } while (!ready && elapsed < polling_interval);

            if (!ready) {
                return DuckDBWasmResultsWrapper::ResponseStatus::DUCKDB_WASM_RETRY;
            }
        }

        // Fetch next result chunk
        chunk = current_query_result_->Fetch();
        if (current_query_result_->HasError()) {
            return arrow::Status{arrow::StatusCode::ExecutionError, std::move(current_query_result_->GetError())};
        }
        // Reached end?
        if (!chunk) {
            current_query_result_.reset();
            current_schema_.reset();
            current_schema_patched_.reset();
            return DuckDBWasmResultsWrapper{nullptr};
        }

        // Serialize the record batch
        ArrowArray array;
        bool lossless_conversion = webdb_.config_->arrow_lossless_conversion;
        ClientProperties arrow_options("UTC", ArrowOffsetSize::REGULAR, false, false, lossless_conversion,
                                       ArrowFormatVersion::V1_0, connection_.context);
        auto extension_type_cast = ArrowTypeExtensionData::GetExtensionTypes(*connection_.context, chunk->GetTypes());
        arrow_options.arrow_offset_size = ArrowOffsetSize::REGULAR;
        ArrowConverter::ToArrowArray(*chunk, &array, arrow_options, extension_type_cast);
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, current_schema_));
        // Patch the record batch
        ARROW_ASSIGN_OR_RAISE(batch, patchRecordBatch(batch, current_schema_patched_, webdb_.config_->query));
        // Serialize the record batch
        auto options = arrow::ipc::IpcWriteOptions::Defaults();
        options.use_threads = false;
        return arrow::ipc::SerializeRecordBatch(*batch, options);
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<size_t> WebDB::Connection::CreatePreparedStatement(std::string_view text) {
    try {
        auto prep = connection_.Prepare(std::string{text});
        if (prep->HasError()) return arrow::Status{arrow::StatusCode::ExecutionError, prep->GetError()};
        auto id = next_prepared_statement_id_++;

        // Wrap around if maximum exceeded
        if (next_prepared_statement_id_ == std::numeric_limits<size_t>::max()) next_prepared_statement_id_ = 0;

        prepared_statements_.emplace(id, std::move(prep));
        return id;
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<duckdb::unique_ptr<duckdb::QueryResult>> WebDB::Connection::ExecutePreparedStatement(
    size_t statement_id, std::string_view args_json) {
    try {
        auto stmt = prepared_statements_.find(statement_id);
        if (stmt == prepared_statements_.end())
            return arrow::Status{arrow::StatusCode::KeyError, "No prepared statement found with ID"};

        rapidjson::Document args_doc;
        rapidjson::ParseResult ok = args_doc.Parse(args_json.data(), args_json.size());
        if (!ok) return arrow::Status{arrow::StatusCode::Invalid, rapidjson::GetParseError_En(ok.Code())};
        if (!args_doc.IsArray()) return arrow::Status{arrow::StatusCode::Invalid, "Arguments must be given as array"};

        duckdb::vector<duckdb::Value> values;
        size_t index = 0;
        for (const auto& v : args_doc.GetArray()) {
            if (v.IsLosslessDouble())
                values.emplace_back(v.GetDouble());
            else if (v.IsString())
                // Use GetStringLenght otherwise null bytes will be counted as terminators
                values.emplace_back(string_t(v.GetString(), v.GetStringLength()));
            else if (v.IsNull())
                values.emplace_back(nullptr);
            else if (v.IsBool())
                values.emplace_back(v.GetBool());
            else
                return arrow::Status{arrow::StatusCode::Invalid,
                                     "Invalid column type encountered for argument " + std::to_string(index)};
            ++index;
        }

        auto result = stmt->second->Execute(values);
        if (result->HasError()) return arrow::Status{arrow::StatusCode::ExecutionError, std::move(result->GetError())};
        return result;
    } catch (std::exception& e) {
        return arrow::Status{arrow::StatusCode::ExecutionError, e.what()};
    }
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::RunPreparedStatement(size_t statement_id,
                                                                                      std::string_view args_json) {
    auto result = ExecutePreparedStatement(statement_id, args_json);
    if (!result.ok()) return result.status();

    // Configure Arrow schema
    ArrowSchema raw_schema;
    bool lossless_conversion = webdb_.config_->arrow_lossless_conversion;
    ClientProperties options("UTC", ArrowOffsetSize::REGULAR, false, false, lossless_conversion,
                             ArrowFormatVersion::V1_0, connection_.context);
    auto extension_type_cast = ArrowTypeExtensionData::GetExtensionTypes(*connection_.context, (*result)->types);
    ArrowConverter::ToArrowSchema(&raw_schema, (*result)->types, (*result)->names, options);
    ARROW_ASSIGN_OR_RAISE(auto schema, arrow::ImportSchema(&raw_schema));

    // Patch the schema with query config casts
    auto patched_schema = patchSchema(schema, webdb_.config_->query);

    // Create Arrow IPC file writer
    ARROW_ASSIGN_OR_RAISE(auto out, arrow::io::BufferOutputStream::Create());
    ARROW_ASSIGN_OR_RAISE(auto writer, arrow::ipc::MakeFileWriter(out, patched_schema));

    // Write data chunks
    for (auto chunk = (*result)->Fetch(); !!chunk && chunk->size() > 0; chunk = (*result)->Fetch()) {
        ArrowArray array;
        ArrowConverter::ToArrowArray(*chunk, &array, options, extension_type_cast);
        ARROW_ASSIGN_OR_RAISE(auto batch, arrow::ImportRecordBatch(&array, schema));
        // Patch the record batch with query config casts
        ARROW_ASSIGN_OR_RAISE(batch, patchRecordBatch(batch, patched_schema, webdb_.config_->query));
        ARROW_RETURN_NOT_OK(writer->WriteRecordBatch(*batch));
    }
    ARROW_RETURN_NOT_OK(writer->Close());
    return out->Finish();
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDB::Connection::SendPreparedStatement(size_t statement_id,
                                                                                       std::string_view args_json) {
    auto result = ExecutePreparedStatement(statement_id, args_json);
    if (!result.ok()) return result.status();
    return StreamQueryResult(std::move(*result));
}

arrow::Status WebDB::Connection::ClosePreparedStatement(size_t statement_id) {
    auto it = prepared_statements_.find(statement_id);
    if (it == prepared_statements_.end())
        return arrow::Status{arrow::StatusCode::KeyError, "No prepared statement found with ID"};
    prepared_statements_.erase(it);
    return arrow::Status::OK();
}

/// Insert a record batch
arrow::Status WebDB::Connection::InsertArrowFromIPCStream(std::span<const uint8_t> stream,
                                                          std::string_view options_json) {
    try {
        // First call?
        if (!arrow_ipc_stream_) {
            arrow_insert_options_.reset();

            /// Read table options.
            /// We deliberately do this BEFORE creating the ipc stream.
            /// This ensures that we always have valid options.
            rapidjson::Document options_doc;
            options_doc.Parse(options_json.data(), options_json.size());
            ArrowInsertOptions options;
            ARROW_RETURN_NOT_OK(options.ReadFrom(options_doc));
            arrow_insert_options_ = options;

            // Create the IPC stream
            arrow_ipc_stream_ = std::make_unique<BufferingArrowIPCStreamDecoder>();
        }

        /// Consume stream bytes
        ARROW_RETURN_NOT_OK(arrow_ipc_stream_->Consume(stream.data(), stream.size()));
        if (!arrow_ipc_stream_->buffer()->is_eos()) {
            return arrow::Status::OK();
        }
        assert(arrow_insert_options_);

        /// Execute the arrow scan
        vector<Value> params;
        params.push_back(duckdb::Value::POINTER(reinterpret_cast<uintptr_t>(&arrow_ipc_stream_->buffer())));
        params.push_back(
            duckdb::Value::POINTER(reinterpret_cast<uintptr_t>(&ArrowIPCStreamBufferReader::CreateStream)));
        params.push_back(duckdb::Value::POINTER(reinterpret_cast<uintptr_t>(&ArrowIPCStreamBufferReader::GetSchema)));
        auto func = connection_.TableFunction("arrow_scan", params);

        /// Create or insert
        if (arrow_insert_options_->create_new) {
            func->Create(arrow_insert_options_->schema_name, arrow_insert_options_->table_name);
        } else {
            func->Insert(arrow_insert_options_->schema_name, arrow_insert_options_->table_name);
        }

        arrow_insert_options_.reset();
        arrow_ipc_stream_.reset();
    } catch (const std::exception& e) {
        arrow_insert_options_.reset();
        arrow_ipc_stream_.reset();
        return arrow::Status::UnknownError(e.what());
    }
    return arrow::Status::OK();
}

/// Constructor
WebDB::WebDB(WebTag) : config_(std::make_shared<WebDBConfig>()), database_(nullptr), connections_() {
    if (auto open_status = Open(); !open_status.ok()) {
        throw std::runtime_error(open_status.message());
    }
}

/// Constructor
WebDB::WebDB(NativeTag, duckdb::unique_ptr<duckdb::FileSystem> fs)
    : config_(std::make_shared<WebDBConfig>()), database_(nullptr), connections_() {
    if (auto open_status = Open(); !open_status.ok()) {
        throw std::runtime_error(open_status.message());
    }
}

WebDB::~WebDB() {}

/// Get the version
std::string_view WebDB::GetVersion() { return database_->LibraryVersion(); }

/// Create a session
WebDB::Connection* WebDB::Connect() {
    auto conn = duckdb::make_uniq<WebDB::Connection>(*this);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, std::move(conn)});
    ClientConfig::GetConfig(*conn_ptr->connection_.context).wait_time = 1;
    return conn_ptr;
}

/// End a session
void WebDB::Disconnect(Connection* session) { connections_.erase(session); }

/// Reset the database
arrow::Status WebDB::Reset() {
    DEBUG_TRACE();
    return Open();
}

/// Open a database
arrow::Status WebDB::Open(std::string_view args_json) {
    DEBUG_TRACE();
    assert(config_ != nullptr);
    *config_ = WebDBConfig::ReadFrom(args_json);
    try {
        duckdb::DBConfig db_config;
        db_config.options.maximum_threads = config_->maximum_threads;
        db_config.options.use_temporary_directory = false;
        db_config.options.access_mode = AccessMode::AUTOMATIC;
        db_config.SetOptionByName("duckdb_api", "wasm");
        auto db = make_shared_ptr<duckdb::DuckDB>(":memory:", &db_config);

        // Reset state that is specific to the old database
        connections_.clear();
        database_.reset();

        // Store  new database
        database_ = std::move(db);
    } catch (std::exception& ex) {
        return arrow::Status::Invalid("Opening the database failed with error: ", ex.what());
    } catch (...) {
        return arrow::Status::Invalid("Opening the database failed");
    }
    return arrow::Status::OK();
}

}  // namespace web
}  // namespace duckdb
