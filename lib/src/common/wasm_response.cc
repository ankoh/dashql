#include "dashql/common/wasm_response.h"

#include <flatbuffers/flatbuffers.h>

#include <cstdint>

#include "arrow/buffer.h"

namespace dashql {

WASMResponseBuffer::WASMResponseBuffer() : proto_buffer_(), string_buffer_() {}

void WASMResponseBuffer::Clear() { string_buffer_ = ""; }

bool WASMResponseBuffer::Store(WASMResponse& response, arrow::Status status) {
    Clear();
    response.statusCode = static_cast<uint64_t>(status.code());
    if (!status.ok()) {
        string_buffer_ = status.message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(string_buffer_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(string_buffer_.size());
        return false;
    }
    return true;
}

void WASMResponseBuffer::Store(WASMResponse& response, std::string value) {
    Clear();
    string_buffer_ = std::move(value);
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(string_buffer_.data());
    response.dataSize = string_buffer_.size();
}

void WASMResponseBuffer::Store(WASMResponse& response, std::string_view value) {
    Clear();
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(value.data());
    response.dataSize = value.size();
}

void WASMResponseBuffer::Store(WASMResponse& response, flatbuffers::DetachedBuffer&& result) {
    Clear();
    proto_buffer_ = std::move(result);
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(proto_buffer_.data());
    response.dataSize = reinterpret_cast<uintptr_t>(proto_buffer_.size());
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<flatbuffers::DetachedBuffer> result) {
    if (!Store(response, result.status())) return;
    proto_buffer_ = std::move(result.ValueUnsafe());
    response.dataOrValue = reinterpret_cast<uintptr_t>(proto_buffer_.data());
    response.dataSize = reinterpret_cast<uintptr_t>(proto_buffer_.size());
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<std::string> result) {
    if (!Store(response, result.status())) return;
    string_buffer_ = std::move(result.ValueUnsafe());
    response.dataOrValue = reinterpret_cast<uintptr_t>(string_buffer_.data());
    response.dataSize = reinterpret_cast<uintptr_t>(string_buffer_.size());
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<double> result) {
    if (!Store(response, result.status())) return;
    response.dataOrValue = result.ValueUnsafe();
    response.dataSize = 0;
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<size_t> result) {
    if (!Store(response, result.status())) return;
    response.dataOrValue = result.ValueUnsafe();
    response.dataSize = 0;
}

/// Get the instance
WASMResponseBuffer& WASMResponseBuffer::Get() {
    static WASMResponseBuffer buffer;
    return buffer;
}

}  // namespace dashql
