#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uintptr_t DuckDBWebConnectionHdl;
typedef uintptr_t DuckDBWebBufferHdl;

typedef struct DuckDBWebWasmResponse {
    double statusCode;
    double dataOrValue;
    double dataSize;
} __attribute__((packed)) DuckDBWebWasmResponse;

typedef DuckDBWebWasmResponse WASMResponse;

void duckdb_web_clear_response(void);
void duckdb_web_fail_with(const char* path);

void duckdb_web_reset(WASMResponse* packed);
DuckDBWebConnectionHdl duckdb_web_connect(void);
void duckdb_web_disconnect(DuckDBWebConnectionHdl connHdl);
void* duckdb_web_access_buffer(DuckDBWebConnectionHdl connHdl, DuckDBWebBufferHdl bufferHdl);
void duckdb_web_open(WASMResponse* packed, const char* args);
void duckdb_web_get_version(WASMResponse* packed);
void duckdb_web_prepared_create(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const char* script);
void duckdb_web_prepared_create_buffer(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const uint8_t* buffer,
                                       size_t buffer_length);
void duckdb_web_prepared_close(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, size_t statement_id);
void duckdb_web_prepared_run(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, size_t statement_id,
                             const char* args_json);
void duckdb_web_prepared_send(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, size_t statement_id,
                              const char* args_json);
void duckdb_web_query_run(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const char* script);
void duckdb_web_query_run_buffer(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const uint8_t* buffer,
                                 size_t buffer_length);
void duckdb_web_pending_query_start(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const char* script,
                                    bool allow_stream_result);
void duckdb_web_pending_query_start_buffer(WASMResponse* packed, DuckDBWebConnectionHdl connHdl,
                                           const uint8_t* buffer, size_t buffer_length, bool allow_stream_result);
void duckdb_web_pending_query_poll(WASMResponse* packed, DuckDBWebConnectionHdl connHdl, const char* script);
bool duckdb_web_pending_query_cancel(DuckDBWebConnectionHdl connHdl, const char* script);
void duckdb_web_query_fetch_results(WASMResponse* packed, DuckDBWebConnectionHdl connHdl);
void duckdb_web_insert_arrow_from_ipc_stream(WASMResponse* packed, DuckDBWebConnectionHdl connHdl,
                                             const uint8_t* buffer, size_t buffer_length, const char* options);

#ifdef __cplusplus
}
#endif
