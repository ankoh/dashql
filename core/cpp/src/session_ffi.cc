#include <cstdint>

#include "duckdb/web/common/ffi_response.h"
#include "dashql/common/blob_stream.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/session.h"
#include "flatbuffers/flatbuffers.h"

using namespace dashql;
using FFIResponse = duckdb::web::FFIResponse;
using FFIResponseBuffer = duckdb::web::FFIResponseBuffer;
using BlobIStreamBuffer = dashql::BlobIStreamBuffer;

namespace {

Session& GetSession() {
    static std::unique_ptr<Session> session = nullptr;
    if (session == nullptr) {
        session = std::make_unique<Session>();
    }
    return *session;
}

FFIResponseBuffer& GetResponseBuffer() {
    static FFIResponseBuffer buffer;
    return buffer;
}

}  // namespace

extern "C" {

void dashql_clear_response() {
    GetResponseBuffer().Clear();
}

void dashql_parse_program(FFIResponse* response, const char* text) {
    GetResponseBuffer().Clear();
    auto& session = GetSession();
    auto program = session.ParseProgram(text);
    GetResponseBuffer().Store(*response, move(program));
}

void dashql_plan_program(FFIResponse* response) {
    GetResponseBuffer().Clear();
    auto& session = GetSession();
    auto plan = session.PlanProgram();
    GetResponseBuffer().Store(*response, move(plan));
}

size_t dashql_pong();
size_t dashql_ping() {
    return dashql_pong();
}

size_t dashql_blob_stream_underflow(BlobID, char*, size_t);

#ifndef EMSCRIPTEN
size_t dashql_pong() { return 0; }
size_t dashql_blob_stream_underflow(BlobID, char*, size_t) { return 0; }
#endif

int main() {}

}
