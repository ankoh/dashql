#include "duckdb/web/webdb_api_ffi.h"

#include <exception>
#include <memory>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <utility>

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "duckdb/web/webdb.h"

using duckdb::web::DuckDBWasmResultsWrapper;
using duckdb::web::NATIVE;
using duckdb::web::WebDB;

struct DuckDBWebFFIConnection;

struct DuckDBWebFFIDatabase {
    duckdb::unique_ptr<WebDB> webdb;
    std::set<DuckDBWebFFIConnection*> connections;
};

struct DuckDBWebFFIConnection {
    DuckDBWebFFIDatabase* database = nullptr;
    WebDB::Connection* connection = nullptr;
    bool connected = false;
};

struct DuckDBWebFFIResult {
    DuckDBWebFFIStatusCode status_code = DUCKDB_WEB_FFI_STATUS_OK;
    DuckDBWebFFIResultKind kind = DUCKDB_WEB_FFI_RESULT_KIND_STATUS;
    uint32_t arrow_status_code = 0;
    std::string error_message;
    std::string string_value;
    std::shared_ptr<arrow::Buffer> data_value;
    DuckDBWebFFIDatabase* database_value = nullptr;
    DuckDBWebFFIConnection* connection_value = nullptr;
    size_t statement_id_value = 0;
    bool bool_value = false;
};

namespace {

constexpr uint32_t kDuckDBWasmRetryCode = static_cast<uint32_t>(DuckDBWasmResultsWrapper::ResponseStatus::DUCKDB_WASM_RETRY);

DuckDBWebFFIResult* NewResult() { return new DuckDBWebFFIResult{}; }

DuckDBWebFFIResult* MakeResultStatus() {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_STATUS;
    return result;
}

DuckDBWebFFIResult* MakeResultDatabase(DuckDBWebFFIDatabase* database) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_DATABASE;
    result->database_value = database;
    return result;
}

DuckDBWebFFIResult* MakeResultConnection(DuckDBWebFFIConnection* connection) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION;
    result->connection_value = connection;
    return result;
}

DuckDBWebFFIResult* MakeResultStatement(size_t statement_id) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_STATEMENT;
    result->statement_id_value = statement_id;
    return result;
}

DuckDBWebFFIResult* MakeResultBoolean(bool value) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_BOOLEAN;
    result->bool_value = value;
    return result;
}

DuckDBWebFFIResult* MakeResultString(std::string value) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_STRING;
    result->string_value = std::move(value);
    return result;
}

DuckDBWebFFIResult* MakeResultBytes(std::shared_ptr<arrow::Buffer> value) {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_BYTES;
    result->data_value = std::move(value);
    return result;
}

DuckDBWebFFIResult* MakeResultRetry() {
    auto* result = NewResult();
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_RETRY;
    result->arrow_status_code = kDuckDBWasmRetryCode;
    return result;
}

DuckDBWebFFIResult* MakeError(DuckDBWebFFIStatusCode status_code, std::string message, uint32_t arrow_status_code = 0) {
    auto* result = NewResult();
    result->status_code = status_code;
    result->kind = DUCKDB_WEB_FFI_RESULT_KIND_STATUS;
    result->arrow_status_code = arrow_status_code;
    result->error_message = std::move(message);
    return result;
}

DuckDBWebFFIResult* MakeArrowStatusResult(arrow::Status status) {
    if (status.ok()) {
        return MakeResultStatus();
    }
    return MakeError(DUCKDB_WEB_FFI_STATUS_ERROR, std::string{status.message()}, static_cast<uint32_t>(status.code()));
}

DuckDBWebFFIResult* MakeArrowBytesResult(arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
    if (!result.ok()) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_ERROR, std::string{result.status().message()},
                         static_cast<uint32_t>(result.status().code()));
    }
    return MakeResultBytes(std::move(result.ValueUnsafe()));
}

DuckDBWebFFIResult* MakeArrowStatementResult(arrow::Result<size_t> result) {
    if (!result.ok()) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_ERROR, std::string{result.status().message()},
                         static_cast<uint32_t>(result.status().code()));
    }
    return MakeResultStatement(result.ValueUnsafe());
}

DuckDBWebFFIResult* MakeFetchResult(DuckDBWasmResultsWrapper result) {
    if (result.status == DuckDBWasmResultsWrapper::ResponseStatus::DUCKDB_WASM_RETRY) {
        return MakeResultRetry();
    }
    return MakeArrowBytesResult(std::move(result.arrow_buffer));
}

void InvalidateConnectionHandle(DuckDBWebFFIConnection* connection) {
    if (connection == nullptr) {
        return;
    }
    connection->database = nullptr;
    connection->connection = nullptr;
    connection->connected = false;
}

void InvalidateAllConnections(DuckDBWebFFIDatabase* database) {
    if (database == nullptr) {
        return;
    }
    for (auto* connection : database->connections) {
        InvalidateConnectionHandle(connection);
    }
    database->connections.clear();
}

DuckDBWebFFIResult* RequireDatabase(DuckDBWebFFIDatabase* database, WebDB*& out) {
    if (database == nullptr) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "database handle is null");
    }
    if (!database->webdb) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "database handle is invalid");
    }
    out = database->webdb.get();
    return nullptr;
}

DuckDBWebFFIResult* RequireConnection(DuckDBWebFFIConnection* connection, WebDB::Connection*& out) {
    if (connection == nullptr) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "connection handle is null");
    }
    if (!connection->connected || connection->connection == nullptr) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "connection handle is invalid");
    }
    out = connection->connection;
    return nullptr;
}

std::string_view NullableStringView(const char* text) {
    if (text == nullptr) {
        return {};
    }
    return std::string_view{text};
}

DuckDBWebFFIResult* BufferAsStringView(const uint8_t* buffer, size_t buffer_length, std::string_view& out) {
    if (buffer_length == 0) {
        out = {};
        return nullptr;
    }
    if (buffer == nullptr) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "buffer is null but buffer_length is non-zero");
    }
    out = std::string_view{reinterpret_cast<const char*>(buffer), buffer_length};
    return nullptr;
}

DuckDBWebFFIResult* BufferAsSpan(const uint8_t* buffer, size_t buffer_length, std::span<const uint8_t>& out) {
    if (buffer_length == 0) {
        out = std::span<const uint8_t>{};
        return nullptr;
    }
    if (buffer == nullptr) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "buffer is null but buffer_length is non-zero");
    }
    out = std::span<const uint8_t>{buffer, buffer_length};
    return nullptr;
}

template <typename Fn>
DuckDBWebFFIResult* Protect(Fn&& fn) {
    try {
        return fn();
    } catch (const std::exception& e) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INTERNAL_ERROR, e.what());
    } catch (...) {
        return MakeError(DUCKDB_WEB_FFI_STATUS_INTERNAL_ERROR, "unknown exception");
    }
}

}  // namespace

extern "C" {

DuckDBWebFFIResult* duckdb_web_ffi_database_create(void) {
    return Protect([]() -> DuckDBWebFFIResult* {
        auto database = std::make_unique<DuckDBWebFFIDatabase>();
        database->webdb = duckdb::make_uniq<WebDB>(NATIVE);
        return MakeResultDatabase(database.release());
    });
}

void duckdb_web_ffi_database_destroy(DuckDBWebFFIDatabase* database) {
    if (database == nullptr) {
        return;
    }
    InvalidateAllConnections(database);
    database->webdb.reset();
    delete database;
}

void duckdb_web_ffi_connection_destroy(DuckDBWebFFIConnection* connection) {
    if (connection == nullptr) {
        return;
    }
    if (connection->database != nullptr) {
        if (connection->connected && connection->database->webdb && connection->connection != nullptr) {
            connection->database->webdb->Disconnect(connection->connection);
        }
        connection->database->connections.erase(connection);
    }
    delete connection;
}

DuckDBWebFFIResult* duckdb_web_ffi_database_open(DuckDBWebFFIDatabase* database, const char* args_json) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB* webdb = nullptr;
        if (auto* error = RequireDatabase(database, webdb)) {
            return error;
        }
        InvalidateAllConnections(database);
        return MakeArrowStatusResult(webdb->Open(NullableStringView(args_json)));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_database_reset(DuckDBWebFFIDatabase* database) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB* webdb = nullptr;
        if (auto* error = RequireDatabase(database, webdb)) {
            return error;
        }
        InvalidateAllConnections(database);
        return MakeArrowStatusResult(webdb->Reset());
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_database_get_version(DuckDBWebFFIDatabase* database) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB* webdb = nullptr;
        if (auto* error = RequireDatabase(database, webdb)) {
            return error;
        }
        return MakeResultString(std::string{webdb->GetVersion()});
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_database_connect(DuckDBWebFFIDatabase* database) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB* webdb = nullptr;
        if (auto* error = RequireDatabase(database, webdb)) {
            return error;
        }
        auto raw_connection = webdb->Connect();
        if (raw_connection == nullptr) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_ERROR, "failed to create connection");
        }
        auto connection = std::make_unique<DuckDBWebFFIConnection>();
        connection->database = database;
        connection->connection = raw_connection;
        connection->connected = true;
        auto* connection_ptr = connection.release();
        database->connections.insert(connection_ptr);
        return MakeResultConnection(connection_ptr);
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_database_disconnect(DuckDBWebFFIDatabase* database, DuckDBWebFFIConnection* connection) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB* webdb = nullptr;
        if (auto* error = RequireDatabase(database, webdb)) {
            return error;
        }
        if (connection == nullptr) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "connection handle is null");
        }
        if (connection->database != database) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "connection does not belong to database");
        }
        if (connection->connected && connection->connection != nullptr) {
            webdb->Disconnect(connection->connection);
        }
        database->connections.erase(connection);
        InvalidateConnectionHandle(connection);
        return MakeResultStatus();
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_query_run(DuckDBWebFFIConnection* connection, const char* script) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        if (script == nullptr) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "script is null");
        }
        return MakeArrowBytesResult(webdb_connection->RunQuery(script));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_query_run_buffer(DuckDBWebFFIConnection* connection, const uint8_t* buffer,
                                                               size_t buffer_length) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        std::string_view script;
        if (auto* error = BufferAsStringView(buffer, buffer_length, script)) {
            return error;
        }
        return MakeArrowBytesResult(webdb_connection->RunQuery(script));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_start(DuckDBWebFFIConnection* connection, const char* script,
                                                                  bool allow_stream_result) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        if (script == nullptr) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "script is null");
        }
        return MakeArrowBytesResult(webdb_connection->PendingQuery(script, allow_stream_result));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_start_buffer(DuckDBWebFFIConnection* connection,
                                                                         const uint8_t* buffer, size_t buffer_length,
                                                                         bool allow_stream_result) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        std::string_view script;
        if (auto* error = BufferAsStringView(buffer, buffer_length, script)) {
            return error;
        }
        return MakeArrowBytesResult(webdb_connection->PendingQuery(script, allow_stream_result));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_poll(DuckDBWebFFIConnection* connection) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        return MakeArrowBytesResult(webdb_connection->PollPendingQuery());
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_cancel(DuckDBWebFFIConnection* connection) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        return MakeResultBoolean(webdb_connection->CancelPendingQuery());
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_query_fetch_results(DuckDBWebFFIConnection* connection) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        return MakeFetchResult(webdb_connection->FetchQueryResults());
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_create(DuckDBWebFFIConnection* connection, const char* script) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        if (script == nullptr) {
            return MakeError(DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT, "script is null");
        }
        return MakeArrowStatementResult(webdb_connection->CreatePreparedStatement(script));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_create_buffer(DuckDBWebFFIConnection* connection,
                                                                     const uint8_t* buffer, size_t buffer_length) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        std::string_view script;
        if (auto* error = BufferAsStringView(buffer, buffer_length, script)) {
            return error;
        }
        return MakeArrowStatementResult(webdb_connection->CreatePreparedStatement(script));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_close(DuckDBWebFFIConnection* connection, size_t statement_id) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        return MakeArrowStatusResult(webdb_connection->ClosePreparedStatement(statement_id));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_run(DuckDBWebFFIConnection* connection, size_t statement_id,
                                                           const char* args_json) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        auto args = args_json == nullptr ? std::string_view{"[]"} : std::string_view{args_json};
        return MakeArrowBytesResult(webdb_connection->RunPreparedStatement(statement_id, args));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_send(DuckDBWebFFIConnection* connection, size_t statement_id,
                                                            const char* args_json) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        auto args = args_json == nullptr ? std::string_view{"[]"} : std::string_view{args_json};
        return MakeArrowBytesResult(webdb_connection->SendPreparedStatement(statement_id, args));
    });
}

DuckDBWebFFIResult* duckdb_web_ffi_connection_insert_arrow_from_ipc_stream(DuckDBWebFFIConnection* connection,
                                                                            const uint8_t* buffer,
                                                                            size_t buffer_length,
                                                                            const char* options_json) {
    return Protect([&]() -> DuckDBWebFFIResult* {
        WebDB::Connection* webdb_connection = nullptr;
        if (auto* error = RequireConnection(connection, webdb_connection)) {
            return error;
        }
        std::span<const uint8_t> stream;
        if (auto* error = BufferAsSpan(buffer, buffer_length, stream)) {
            return error;
        }
        return MakeArrowStatusResult(webdb_connection->InsertArrowFromIPCStream(stream, NullableStringView(options_json)));
    });
}

void duckdb_web_ffi_result_destroy(DuckDBWebFFIResult* result) { delete result; }

DuckDBWebFFIStatusCode duckdb_web_ffi_result_status_code(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return DUCKDB_WEB_FFI_STATUS_INTERNAL_ERROR;
    }
    return result->status_code;
}

DuckDBWebFFIResultKind duckdb_web_ffi_result_kind(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return DUCKDB_WEB_FFI_RESULT_KIND_STATUS;
    }
    return result->kind;
}

uint32_t duckdb_web_ffi_result_arrow_status_code(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return 0;
    }
    return result->arrow_status_code;
}

const char* duckdb_web_ffi_result_error_message(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return nullptr;
    }
    return result->error_message.c_str();
}

size_t duckdb_web_ffi_result_error_message_length(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return 0;
    }
    return result->error_message.size();
}

const uint8_t* duckdb_web_ffi_result_data(const DuckDBWebFFIResult* result) {
    if (result == nullptr || !result->data_value) {
        return nullptr;
    }
    return result->data_value->data();
}

size_t duckdb_web_ffi_result_data_length(const DuckDBWebFFIResult* result) {
    if (result == nullptr || !result->data_value) {
        return 0;
    }
    return result->data_value->size();
}

const char* duckdb_web_ffi_result_string(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return nullptr;
    }
    return result->string_value.c_str();
}

size_t duckdb_web_ffi_result_string_length(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return 0;
    }
    return result->string_value.size();
}

DuckDBWebFFIDatabase* duckdb_web_ffi_result_database(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return nullptr;
    }
    return result->database_value;
}

DuckDBWebFFIConnection* duckdb_web_ffi_result_connection(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return nullptr;
    }
    return result->connection_value;
}

size_t duckdb_web_ffi_result_statement_id(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return 0;
    }
    return result->statement_id_value;
}

bool duckdb_web_ffi_result_boolean(const DuckDBWebFFIResult* result) {
    if (result == nullptr) {
        return false;
    }
    return result->bool_value;
}

}  // extern "C"
