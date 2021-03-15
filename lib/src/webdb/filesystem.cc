// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/filesystem.h"

#include <string>
#include <vector>

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace dashql {
namespace webdb {

void WebDBFileHandle::Close() { dashql_webdb_fs_file_close(blob_id); }

std::unique_ptr<duckdb::FileHandle> WebDBFileSystem::OpenFile(const char *path, uint8_t flags,
                                                              duckdb::FileLockType lock) {
    return std::make_unique<WebDBFileHandle>(*this, std::string(path),
                                             dashql_webdb_fs_file_open(path, std::strlen(path), flags));
}

void WebDBFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    dashql_webdb_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    dashql_webdb_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

void WebDBFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    dashql_webdb_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    dashql_webdb_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return dashql_webdb_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return dashql_webdb_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::GetFileSize(duckdb::FileHandle &handle) {
    return dashql_webdb_fs_file_get_size(((WebDBFileHandle &)handle).blob_id);
}

time_t WebDBFileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    return dashql_webdb_fs_file_get_last_modified_time(((WebDBFileHandle &)handle).blob_id);
}

void WebDBFileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) {
    std::cerr << "Truncate not implemented" << std::endl;
}

bool WebDBFileSystem::DirectoryExists(const std::string &directory) {
    return dashql_webdb_fs_directory_exists(directory.c_str(), directory.size());
}

void WebDBFileSystem::CreateDirectory(const std::string &directory) {
    dashql_webdb_fs_directory_create(directory.c_str(), directory.size());
}

void WebDBFileSystem::RemoveDirectory(const std::string &directory) {
    return dashql_webdb_fs_directory_remove(directory.c_str(), directory.size());
}

bool WebDBFileSystem::ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) {
    list_files_callback = &callback;
    bool result = dashql_webdb_fs_directory_list_files(directory.c_str(), directory.size());
    list_files_callback = {};
    return result;
}

void WebDBFileSystem::MoveFile(const std::string &source, const std::string &target) {
    dashql_webdb_fs_file_move(source.c_str(), source.size(), target.c_str(), target.size());
}

bool WebDBFileSystem::FileExists(const std::string &filename) {
    return dashql_webdb_fs_file_exists(filename.c_str(), filename.size());
}

std::string WebDBFileSystem::PathSeparator() {
    std::cerr << "PathSeparator not implemented" << std::endl;
    return {};
}

std::string WebDBFileSystem::JoinPath(const std::string &a, const std::string &path) {
    std::cerr << "JoinPath not implemented" << std::endl;
    return {};
}

void WebDBFileSystem::FileSync(duckdb::FileHandle &handle) { std::cerr << "FileSync not implemented" << std::endl; }

void WebDBFileSystem::SetWorkingDirectory(const std::string &path) { std::cerr << " not implemented" << std::endl; }

std::string WebDBFileSystem::GetWorkingDirectory() {
    std::cerr << "GetWorkingDirectory not implemented" << std::endl;
    return {};
}

std::string WebDBFileSystem::GetHomeDirectory() {
    std::cerr << "GetHomeDirectory not implemented" << std::endl;
    return {};
}

std::vector<std::string> WebDBFileSystem::Glob(const std::string &path) {
    std::vector<std::string> results;
    glob_results = &results;
    dashql_webdb_fs_glob(path.c_str(), path.size());
    glob_results = {};

    return results;
}

duckdb::idx_t WebDBFileSystem::GetAvailableMemory() {
    std::cerr << "GetAvailableMemory not implemented" << std::endl;
    return {};
}

}  // namespace webdb
}  // namespace dashql

extern "C" {
extern int64_t dashql_webdb_fs_read(dashql::BlobID blobId, void *buffer, int64_t bytes);
extern int64_t dashql_webdb_fs_write(dashql::BlobID blobId, void *buffer, int64_t bytes);

extern void dashql_webdb_fs_directory_remove(const char *path, size_t pathLen);
extern bool dashql_webdb_fs_directory_exists(const char *path, size_t pathLen);
extern void dashql_webdb_fs_directory_create(const char *path, size_t pathLen);
extern bool dashql_webdb_fs_directory_list_files(const char *path, size_t pathLen);

extern void dashql_webdb_fs_glob(const char *path, size_t pathLen);

void dashql_webdb_fs_directory_list_files_callback(const char *path, size_t pathLen, bool is_dir) {
    (*list_files_callback)(std::string(path, pathLen), is_dir);
}
void dashql_webdb_fs_glob_callback(const char *path, size_t pathLen) { glob_results->emplace_back(path, pathLen); }

extern dashql::BlobID dashql_webdb_fs_file_open(const char *path, size_t pathLen, uint8_t flags);
extern void dashql_webdb_fs_file_close(dashql::BlobID blobId);
extern int64_t dashql_webdb_fs_file_get_size(dashql::BlobID blobId);
extern time_t dashql_webdb_fs_file_get_last_modified_time(dashql::BlobID blobId);
extern void dashql_webdb_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen);
extern void dashql_webdb_fs_file_set_pointer(dashql::BlobID blobId, duckdb::idx_t location);
extern bool dashql_webdb_fs_file_exists(const char *path, size_t pathLen);
extern bool dashql_webdb_fs_file_remove(const char *path, size_t pathLen);

#ifndef EMSCRIPTEN
int64_t dashql_webdb_fs_read(dashql::BlobID blobId, void *buffer, int64_t bytes) { return {}; }
int64_t dashql_webdb_fs_write(dashql::BlobID blobId, void *buffer, int64_t bytes) { return {}; }

bool dashql_webdb_fs_directory_exists(const char *path, size_t pathLen) { return {}; };
void dashql_webdb_fs_directory_create(const char *path, size_t pathLen) {}
void dashql_webdb_fs_directory_remove(const char *path, size_t pathLen) {}
bool dashql_webdb_fs_directory_list_files(const char *path, size_t pathLen) {}

dashql::BlobID dashql_webdb_fs_file_open(const char *path, size_t pathLen, uint8_t flags) { return {}; }
void dashql_webdb_fs_file_close(dashql::BlobID blobId) {}
int64_t dashql_webdb_fs_file_get_size(dashql::BlobID blobId) { return {}; };
time_t dashql_webdb_fs_file_get_last_modified_time(dashql::BlobID blobId) { return {}; };
void dashql_webdb_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen) {}
void dashql_webdb_fs_file_set_pointer(dashql::BlobID blobId, duckdb::idx_t location) {}
bool dashql_webdb_fs_file_exists(const char *path, size_t pathLen) { return {}; };
bool dashql_webdb_fs_file_remove(const char *path, size_t pathLen) { return {}; };
#endif
}
