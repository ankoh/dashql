// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/arrow_ifstream.h"

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/filesystem.h"

namespace duckdb {
namespace web {

InputFileStream::InputFileStream(duckdb::web::SeekableFileSystem& fs, const char* path)
    : file_system_(fs), file_handle_(fs.OpenFile(path, duckdb::FileFlags::FILE_FLAGS_READ)), tmp_() {}

InputFileStream::~InputFileStream() {}

arrow::Status InputFileStream::Close() {
    file_handle_.reset();
    return arrow::Status::OK();
}

arrow::Status InputFileStream::Abort() { return arrow::Status::OK(); }

arrow::Result<int64_t> InputFileStream::Tell() const { return file_position_; }

bool InputFileStream::closed() const { return file_handle_ == nullptr; }

arrow::Result<int64_t> InputFileStream::Read(int64_t nbytes, void* out) {
    auto n = file_system_.Read(*file_handle_, out, nbytes);
    file_position_ += n;
    return n;
}

arrow::Result<std::shared_ptr<arrow::Buffer>> InputFileStream::Read(int64_t nbytes) {
    ARROW_ASSIGN_OR_RAISE(auto buffer, arrow::AllocateResizableBuffer(nbytes));
    auto n = file_system_.Read(*file_handle_, buffer->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(buffer->Resize(n));
    file_position_ += n;
    return buffer;
}

arrow::Status InputFileStream::Advance(int64_t nbytes) {
    file_system_.SetFilePointer(*file_handle_, file_position_ + nbytes);
    file_position_ += nbytes;
    return arrow::Status::OK();
}

arrow::Result<arrow::util::string_view> InputFileStream::Peek(int64_t nbytes) {
    ARROW_RETURN_NOT_OK(tmp_->Resize(nbytes));
    auto n = file_system_.Read(*file_handle_, tmp_->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(tmp_->Resize(n));
    file_system_.SetFilePointer(*file_handle_, file_position_);
    return static_cast<arrow::util::string_view>(*tmp_);
}

}  // namespace web
}  // namespace duckdb
