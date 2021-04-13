// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/filesystem.h"

#include <iostream>
#include <string>
#include <vector>

#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/filesystem_api.h"

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace duckdb {
namespace web {

SeekableFileSystem::~SeekableFileSystem() {}

void SeekableFileSystem::SetFilePointer(duckdb::FileHandle &handle, size_t pos) {
    /// This is a hack to seek using the current duckdb filesystem api
    Read(handle, nullptr, 0, pos);
}

void WebDBFileHandle::Close() { duckdb_web_fs_file_close(blob_id); }

void WebFileSystem::SetFilePointer(duckdb::FileHandle &handle, size_t pos) {
    duckdb_web_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, pos);
}

std::unique_ptr<duckdb::FileHandle> WebFileSystem::OpenFile(const char *path, uint8_t flags,
                                                            duckdb::FileLockType lock) {
    return std::make_unique<WebDBFileHandle>(*this, std::string(path),
                                             duckdb_web_fs_file_open(path, strlen(path), flags));
}

void WebFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    duckdb_web_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

void WebFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    duckdb_web_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebFileSystem::GetFileSize(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_size(((WebDBFileHandle &)handle).blob_id);
}

time_t WebFileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_last_modified_time(((WebDBFileHandle &)handle).blob_id);
}

void WebFileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) {
    std::cout << "Truncate not implemented" << std::endl;
}

bool WebFileSystem::DirectoryExists(const std::string &directory) {
    return duckdb_web_fs_directory_exists(directory.c_str(), directory.size());
}

void WebFileSystem::CreateDirectory(const std::string &directory) {
    duckdb_web_fs_directory_create(directory.c_str(), directory.size());
}

void WebFileSystem::RemoveDirectory(const std::string &directory) {
    return duckdb_web_fs_directory_remove(directory.c_str(), directory.size());
}

bool WebFileSystem::ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) {
    list_files_callback = &callback;
    bool result = duckdb_web_fs_directory_list_files(directory.c_str(), directory.size());
    list_files_callback = {};
    return result;
}

void WebFileSystem::MoveFile(const std::string &source, const std::string &target) {
    duckdb_web_fs_file_move(source.c_str(), source.size(), target.c_str(), target.size());
}

bool WebFileSystem::FileExists(const std::string &filename) {
    return duckdb_web_fs_file_exists(filename.c_str(), filename.size());
}

void WebFileSystem::RemoveFile(const std::string &filename) {
    std::cout << "WebFileSystem not implemented" << std::endl;
}

// std::string WebFileSystem::PathSeparator() {
//     std::cout << "PathSeparator not implemented" << std::endl;
//     return {};
// }
//
// std::string WebFileSystem::JoinPath(const std::string &a, const std::string &path) {
//     std::cout << "JoinPath not implemented" << std::endl;
//     return {};
// }

void WebFileSystem::FileSync(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_sync(((WebDBFileHandle &)handle).blob_id);
}

void WebFileSystem::SetWorkingDirectory(const std::string &path) {
    std::cout << "SetWorkingDirectory not implemented" << std::endl;
}

std::string WebFileSystem::GetWorkingDirectory() {
    std::cout << "GetWorkingDirectory not implemented" << std::endl;
    return {};
}

std::string WebFileSystem::GetHomeDirectory() {
    std::cout << "GetHomeDirectory not implemented" << std::endl;
    return {};
}

std::vector<std::string> WebFileSystem::Glob(const std::string &path) {
    std::vector<std::string> results;
    glob_results = &results;
    duckdb_web_fs_glob(path.c_str(), path.size());
    glob_results = {};

    return results;
}

}  // namespace web
}  // namespace duckdb
