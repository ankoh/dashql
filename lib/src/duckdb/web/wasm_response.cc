// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/wasm_response.h"

#include <cstdint>

#include "arrow/buffer.h"

namespace duckdb {
namespace web {

WASMResponseBuffer::WASMResponseBuffer() : status_message_(), result_str_(), result_arrow_() {}

void WASMResponseBuffer::Clear() {
    result_str_ = "";
    result_arrow_.reset();
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Status status) {
    Clear();
    response.statusCode = static_cast<uint64_t>(status.code());
    if (!status.ok()) {
        status_message_ = status.message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        return;
    }
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
    Clear();
    response.statusCode = static_cast<uint64_t>(result.status().code());
    if (!result.ok()) {
        status_message_ = result.status().message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        return;
    }
    result_arrow_ = result.ValueUnsafe();
    response.dataOrValue = reinterpret_cast<uintptr_t>(result_arrow_->data());
    response.dataSize = result_arrow_->size();
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<std::string> result) {
    Clear();
    response.statusCode = static_cast<uint64_t>(result.status().code());
    if (!result.ok()) {
        status_message_ = result.status().message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        return;
    }
    result_str_ = result.ValueUnsafe();
    response.dataOrValue = reinterpret_cast<uintptr_t>(result_str_.data());
    response.dataSize = reinterpret_cast<uintptr_t>(result_str_.size());
}

void WASMResponseBuffer::Store(WASMResponse& response, arrow::Result<double> result) {
    Clear();
    response.statusCode = static_cast<uint64_t>(result.status().code());
    if (!result.ok()) {
        status_message_ = result.status().message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        return;
    }
    response.dataOrValue = result.ValueUnsafe();
    response.dataSize = 0;
}

/// Get the instance
WASMResponseBuffer& WASMResponseBuffer::GetInstance() {
    static WASMResponseBuffer buffer;
    return buffer;
}

}  // namespace web
}  // namespace duckdb
