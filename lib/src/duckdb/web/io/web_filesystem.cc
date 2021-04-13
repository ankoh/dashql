// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/io/web_filesystem.h"

#include <iostream>
#include <string>
#include <vector>

#include "duckdb/common/file_system.hpp"

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace duckdb {
namespace web {
namespace io {

extern "C" {
extern size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags);
extern void duckdb_web_fs_file_close(size_t blobId);
extern time_t duckdb_web_fs_file_get_last_modified_time(size_t blobId);
extern ssize_t duckdb_web_fs_file_get_size(size_t blobId);
extern ssize_t duckdb_web_fs_read(size_t blobId, void *buffer, ssize_t bytes);
extern ssize_t duckdb_web_fs_write(size_t blobId, void *buffer, ssize_t bytes);
extern void duckdb_web_fs_file_sync(size_t blobId);

extern void duckdb_web_fs_directory_remove(const char *path, size_t pathLen);
extern bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen);
extern void duckdb_web_fs_directory_create(const char *path, size_t pathLen);
extern bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen);

extern void duckdb_web_fs_glob(const char *path, size_t pathLen);

void duckdb_web_fs_directory_list_files_callback(const char *path, size_t pathLen, bool is_dir) {
    (*list_files_callback)(std::string(path, pathLen), is_dir);
}
void duckdb_web_fs_glob_callback(const char *path, size_t pathLen) { glob_results->emplace_back(path, pathLen); }

extern void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen);
extern void duckdb_web_fs_file_set_pointer(size_t blobId, size_t location);
extern bool duckdb_web_fs_file_exists(const char *path, size_t pathLen);
extern bool duckdb_web_fs_file_remove(const char *path, size_t pathLen);
}

void WebFileHandle::Close() { duckdb_web_fs_file_close(file_id); }

std::unique_ptr<duckdb::FileHandle> WebFileSystem::OpenFile(const char *path, uint8_t flags,
                                                            duckdb::FileLockType lock) {
    return std::make_unique<WebFileHandle>(*this, std::string(path),
                                           duckdb_web_fs_file_open(path, strlen(path), flags));
}

void WebFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebFileHandle &)handle).file_id, location);
    duckdb_web_fs_read(((WebFileHandle &)handle).file_id, buffer, nr_bytes);
}

void WebFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebFileHandle &)handle).file_id, location);
    duckdb_web_fs_write(((WebFileHandle &)handle).file_id, buffer, nr_bytes);
}

int64_t WebFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_read(((WebFileHandle &)handle).file_id, buffer, nr_bytes);
}

int64_t WebFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_write(((WebFileHandle &)handle).file_id, buffer, nr_bytes);
}

int64_t WebFileSystem::GetFileSize(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_size(((WebFileHandle &)handle).file_id);
}

time_t WebFileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_last_modified_time(((WebFileHandle &)handle).file_id);
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
    return duckdb_web_fs_file_sync(((WebFileHandle &)handle).file_id);
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

}  // namespace io
}  // namespace web
}  // namespace duckdb

#ifndef EMSCRIPTEN
extern "C" {
size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags) { return 0; }
void duckdb_web_fs_file_close(size_t blobId) {}
time_t duckdb_web_fs_file_get_last_modified_time(size_t blobId) { return 0; }
ssize_t duckdb_web_fs_file_get_size(size_t blobId) { return 0; }
ssize_t duckdb_web_fs_read(size_t blobId, void *buffer, ssize_t bytes) { return 0; }
ssize_t duckdb_web_fs_write(size_t blobId, void *buffer, ssize_t bytes) { return 0; }
void duckdb_web_fs_file_sync(size_t blobId) {}

bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen) { return {}; };
void duckdb_web_fs_directory_create(const char *path, size_t pathLen) {}
void duckdb_web_fs_directory_remove(const char *path, size_t pathLen) {}
bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen) { return {}; }
void duckdb_web_fs_glob(const char *path, size_t pathLen) {}

void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen) {}
void duckdb_web_fs_file_set_pointer(size_t blobId, size_t location) {}
bool duckdb_web_fs_file_exists(const char *path, size_t pathLen) { return {}; };
bool duckdb_web_fs_file_remove(const char *path, size_t pathLen) { return {}; };
}
#endif
