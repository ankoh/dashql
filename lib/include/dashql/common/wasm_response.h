// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_WASM_RESPONSE_H_
#define INCLUDE_DASHQL_COMMON_WASM_RESPONSE_H_

#include <iostream>
#include <variant>

#include "arrow/result.h"
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
    WASMResponseBuffer();
    /// Clear the response buffer
    void Clear();
    /// Store the detached flatbuffer
    void Store(WASMResponse& response, flatbuffers::DetachedBuffer&& buffer);
    /// Store the arrow status
    bool Store(WASMResponse& response, arrow::Status status);
    /// Store a string
    void Store(WASMResponse& response, std::string value);
    /// Store a string view
    void Store(WASMResponse& response, std::string_view value);
    /// Store the detached flatbuffer
    void Store(WASMResponse& response, arrow::Result<flatbuffers::DetachedBuffer> buffer);
    /// Store the result string
    void Store(WASMResponse& response, arrow::Result<std::string> result);
    /// Store the result double
    void Store(WASMResponse& response, arrow::Result<double> result);
    /// Store the result size_t
    void Store(WASMResponse& response, arrow::Result<size_t> result);

    /// Get the instance
    static WASMResponseBuffer& Get();
};

#define ASSIGN_OR_RETURN(RESPONSE, TARGET, ACTION)                             \
    auto __maybe_result__ = ACTION;                                            \
    if (!__maybe_result__.ok()) {                                              \
        WASMResponseBuffer::Get().Store(*RESPONSE, __maybe_result__.status()); \
        return;                                                                \
    }                                                                          \
    TARGET = std::move(__maybe_result__.ValueUnsafe());

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
