#include <cstring>

#include "arrow/buffer.h"
#include "duckdb/main/database.hpp"
#include "duckdbx/database.h"

using namespace duckdbx;

struct FFIResult {
    uint32_t status_code;
    uint32_t data_length;
    void* data;
    void (*data_deleter)(void*);
};

using db_ptr = void*;
using conn_ptr = void*;

extern "C" {
void duckdbx_open(FFIResult* result, const char* path);
void duckdbx_connect(FFIResult* result, db_ptr db);
void duckdbx_connection_run_query(FFIResult* result, conn_ptr conn, const char* text);
void duckdbx_connection_send_query(FFIResult* result, conn_ptr conn, const char* text);
void duckdbx_connection_fetch_query_results(FFIResult* result, conn_ptr conn);

void duckdbx_open(FFIResult* result, const char* raw_path) {
    std::unique_ptr<duckdb::DuckDB> db;
    if (raw_path != nullptr) {
        db = std::make_unique<duckdb::DuckDB>(std::string{raw_path});
    } else {
        db = std::make_unique<duckdb::DuckDB>();
    }
    auto wrapper = std::make_unique<Database>(std::move(db));
    result->status_code = 0;
    result->data = wrapper.release();
    result->data_length = 0;
    result->data_deleter = [](void* data) { delete reinterpret_cast<Database*>(data); };
}

void duckdbx_close(db_ptr db) { delete reinterpret_cast<Database*>(db); }

void duckdbx_connect(FFIResult* result, db_ptr dbp) {
    auto db = reinterpret_cast<Database*>(dbp);
    auto conn = db->Connect();
    result->status_code = 0;
    result->data = conn;
    result->data_length = 0;
    result->data_deleter = [](void* data) {
        auto conn = reinterpret_cast<Database::Connection*>(data);
        auto& db = conn->database();
        db.Disconnect(conn);
    };
}

namespace {
struct RawArrowBuffer {
    std::shared_ptr<arrow::Buffer> buffer;
    RawArrowBuffer(std::shared_ptr<arrow::Buffer> buffer) : buffer(buffer) {}
};
void return_arrow_buffer_result(FFIResult* out, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
    if (!result.ok()) {
        auto& msg = result.status().message();
        auto msg_length = msg.length();
        auto msg_buffer = std::unique_ptr<char[]>(new char[msg_length]);
        strncpy(msg_buffer.get(), msg.data(), msg_length);
        out->status_code = 1;
        out->data = msg_buffer.release();
        out->data_length = msg_length;
        out->data_deleter = [](void* data) { delete reinterpret_cast<char*>(data); };
    } else {
        auto buffer = std::make_unique<RawArrowBuffer>(std::move(result.ValueUnsafe()));
        out->status_code = 0;
        out->data = buffer.release();
        out->data_length = 0;
        out->data_deleter = [](void* data) { delete reinterpret_cast<RawArrowBuffer*>(data); };
    }
}
}  // namespace

void duckdbx_access_buffer(RawArrowBuffer* buffer, const char** out_data, int* out_length) {
    *out_data = reinterpret_cast<const char*>(buffer->buffer->data());
    *out_length = buffer->buffer->size();
}

void duckdbx_connection_run_query(FFIResult* out, conn_ptr connp, const char* raw_text) {
    auto text = std::string_view{raw_text};
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto result = conn->RunQuery(text);
    return_arrow_buffer_result(out, result);
}

void duckdbx_connection_send_query(FFIResult* out, conn_ptr connp, const char* raw_text) {
    auto text = std::string_view{raw_text};
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto result = conn->SendQuery(text);
    return_arrow_buffer_result(out, result);
}

void duckdbx_connection_fetch_query_results(FFIResult* out, conn_ptr connp) {
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto result = conn->FetchQueryResults();
    return_arrow_buffer_result(out, result);
}
}
