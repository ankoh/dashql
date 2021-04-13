// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/arrow_ifstream.h"

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/buffer_manager.h"

namespace duckdb {
namespace web {
namespace io {

/// Constructor
InputFileStream::InputFileStream(BufferManager& buffer_manager, std::string_view path)
    : buffer_manager_(buffer_manager), file_(buffer_manager_.AddFile(path)) {}

/// Destructor
InputFileStream::~InputFileStream() = default;

/// Close the input file stream
arrow::Status InputFileStream::Close() {
    file_.Release();
    return arrow::Status::OK();
}

/// Abort any operations on the input stream
arrow::Status InputFileStream::Abort() {
    file_.Release();
    return arrow::Status::OK();
}

/// Return the position in the file
arrow::Result<int64_t> InputFileStream::Tell() const { return file_position_; }

/// Is the stream closed?
bool InputFileStream::closed() const { return static_cast<bool>(file_); }

/// Read at most nbytes bytes from the file
arrow::Result<int64_t> InputFileStream::Read(int64_t nbytes, void* out) {
    buffer_manager_.Read(file_, out, nbytes, file_position_);
    file_position_ += nbytes;
    return nbytes;
}

/// Read at most nbytes bytes from the file
arrow::Result<std::shared_ptr<arrow::Buffer>> InputFileStream::Read(int64_t nbytes) {
    ARROW_ASSIGN_OR_RAISE(auto buffer, arrow::AllocateBuffer(nbytes));
    buffer_manager_.Read(file_, buffer->mutable_data(), nbytes, file_position_);
    file_position_ += nbytes;
    return buffer;
}

/// Advance the file position by nbytes bytes
arrow::Status InputFileStream::Advance(int64_t nbytes) {
    file_position_ += nbytes;
    return arrow::Status::OK();
}

/// Read at most nbytes bytes from the file without advancing the file position
arrow::Result<arrow::util::string_view> InputFileStream::Peek(int64_t nbytes) {
    auto n = std::min<size_t>(nbytes, buffer_manager_.GetPageSize());
    auto page_id = file_position_ >> buffer_manager_.GetPageSizeShift();
    tmp_page_ = std::move(buffer_manager_.FixPage(file_, page_id, false));
    return arrow::util::string_view{static_cast<const char*>(tmp_page_->GetData()), n};
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
