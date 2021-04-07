// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/stream_buffer.h"

#include <arrow/status.h>

#include <iostream>
#include <string>
#include <vector>

#include "arrow/buffer.h"
#include "duckdb/web/filesystem.h"

namespace duckdb {
namespace web {

static constexpr int64_t kBufferMinimumSize = 256;

StreamBuffer::StreamBuffer() : buffer_() { Reset().ok(); }

StreamBuffer::~StreamBuffer() {}

arrow::Status StreamBuffer::Reserve(int64_t nbytes) {
    int64_t new_capacity = std::max(kBufferMinimumSize, capacity_);
    while (new_capacity < position_ + nbytes) {
        new_capacity = new_capacity * 2;
    }
    if (new_capacity > capacity_) {
        RETURN_NOT_OK(buffer_->Resize(new_capacity));
        capacity_ = new_capacity;
        mutable_data_ = buffer_->mutable_data();
    }
    return arrow::Status::OK();
}

arrow::Status StreamBuffer::Close() {
    is_open_ = false;
    return arrow::Status::OK();
}

bool StreamBuffer::closed() const { return is_open_; }

arrow::Result<int64_t> StreamBuffer::Tell() const { return position_; }

arrow::Status StreamBuffer::Write(const void* data, int64_t nbytes) {
    if (ARROW_PREDICT_FALSE(!is_open_)) {
        return arrow::Status::IOError("OutputStream is closed");
    }
    if (ARROW_PREDICT_TRUE(nbytes > 0)) {
        if (ARROW_PREDICT_FALSE(position_ + nbytes >= capacity_)) {
            RETURN_NOT_OK(Reserve(nbytes));
        }
        memcpy(mutable_data_ + position_, data, nbytes);
        position_ += nbytes;
    }
    return arrow::Status::OK();
}

arrow::Status StreamBuffer::Clear() {
    is_open_ = true;
    position_ = 0;
    mutable_data_ = buffer_->mutable_data();
    return arrow::Status::OK();
}

arrow::Status StreamBuffer::Reset(int64_t initial_capacity, arrow::MemoryPool* pool) {
    ARROW_ASSIGN_OR_RAISE(buffer_, arrow::AllocateResizableBuffer(initial_capacity, pool));
    is_open_ = true;
    capacity_ = initial_capacity;
    position_ = 0;
    mutable_data_ = buffer_->mutable_data();
    return arrow::Status::OK();
}

}  // namespace web
}  // namespace duckdb
