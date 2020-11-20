#include <cstdint>

#include "duckdb/web/common/ffi_response.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/session.h"
#include "flatbuffers/flatbuffers.h"

using namespace dashql;
using Response = duckdb::web::Response;
using ResponseBuffer = duckdb::web::ResponseBuffer;

namespace {

Session& GetSession() {
    static std::unique_ptr<Session> session = nullptr;
    if (session == nullptr) {
        session = std::make_unique<Session>();
    }
    return *session;
}

ResponseBuffer& GetResponseBuffer() {
    static ResponseBuffer buffer;
    return buffer;
}

}  // namespace

extern "C" {

void dashql_clear_response() {
    GetResponseBuffer().Clear();
}

void dashql_evaluate(Response* response, const char* text) {
    GetResponseBuffer().Clear();
    auto& session = GetSession();
    auto program = session.Evaluate(text);
    GetResponseBuffer().Store(*response, move(program));
}

#ifdef EMSCRIPTEN
int main() {}
#endif
}
