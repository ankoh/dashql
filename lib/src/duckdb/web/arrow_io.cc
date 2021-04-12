// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/arrow_io.h"

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "duckdb/web/filesystem.h"

namespace duckdb {
namespace web {

WebDBInputFileStream::WebDBInputFileStream(duckdb::web::WebDBFileSystem& fs,
                                           std::unique_ptr<duckdb::web::WebDBFileHandle> handle)
    : file_system_(fs), file_handle_(std::move(handle)), tmp_() {}

WebDBInputFileStream::~WebDBInputFileStream() {}

arrow::Status WebDBInputFileStream::Close() {
    file_handle_.reset();
    return arrow::Status::OK();
}

arrow::Status WebDBInputFileStream::Abort() { return arrow::Status::OK(); }

arrow::Result<int64_t> WebDBInputFileStream::Tell() const { return file_position_; }

bool WebDBInputFileStream::closed() const { return file_handle_ != nullptr; }

arrow::Result<int64_t> WebDBInputFileStream::Read(int64_t nbytes, void* out) {
    auto n = file_system_.Read(*file_handle_, out, nbytes);
    file_position_ += n;
    return n;
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDBInputFileStream::Read(int64_t nbytes) {
    ARROW_ASSIGN_OR_RAISE(auto buffer, arrow::AllocateResizableBuffer(nbytes));
    auto n = file_system_.Read(*file_handle_, buffer->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(buffer->Resize(n));
    file_position_ += n;
    return buffer;
}

arrow::Status WebDBInputFileStream::Advance(int64_t nbytes) {
    file_system_.SetFilePointer(*file_handle_, file_position_ + nbytes);
    file_position_ += nbytes;
    return arrow::Status::OK();
}

arrow::Result<arrow::util::string_view> WebDBInputFileStream::Peek(int64_t nbytes) {
    ARROW_RETURN_NOT_OK(tmp_->Resize(nbytes));
    auto n = duckdb_web_fs_read(file_handle_->blob_id, tmp_->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(tmp_->Resize(n));
    file_system_.SetFilePointer(*file_handle_, file_position_);
    return static_cast<arrow::util::string_view>(*tmp_);
}

}  // namespace web
}  // namespace duckdb
