#include <flatbuffers/flatbuffers.h>

#include <cstdint>

#include "dashql/parser/ffi.h"
#include "dashql/parser/parser_driver.h"

namespace dashql {
namespace parser {

FFIResponseBuffer::FFIResponseBuffer() : proto_buffer_(), string_buffer_() {}

void FFIResponseBuffer::Clear() { string_buffer_ = ""; }

void FFIResponseBuffer::Store(FFIResponse& response, flatbuffers::DetachedBuffer&& result) {
    Clear();
    proto_buffer_ = std::move(result);
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(proto_buffer_.data());
    response.dataSize = static_cast<uintptr_t>(proto_buffer_.size());
}

/// Get the instance
FFIResponseBuffer& FFIResponseBuffer::Get() {
    thread_local FFIResponseBuffer buffer;
    return buffer;
}

}  // namespace parser
}  // namespace dashql
