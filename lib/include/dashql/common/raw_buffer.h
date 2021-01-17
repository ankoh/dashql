// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_RAW_BUFFER_H_
#define INCLUDE_DASHQL_COMMON_RAW_BUFFER_H_

#include <memory>

#include "dashql/common/span.h"

namespace dashql {

class RawBuffer {
   protected:
    /// The buffer memory
    std::unique_ptr<char[]> buffer_;
    /// The buffer size
    size_t size_;

   public:
    /// Constructor
    RawBuffer(char* buffer, size_t size) : buffer_(std::unique_ptr<char[]>(buffer)), size_(size) {}
    /// Clear the adopted buffer
    void Clear() {
        buffer_.reset();
        size_ = 0;
    }
    /// Access the buffer
    auto operator*() { return nonstd::span<char>{buffer_.get(), size_}; }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_RAW_BUFFER_H_
