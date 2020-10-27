#include <cstdint>

#include "dashql/parser/codec.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/proto/syntax_generated.h"
#include "flatbuffers/flatbuffers.h"

using namespace dashql::parser;

namespace {

/// A packed response
struct Response {
    /// The buffer ptr (if any)
    uint64_t bufferPtr;
    /// The buffer size
    uint64_t bufferSize;
    /// The buffer offset
    uint64_t bufferOfs;
} __attribute((packed));

}  // namespace

extern "C" {

/// Parse a dashql script
void dashql_parse(Response* response, const char* text) {
    // Parse the text
    std::string_view text_view{text};
    ParseContext ctx;
    auto ast = ctx.Parse(text);

    // Encode the flatbuffer
    flatbuffers::FlatBufferBuilder builder{text_view.size()};
    builder.Finish(WriteProgram(builder, ast));
  
    // Pack the response
    size_t buffer_size;
    size_t buffer_ofs;
    auto buffer_ptr = builder.ReleaseRaw(buffer_size, buffer_ofs);
    response->bufferPtr = reinterpret_cast<uintptr_t>(buffer_ptr);
    response->bufferSize = buffer_size;
    response->bufferOfs = buffer_ofs;
}

/// Free memory
void dashql_parser_free(void* buffer, size_t length) {
    free(buffer);
}

#ifdef EMSCRIPTEN
int main() {
}
#endif

}
