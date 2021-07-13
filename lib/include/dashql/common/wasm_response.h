// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
#define INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_

#include <iostream>
#include <variant>

#include "dashql/common/error.h"
#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

constexpr uint64_t SUCCESS = 0;

/// A packed response
struct WASMResponse {
    /// The status code
    double statusCode;
    /// The data ptr (if any)
    double dataOrValue;
    /// The data size
    double dataSize;
} __attribute((packed));

/// A response buffer
class WASMResponseBuffer {
   protected:
    /// The response flatbuffer (if any)
    flatbuffers::DetachedBuffer proto_buffer_;
    /// The string buffer (if any)
    std::string string_buffer_;
    /// The response error (if any)
    std::optional<Error> error_;

   public:
    /// Constructor
    WASMResponseBuffer() { Clear(); }

    /// Clear the response buffer
    void Clear() {
        error_.reset();
        string_buffer_ = {};
        proto_buffer_ = {};
    }

    /// Store the detached flatbuffer
    void Store(WASMResponse& response, std::string&& result) {
        Clear();
        string_buffer_ = std::move(result);
        response.statusCode = SUCCESS;
        response.dataOrValue = reinterpret_cast<uintptr_t>(string_buffer_.data());
        response.dataSize = string_buffer_.size();
    }

    /// Store the detached flatbuffer
    void Store(WASMResponse& response, Expected<std::string>&& result) {
        Clear();
        if (result) {
            Store(response, result.ReleaseValue());
        } else {
            Store(response, result.ReleaseError());
        }
    }

    /// Store the detached flatbuffer
    void Store(WASMResponse& response, flatbuffers::DetachedBuffer&& buffer) {
        Clear();
        proto_buffer_ = std::move(buffer);
        response.statusCode = SUCCESS;
        response.dataOrValue = reinterpret_cast<uintptr_t>(proto_buffer_.data());
        response.dataSize = proto_buffer_.size();
    }

    /// Store the error
    void Store(WASMResponse& response, Error&& err) {
        Clear();
        error_ = std::move(err);
        auto m = error_->message();
        m = m == nullptr ? "" : m;
        proto_buffer_ = {};
        response.statusCode = static_cast<size_t>(error_->code());
        response.dataOrValue = reinterpret_cast<uintptr_t>(m);
        response.dataSize = strlen(m);
    }

    /// Store the signal
    void Store(WASMResponse& response, Signal&& result) {
        if (result) {
            Clear();
            proto_buffer_ = {};
            response.statusCode = SUCCESS;
            response.dataOrValue = 0;
            response.dataSize = proto_buffer_.size();
        } else {
            Store(response, result.ReleaseError());
        }
    }

    /// Store the packed response
    template <typename T> void Store(WASMResponse& response, ExpectedBuffer<T>&& result) {
        if (result) {
            Store(response, result.ReleaseBuffer());
        } else {
            Store(response, result.ReleaseError());
        }
    }

    /// Store the packed response
    template <typename T> void Store(WASMResponse& response, ExpectedBufferRef<T>&& result) {
        if (result) {
            Clear();
            auto buffer = result.GetBuffer();
            response.statusCode = SUCCESS;
            response.dataOrValue = reinterpret_cast<uintptr_t>(buffer.data());
            response.dataSize = buffer.size();
        } else {
            Store(response, result.ReleaseError());
        }
    }

    /// Get the static response
    static WASMResponseBuffer& GetInstance();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
