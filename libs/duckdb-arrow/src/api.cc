#include <arrow/buffer.h>

#include <cstring>

#include "duckdb/arrowapi/database.h"
#include "duckdb/main/database.hpp"

using namespace duckdb::arrowapi;

struct StringView {
    const char* data;
    size_t length;
};

struct Result {
    size_t status_code;
    void* data;
    void (*data_deleter)(void*);
    size_t data_length;
};

using db_ptr = void*;
using conn_ptr = void*;

extern "C" {
void duckdb_arrow_open(Result* result, StringView* path);
void duckdb_arrow_connect(Result* result, db_ptr db);
void duckdb_arrow_connection_run_query(Result* result, conn_ptr conn, StringView* text);
void duckdb_arrow_connection_send_query(Result* result, conn_ptr conn, StringView* text);
void duckdb_arrow_connection_fetch_query_results(Result* result, conn_ptr conn);

void duckdb_arrow_open(Result* result, StringView* path) {
    std::unique_ptr<duckdb::DuckDB> db;
    if (path != nullptr && path->length != 0) {
        std::string path_copy{path->data, path->length};
        db = std::make_unique<duckdb::DuckDB>(path_copy);
    } else {
        db = std::make_unique<duckdb::DuckDB>();
    }
    auto wrapper = std::make_unique<Database>(std::move(db));
    result->status_code = 0;
    result->data = wrapper.release();
    result->data_length = 0;
    result->data_deleter = [](void* data) { delete reinterpret_cast<Database*>(data); };
}

void duckdb_arrow_close(db_ptr db) { delete reinterpret_cast<Database*>(db); }

void duckdb_arrow_connect(Result* result, db_ptr dbp) {
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
void return_arrow_buffer_result(Result* out, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
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

void duckdb_arrow_connection_run_query(Result* out, conn_ptr connp, StringView* text) {
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto input = std::string_view{text->data, text->length};
    auto result = conn->RunQuery(input);
    return_arrow_buffer_result(out, result);
}

void duckdb_arrow_connection_send_query(Result* out, conn_ptr connp, StringView* text) {
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto input = std::string_view{text->data, text->length};
    auto result = conn->SendQuery(input);
    return_arrow_buffer_result(out, result);
}

void duckdb_arrow_connection_fetch_query_results(Result* out, conn_ptr connp) {
    auto conn = reinterpret_cast<Database::Connection*>(connp);
    auto result = conn->FetchQueryResults();
    return_arrow_buffer_result(out, result);
}
}
