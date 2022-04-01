// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
#define INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_

#include <iostream>
#include <variant>

#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

constexpr uint64_t SUCCESS = 0;

/// A packed response
struct FFIResponse {
    /// The status code
    uintptr_t statusCode;
    /// The data ptr (if any)
    uintptr_t dataOrValue;
    /// The data size
    uintptr_t dataSize;
} __attribute((packed));

/// A response buffer
class FFIResponseBuffer {
   protected:
    /// The response flatbuffer (if any)
    flatbuffers::DetachedBuffer proto_buffer_;
    /// The string buffer (if any)
    std::string string_buffer_;

   public:
    /// Constructor
    FFIResponseBuffer();
    /// Clear the response buffer
    void Clear();
    /// Store the detached flatbuffer
    void Store(FFIResponse& response, flatbuffers::DetachedBuffer&& buffer);

    /// Get the instance
    static FFIResponseBuffer& Get();
};

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_FFI_RESPONSE_H_
