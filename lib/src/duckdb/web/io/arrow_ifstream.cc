// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/arrow_ifstream.h"

#include <iostream>

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
bool InputFileStream::closed() const { return !static_cast<bool>(file_); }

/// Read at most nbytes bytes from the file
arrow::Result<int64_t> InputFileStream::Read(int64_t nbytes, void* out) {
    auto n = buffer_manager_.Read(file_, out, nbytes, file_position_);
    file_position_ += n;
    return n;
}

namespace {

struct FixedPage : public arrow::Buffer {
    BufferManager::BufferRef buffer;
    FixedPage(BufferManager::BufferRef buffer, nonstd::span<char> view)
        : arrow::Buffer(reinterpret_cast<uint8_t*>(view.data()), view.size()), buffer(std::move(buffer)) {}
    ~FixedPage() {}
    FixedPage(const FixedPage& other) = delete;
};

}  // namespace

/// Read at most nbytes bytes from the file
arrow::Result<std::shared_ptr<arrow::Buffer>> InputFileStream::Read(int64_t nbytes) {
    // Determine page & offset
    auto page_id = file_position_ >> buffer_manager_.GetPageSizeShift();
    auto skip_here = file_position_ - page_id * buffer_manager_.GetPageSize();
    auto read_here = std::min<size_t>(nbytes, buffer_manager_.GetPageSize() - skip_here);

    // Read page
    auto page = buffer_manager_.FixPage(file_, page_id, false);
    assert(skip_here <= page.GetData().size());
    auto data = page.GetData().subspan(skip_here);
    file_position_ += data.size();
    return std::make_shared<FixedPage>(std::move(page), data);
}

/// Advance the file position by nbytes bytes
arrow::Status InputFileStream::Advance(int64_t nbytes) {
    file_position_ += nbytes;
    return arrow::Status::OK();
}

/// Read at most nbytes bytes from the file without advancing the file position
arrow::Result<arrow::util::string_view> InputFileStream::Peek(int64_t nbytes) {
    // Determine page & offset
    auto page_id = file_position_ >> buffer_manager_.GetPageSizeShift();
    auto skip_here = file_position_ - page_id * buffer_manager_.GetPageSize();
    auto read_here = std::min<size_t>(nbytes, buffer_manager_.GetPageSize() - skip_here);

    // Peek page
    tmp_page_ = buffer_manager_.FixPage(file_, page_id, false);
    assert(skip_here <= tmp_page_->GetData().size());
    auto data = tmp_page_->GetData().subspan(skip_here);
    return arrow::util::string_view{data.data(), data.size()};
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
