#include "dashql/parser/ffi.h"

#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

using namespace dashql::parser;
namespace sx = dashql::proto::syntax;

extern "C" void dashql_parse(FFIResponse* response, const uint8_t* text, size_t length) {
    static_assert(sizeof(uint8_t) == sizeof(char));

    // Parse the program
    auto program = ParserDriver::Parse(std::string_view{reinterpret_cast<const char*>(text), length});

    // Pack the flatbuffer program
    flatbuffers::FlatBufferBuilder fb;
    auto program_ofs = sx::Program::Pack(fb, program.get());
    fb.Finish(program_ofs);
    auto program_buffer = fb.Release();

    // Store response
    FFIResponseBuffer::Get().Store(*response, std::move(program_buffer));
}

#ifdef WASM
extern "C" int main() { return 0; }
#endif
