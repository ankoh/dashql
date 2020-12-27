#include <cstdint>

#include "dashql/common/blob_stream.h"
#include "dashql/common/ffi_response.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "dashql/session.h"
#include "flatbuffers/flatbuffers.h"

using namespace dashql;
using BlobStreamBuffer = dashql::BlobStreamBuffer;

namespace {

std::unique_ptr<Session> session = nullptr;

Session& GetSession() {
    if (session == nullptr) {
        session = std::make_unique<Session>();
    }
    return *session;
}

}  // namespace

extern "C" {

void dashql_reset_session() {
    session.reset();    
}

void dashql_clear_response() {
    FFIResponseBuffer::GetInstance().Clear();
}

void dashql_parse_program(FFIResponse* response, const char* text) {
    FFIResponseBuffer::GetInstance().Clear();
    auto& session = GetSession();
    auto program = session.ParseProgram(text);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(program));
}

void dashql_plan_program(FFIResponse* response, const void* args_buffer) {
    FFIResponseBuffer::GetInstance().Clear();
    auto& session = GetSession();
    auto* args = flatbuffers::GetRoot<proto::session::PlanArguments>(args_buffer);
    proto::session::PlanArgumentsT unpackedArgs;
    args->UnPackTo(&unpackedArgs);
    auto plan = session.PlanProgram(unpackedArgs);
    FFIResponseBuffer::GetInstance().Store(*response, std::move(plan));
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
