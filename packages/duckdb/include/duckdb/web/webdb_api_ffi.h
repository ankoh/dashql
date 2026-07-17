#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DuckDBWebFFIDatabase DuckDBWebFFIDatabase;
typedef struct DuckDBWebFFIConnection DuckDBWebFFIConnection;
typedef struct DuckDBWebFFIResult DuckDBWebFFIResult;

typedef enum DuckDBWebFFIResultKind {
    DUCKDB_WEB_FFI_RESULT_KIND_STATUS = 0,
    DUCKDB_WEB_FFI_RESULT_KIND_BYTES = 1,
    DUCKDB_WEB_FFI_RESULT_KIND_STRING = 2,
    DUCKDB_WEB_FFI_RESULT_KIND_DATABASE = 3,
    DUCKDB_WEB_FFI_RESULT_KIND_CONNECTION = 4,
    DUCKDB_WEB_FFI_RESULT_KIND_STATEMENT = 5,
    DUCKDB_WEB_FFI_RESULT_KIND_BOOLEAN = 6,
    DUCKDB_WEB_FFI_RESULT_KIND_RETRY = 7,
} DuckDBWebFFIResultKind;

typedef enum DuckDBWebFFIStatusCode {
    DUCKDB_WEB_FFI_STATUS_OK = 0,
    DUCKDB_WEB_FFI_STATUS_ERROR = 1,
    DUCKDB_WEB_FFI_STATUS_INVALID_ARGUMENT = 2,
    DUCKDB_WEB_FFI_STATUS_INTERNAL_ERROR = 3,
} DuckDBWebFFIStatusCode;

DuckDBWebFFIResult* duckdb_web_ffi_database_create(void);
void duckdb_web_ffi_database_destroy(DuckDBWebFFIDatabase* database);
void duckdb_web_ffi_connection_destroy(DuckDBWebFFIConnection* connection);

DuckDBWebFFIResult* duckdb_web_ffi_database_open(DuckDBWebFFIDatabase* database, const char* args_json);
DuckDBWebFFIResult* duckdb_web_ffi_database_reset(DuckDBWebFFIDatabase* database);
DuckDBWebFFIResult* duckdb_web_ffi_database_get_version(DuckDBWebFFIDatabase* database);
DuckDBWebFFIResult* duckdb_web_ffi_database_connect(DuckDBWebFFIDatabase* database);
DuckDBWebFFIResult* duckdb_web_ffi_database_disconnect(DuckDBWebFFIDatabase* database, DuckDBWebFFIConnection* connection);

DuckDBWebFFIResult* duckdb_web_ffi_connection_query_run(DuckDBWebFFIConnection* connection, const char* script);
DuckDBWebFFIResult* duckdb_web_ffi_connection_query_run_buffer(DuckDBWebFFIConnection* connection, const uint8_t* buffer,
                                                               size_t buffer_length);
DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_start(DuckDBWebFFIConnection* connection, const char* script,
                                                                  bool allow_stream_result);
DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_start_buffer(DuckDBWebFFIConnection* connection,
                                                                         const uint8_t* buffer, size_t buffer_length,
                                                                         bool allow_stream_result);
DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_poll(DuckDBWebFFIConnection* connection);
DuckDBWebFFIResult* duckdb_web_ffi_connection_pending_query_cancel(DuckDBWebFFIConnection* connection);
DuckDBWebFFIResult* duckdb_web_ffi_connection_query_fetch_results(DuckDBWebFFIConnection* connection);

DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_create(DuckDBWebFFIConnection* connection, const char* script);
DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_create_buffer(DuckDBWebFFIConnection* connection,
                                                                     const uint8_t* buffer, size_t buffer_length);
DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_close(DuckDBWebFFIConnection* connection, size_t statement_id);
DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_run(DuckDBWebFFIConnection* connection, size_t statement_id,
                                                           const char* args_json);
DuckDBWebFFIResult* duckdb_web_ffi_connection_prepared_send(DuckDBWebFFIConnection* connection, size_t statement_id,
                                                            const char* args_json);
DuckDBWebFFIResult* duckdb_web_ffi_connection_insert_arrow_from_ipc_stream(DuckDBWebFFIConnection* connection,
                                                                            const uint8_t* buffer,
                                                                            size_t buffer_length,
                                                                            const char* options_json);

void duckdb_web_ffi_result_destroy(DuckDBWebFFIResult* result);
DuckDBWebFFIStatusCode duckdb_web_ffi_result_status_code(const DuckDBWebFFIResult* result);
DuckDBWebFFIResultKind duckdb_web_ffi_result_kind(const DuckDBWebFFIResult* result);
uint32_t duckdb_web_ffi_result_arrow_status_code(const DuckDBWebFFIResult* result);
const char* duckdb_web_ffi_result_error_message(const DuckDBWebFFIResult* result);
size_t duckdb_web_ffi_result_error_message_length(const DuckDBWebFFIResult* result);
const uint8_t* duckdb_web_ffi_result_data(const DuckDBWebFFIResult* result);
size_t duckdb_web_ffi_result_data_length(const DuckDBWebFFIResult* result);
const char* duckdb_web_ffi_result_string(const DuckDBWebFFIResult* result);
size_t duckdb_web_ffi_result_string_length(const DuckDBWebFFIResult* result);
DuckDBWebFFIDatabase* duckdb_web_ffi_result_database(const DuckDBWebFFIResult* result);
DuckDBWebFFIConnection* duckdb_web_ffi_result_connection(const DuckDBWebFFIResult* result);
size_t duckdb_web_ffi_result_statement_id(const DuckDBWebFFIResult* result);
bool duckdb_web_ffi_result_boolean(const DuckDBWebFFIResult* result);

#ifdef __cplusplus
}
#endif
