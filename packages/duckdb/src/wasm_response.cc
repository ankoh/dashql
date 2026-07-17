#include "duckdb/web/utils/wasm_response.h"

#include <cstdint>

#include "arrow/buffer.h"
#include "duckdb/web/webdb.h"

namespace duckdb {
namespace web {

DuckDBWebWasmResult::DuckDBWebWasmResult() : status_message_(), result_str_(), result_arrow_() {}

void DuckDBWebWasmResult::Clear() {
    result_str_ = "";
    result_arrow_.reset();
}

bool DuckDBWebWasmResult::Store(WASMResponse& response, arrow::Status status) {
    Clear();
    response.statusCode = static_cast<uint64_t>(status.code());
    if (!status.ok()) {
        status_message_ = status.message();
        response.dataOrValue = reinterpret_cast<uintptr_t>(status_message_.data());
        response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        return false;
    }
    return true;
}

void DuckDBWebWasmResult::Store(WASMResponse& response, DuckDBWasmResultsWrapper& value) {
    if (value.status == DuckDBWasmResultsWrapper::ResponseStatus::ARROW_BUFFER) {
        Store(response, std::move(value.arrow_buffer));
    } else {
        Clear();
        response.statusCode = value.status;
    }
}

void DuckDBWebWasmResult::Store(WASMResponse& response, std::string value) {
    result_str_ = std::move(value);
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(result_str_.data());
    response.dataSize = result_str_.size();
}

void DuckDBWebWasmResult::Store(WASMResponse& response, std::string_view value) {
    response.statusCode = 0;
    response.dataOrValue = reinterpret_cast<uintptr_t>(value.data());
    response.dataSize = value.size();
}

void DuckDBWebWasmResult::Store(WASMResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
    if (!Store(response, result.status())) return;
    result_arrow_ = std::move(result.ValueUnsafe());
    if (result_arrow_ == nullptr) {
        response.dataOrValue = 0;
        response.dataSize = 0;
        return;
    }
    response.dataOrValue = reinterpret_cast<uintptr_t>(result_arrow_->data());
    response.dataSize = result_arrow_->size();
}

void DuckDBWebWasmResult::Store(WASMResponse& response, arrow::Result<std::string> result) {
    if (!Store(response, result.status())) return;
    result_str_ = std::move(result.ValueUnsafe());
    response.dataOrValue = reinterpret_cast<uintptr_t>(result_str_.data());
    response.dataSize = reinterpret_cast<uintptr_t>(result_str_.size());
}

void DuckDBWebWasmResult::Store(WASMResponse& response, arrow::Result<double> result) {
    if (!Store(response, result.status())) return;
    response.dataOrValue = result.ValueUnsafe();
    response.dataSize = 0;
}

void DuckDBWebWasmResult::Store(WASMResponse& response, arrow::Result<size_t> result) {
    if (!Store(response, result.status())) return;
    response.dataOrValue = result.ValueUnsafe();
    response.dataSize = 0;
}

/// Get the instance
DuckDBWebWasmResult& DuckDBWebWasmResult::Get() {
    static DuckDBWebWasmResult buffer = {};
    return buffer;
}

}  // namespace web
}  // namespace duckdb
