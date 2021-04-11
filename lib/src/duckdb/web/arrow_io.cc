// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/arrow_io.h"

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "duckdb/web/filesystem.h"

namespace duckdb {
namespace web {

WebDBFile::WebDBFile(duckdb::web::WebDBFileSystem& fs, std::unique_ptr<duckdb::web::WebDBFileHandle> handle)
    : file_system_(fs), file_handle_(std::move(handle)), tmp_() {}

WebDBFile::~WebDBFile() {}

arrow::Status WebDBFile::Close() {
    file_handle_.reset();
    return arrow::Status::OK();
}

arrow::Status WebDBFile::Abort() { return arrow::Status::OK(); }

arrow::Result<int64_t> WebDBFile::Tell() const { return duckdb_web_fs_tell(file_handle_->blob_id); }

bool WebDBFile::closed() const { return file_handle_ != nullptr; }

arrow::Result<int64_t> WebDBFile::Read(int64_t nbytes, void* out) {
    return file_system_.Read(*file_handle_, out, nbytes);
}

arrow::Result<std::shared_ptr<arrow::Buffer>> WebDBFile::Read(int64_t nbytes) {
    ARROW_ASSIGN_OR_RAISE(auto buffer, arrow::AllocateResizableBuffer(nbytes));
    auto n = file_system_.Read(*file_handle_, buffer->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(buffer->Resize(n));
    return buffer;
}

arrow::Status WebDBFile::Advance(int64_t nbytes) {
    duckdb_web_fs_advance(file_handle_->blob_id, nbytes);
    return arrow::Status::OK();
}

arrow::Result<arrow::util::string_view> WebDBFile::Peek(int64_t nbytes) {
    ARROW_RETURN_NOT_OK(tmp_->Resize(nbytes));
    auto n = duckdb_web_fs_peek(file_handle_->blob_id, tmp_->mutable_data(), nbytes);
    ARROW_RETURN_NOT_OK(tmp_->Resize(n));
    return static_cast<arrow::util::string_view>(*tmp_);
}

}  // namespace web
}  // namespace duckdb
