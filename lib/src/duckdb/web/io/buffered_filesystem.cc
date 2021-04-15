// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/buffered_filesystem.h"

#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/buffer_manager.h"
#include "duckdb/web/io/buffered_filesystem.h"
#include "duckdb/web/io/web_filesystem.h"

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace duckdb {
namespace web {
namespace io {

/// Constructor
void BufferedFileHandle::Close() { file_buffers_.Release(); }

/// Constructor
BufferedFileHandle::BufferedFileHandle(duckdb::FileSystem &file_system, BufferManager::FileRef file_buffers)
    : duckdb::FileHandle(file_system, std::string{file_buffers.GetPath()}),
      file_buffers_(std::move(file_buffers)),
      file_position_(0) {}

/// Constructor
BufferedFileHandle::~BufferedFileHandle() { file_buffers_.Release(); }

BufferedFileSystem::BufferedFileSystem(std::shared_ptr<BufferManager> buffer_manager)
    : buffer_manager_(std::move(buffer_manager)), filesystem_(*buffer_manager_->GetFileSystem()) {}

std::unique_ptr<duckdb::FileHandle> BufferedFileSystem::OpenFile(const char *path, uint8_t flags,
                                                                 duckdb::FileLockType lock) {
    auto file = buffer_manager_->OpenFile(std::string_view{path});
    return std::make_unique<BufferedFileHandle>(*this, std::move(file));
}

void BufferedFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    auto &file_hdl = static_cast<BufferedFileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    auto reader = static_cast<char *>(buffer);

    // Read page-wise
    auto file_size = buffer_manager_->GetFileSize(file);
    while (nr_bytes > 0 && location < file_size) {
        auto n = buffer_manager_->Read(file, reader, nr_bytes, location);
        reader += n;
        location += n;
        nr_bytes -= n;
    }
    file_hdl.file_position_ = location;

    // Requested to read past end?
    if (location >= file_size && nr_bytes > 0) {
        assert(false);
    }
}

void BufferedFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    auto &file_hdl = static_cast<BufferedFileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    auto writer = static_cast<char *>(buffer);

    // Write page-wise
    auto file_size = buffer_manager_->GetFileSize(file);
    while (nr_bytes > 0 && location < file_size) {
        auto n = buffer_manager_->Write(file, writer, nr_bytes, location);
        writer += n;
        location += n;
        nr_bytes -= n;
    }
    file_hdl.file_position_ = location;

    // Requested to write past end?
    if (location >= file_size && nr_bytes > 0) {
        assert(false);
    }
}

int64_t BufferedFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    auto &file_hdl = static_cast<BufferedFileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    auto n = buffer_manager_->Read(file, buffer, nr_bytes, file_hdl.file_position_);
    file_hdl.file_position_ += n;
    return n;
}

int64_t BufferedFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    auto &file_hdl = static_cast<BufferedFileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    auto n = buffer_manager_->Write(file, buffer, nr_bytes, file_hdl.file_position_);
    file_hdl.file_position_ += n;
    return n;
}

/// Sync a file handle to disk
void BufferedFileSystem::FileSync(duckdb::FileHandle &handle) {
    auto &file_hdl = static_cast<BufferedFileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    buffer_manager_->FlushFile(file);
}

int64_t BufferedFileSystem::GetFileSize(duckdb::FileHandle &handle) {
    auto &buffered_hdl = static_cast<BufferedFileHandle &>(handle);
    return buffer_manager_->GetFileSize(buffered_hdl.GetBuffers());
}

time_t BufferedFileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    auto &buffered_hdl = static_cast<BufferedFileHandle &>(handle);
    return filesystem_.GetLastModifiedTime(buffered_hdl.GetFileHandle());
}

void BufferedFileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) {
    auto &buffered_hdl = static_cast<BufferedFileHandle &>(handle);
    return buffer_manager_->Truncate(buffered_hdl.GetBuffers(), new_size);
}

void BufferedFileSystem::RemoveDirectory(const std::string &directory) {
    return filesystem_.RemoveDirectory(directory);
}

void BufferedFileSystem::MoveFile(const std::string &source, const std::string &target) {
    // XXX Invalidate buffer manager!
    return filesystem_.MoveFile(source, target);
}

void BufferedFileSystem::RemoveFile(const std::string &filename) {
    // XXX Invalidate buffer manager!
    return filesystem_.RemoveFile(filename);
}

void BufferedFileSystem::SetWorkingDirectory(const std::string &path) {
    // XXX Invalidate buffer manager!
    return filesystem_.SetWorkingDirectory(path);
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
