// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/ffi_response.h"

#include "arrow/buffer.h"

namespace duckdb {
namespace web {

FFIResponseBuffer::FFIResponseBuffer() : status_message_(), arrow_buffer_() {}

void FFIResponseBuffer::Clear() {
    status_message_.clear();
    arrow_buffer_.reset();
}

void FFIResponseBuffer::Store(FFIResponse& response, arrow::Status status) {
    Clear();
    response.statusCode = static_cast<uint64_t>(status.code());
    if (!status.ok()) {
        status_message_ = status.message();
        response.dataPtr = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
    }
}

void FFIResponseBuffer::Store(FFIResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
    Clear();
    response.statusCode = static_cast<uint64_t>(result.status().code());
    if (result.ok()) {
        arrow_buffer_ = result.ValueUnsafe();
        if (arrow_buffer_) {
            response.dataPtr = reinterpret_cast<uintptr_t>(arrow_buffer_->data());
            response.dataSize = arrow_buffer_->size();
        } else {
            response.dataPtr = 0;
            response.dataSize = 0;
        }
    } else {
        status_message_ = result.status().message();
        response.dataPtr = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
    }
}

/// Get the instance
FFIResponseBuffer& FFIResponseBuffer::GetInstance() {
    static FFIResponseBuffer buffer;
    return buffer;
}

}  // namespace web
}  // namespace duckdb
