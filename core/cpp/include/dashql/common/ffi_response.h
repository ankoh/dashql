// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
#define INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_

#include <variant>

#include "dashql/common/error.h"
#include "dashql/common/expected.h"
#include "dashql/proto/error_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {

/// A packed response
struct Response {
    /// The status code
    uint64_t statusCode;
    /// The data ptr (if any)
    uint64_t dataPtr;
    /// The data size
    uint64_t dataSize;
} __attribute((packed));

/// A response buffer
class ResponseBuffer {
   protected:
    /// The response flatbuffer (if any)
    flatbuffers::DetachedBuffer proto_buffer_;
    /// The response error (if any)
    std::optional<Error> error_;

   public:
    /// Constructor
    ResponseBuffer() { Clear(); }

    /// Clear the response buffer
    void Clear() {
        error_.reset();
        proto_buffer_ = {};
    }

    /// Store the packed response
    template <typename T> void Store(Response& response, ExpectedBuffer<T>&& result) {
        Clear();
        if (result) {
            proto_buffer_ = result.ReleaseBuffer();
            response.statusCode = static_cast<size_t>(proto::error::StatusCode::SUCCESS);
            response.dataPtr = reinterpret_cast<uintptr_t>(proto_buffer_.data());
            response.dataSize = proto_buffer_.size();
        } else {
            error_ = result.ReleaseError();
            auto m = error_->message();
            m = m == nullptr ? "" : m;
            response.statusCode = static_cast<size_t>(error_->code());
            response.dataPtr = reinterpret_cast<uintptr_t>(m);
            response.dataSize = strlen(m);
        }
    }

    /// Store the packed response
    template <typename T> void Store(Response& response, ExpectedBufferRef<T>&& result) {
        Clear();
        if (result) {
            auto buffer = result.GetBuffer();
            response.statusCode = static_cast<size_t>(proto::error::StatusCode::SUCCESS);
            response.dataPtr = reinterpret_cast<uintptr_t>(buffer.data());
            response.dataSize = buffer.size();
        } else {
            error_ = result.ReleaseError();
            auto m = error_->message();
            m = m == nullptr ? "" : m;
            response.statusCode = static_cast<size_t>(error_->code());
            response.dataPtr = reinterpret_cast<uintptr_t>(m);
            response.dataSize = strlen(m);
        }
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_

