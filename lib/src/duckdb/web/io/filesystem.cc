// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/filesystem.h"

#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/buffer_manager.h"
#include "duckdb/web/io/file.h"
#include "duckdb/web/io/filesystem.h"
#include "duckdb/web/io/filesystem_api.h"

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace duckdb {
namespace web {
namespace io {

FileSystem::FileSystem(BufferManager &buffer_manager) : buffer_manager_(buffer_manager) {}

std::unique_ptr<duckdb::FileHandle> FileSystem::OpenFile(const char *path, uint8_t flags, duckdb::FileLockType lock) {
    auto file = buffer_manager_.AddFile(std::string_view{path});
    return std::make_unique<FileHandle>(*this, std::move(file));
}

void FileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    while (nr_bytes > 0) {
        auto n = std::min<size_t>(buffer_manager_.GetPageSize(), nr_bytes);
        auto page_id = buffer_manager_.GetPageIDFromOffset(location);
        auto page = buffer_manager_.FixPage(file, page_id, false);
        std::memcpy(buffer, page.GetData(), n);
        nr_bytes -= n;
        location += n;
    }
    file_hdl.file_position_ = location;
}

void FileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    while (nr_bytes > 0) {
        auto n = std::min<size_t>(buffer_manager_.GetPageSize(), nr_bytes);
        auto page_id = buffer_manager_.GetPageIDFromOffset(location);
        auto page = buffer_manager_.FixPage(file, page_id, true);
        std::memcpy(page.GetData(), buffer, n);
        nr_bytes -= n;
        location += n;
        buffer_manager_.UnfixPage(std::move(page), true);
    }
    file_hdl.file_position_ = location;
}

int64_t FileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    Read(file_hdl, buffer, nr_bytes, file_hdl.file_position_);
    return nr_bytes;
}

int64_t FileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    Write(file_hdl, buffer, nr_bytes, file_hdl.file_position_);
    return nr_bytes;
}

/// Sync a file handle to disk
void FileSystem::FileSync(duckdb::FileHandle &handle) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    auto &file = file_hdl.GetBuffers();
    buffer_manager_.FlushFile(file);
}

int64_t FileSystem::GetFileSize(duckdb::FileHandle &handle) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    return file_hdl.GetFile()->Size();
}

time_t FileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    return file_hdl.GetFile()->GetLastModifiedTime();
}

void FileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) {
    auto &file_hdl = static_cast<FileHandle &>(handle);
    return file_hdl.GetFile()->Resize(new_size);
}

bool FileSystem::DirectoryExists(const std::string &directory) {
    return duckdb_web_fs_directory_exists(directory.c_str(), directory.size());
}

void FileSystem::CreateDirectory(const std::string &directory) {
    duckdb_web_fs_directory_create(directory.c_str(), directory.size());
}

void FileSystem::RemoveDirectory(const std::string &directory) {
    return duckdb_web_fs_directory_remove(directory.c_str(), directory.size());
}

bool FileSystem::ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) {
    list_files_callback = &callback;
    bool result = duckdb_web_fs_directory_list_files(directory.c_str(), directory.size());
    list_files_callback = {};
    return result;
}

void FileSystem::MoveFile(const std::string &source, const std::string &target) {
    duckdb_web_fs_file_move(source.c_str(), source.size(), target.c_str(), target.size());
}

bool FileSystem::FileExists(const std::string &filename) {
    return duckdb_web_fs_file_exists(filename.c_str(), filename.size());
}

void FileSystem::RemoveFile(const std::string &filename) { std::cout << "FileSystem not implemented" << std::endl; }

// std::string FileSystem::PathSeparator() {
//     std::cout << "PathSeparator not implemented" << std::endl;
//     return {};
// }
//
// std::string FileSystem::JoinPath(const std::string &a, const std::string &path) {
//     std::cout << "JoinPath not implemented" << std::endl;
//     return {};
// }

void FileSystem::SetWorkingDirectory(const std::string &path) {
    std::cout << "SetWorkingDirectory not implemented" << std::endl;
}

std::string FileSystem::GetWorkingDirectory() {
    std::cout << "GetWorkingDirectory not implemented" << std::endl;
    return {};
}

std::string FileSystem::GetHomeDirectory() {
    std::cout << "GetHomeDirectory not implemented" << std::endl;
    return {};
}

std::vector<std::string> FileSystem::Glob(const std::string &path) {
    std::vector<std::string> results;
    glob_results = &results;
    duckdb_web_fs_glob(path.c_str(), path.size());
    glob_results = {};

    return results;
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
