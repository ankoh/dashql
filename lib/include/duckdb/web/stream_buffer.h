// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_STREAM_BUFFER_H_
#define INCLUDE_DUCKDB_WEB_STREAM_BUFFER_H_

#include <arrow/io/interfaces.h>

#include "arrow/io/memory.h"
#include "nonstd/span.h"

namespace duckdb {
namespace web {

class StreamBuffer : public arrow::io::OutputStream {
   protected:
    /// Resizable buffer
    std::shared_ptr<arrow::ResizableBuffer> buffer_;
    /// Is the buffer open
    bool is_open_;
    /// The current buffer capacity
    int64_t capacity_;
    /// The current position
    int64_t position_;
    /// The mutable data
    uint8_t* mutable_data_;

    /// Ensures there is sufficient space available to write nbytes
    arrow::Status Reserve(int64_t nbytes);

   public:
    /// Destructor
    StreamBuffer();
    /// Destructor
    ~StreamBuffer() override;

    /// Close a buffer
    arrow::Status Close() override;
    /// Is a buffer closed?
    bool closed() const override;
    /// Tell the position within the buffer
    arrow::Result<int64_t> Tell() const override;
    /// Write to the buffer
    arrow::Status Write(const void* data, int64_t nbytes) override;

    /// Reset the stream buffer
    arrow::Status Reset(int64_t initial_capacity = 1024, arrow::MemoryPool* pool = arrow::default_memory_pool());
    /// Clear the buffer
    arrow::Status Clear();
    /// Get the buffer
    nonstd::span<uint8_t> Access() {
        return nonstd::span<uint8_t>{mutable_data_, static_cast<unsigned long>(position_)};
    }
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_STREAM_BUFFER_H_
