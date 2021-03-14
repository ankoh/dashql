// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/filesystem.h"

static const std::function<void(std::string, bool)> *list_files_callback = {};

namespace dashql {
namespace webdb {

void WebDBFileHandle::Close() { dashql_webdb_fs_file_close(blob_id); }

std::unique_ptr<duckdb::FileHandle> WebDBFileSystem::OpenFile(const char *path, uint8_t flags,
                                                              duckdb::FileLockType lock) {
    return std::make_unique<WebDBFileHandle>(*this, std::string(path), dashql_webdb_fs_file_open(path, flags));
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

void WebDBFileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) { assert(false && "not implemented"); }

bool WebDBFileSystem::DirectoryExists(const std::string &directory) {
    return dashql_webdb_fs_directory_exists(directory.c_str());
}

void WebDBFileSystem::CreateDirectory(const std::string &directory) {
    dashql_webdb_fs_directory_create(directory.c_str());
}

void WebDBFileSystem::RemoveDirectory(const std::string &directory) {
    return dashql_webdb_fs_directory_remove(directory.c_str());
}

bool WebDBFileSystem::ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) {
    list_files_callback = &callback;
    bool result = dashql_webdb_fs_directory_list_files(directory.c_str());
    list_files_callback = {};
    return result;
}

void WebDBFileSystem::MoveFile(const std::string &source, const std::string &target) {
    dashql_webdb_fs_file_move(source.c_str(), target.c_str());
}

bool WebDBFileSystem::FileExists(const std::string &filename) { return dashql_webdb_fs_file_exists(filename.c_str()); }

std::string WebDBFileSystem::PathSeparator() {
    assert(false && "not implemented");
    return {};
}

std::string WebDBFileSystem::JoinPath(const std::string &a, const std::string &path) {
    assert(false && "not implemented");
    return {};
}

void WebDBFileSystem::FileSync(duckdb::FileHandle &handle) { assert(false && "not implemented"); }

void WebDBFileSystem::SetWorkingDirectory(const std::string &path) { assert(false && "not implemented"); }

std::string WebDBFileSystem::GetWorkingDirectory() {
    assert(false && "not implemented");
    return {};
}

std::string WebDBFileSystem::GetHomeDirectory() {
    assert(false && "not implemented");
    return {};
}

std::vector<std::string> WebDBFileSystem::Glob(const std::string &path) {
    assert(false && "not implemented");
    return {};
}

duckdb::idx_t WebDBFileSystem::GetAvailableMemory() {
    assert(false && "not implemented");
    return {};
}

}  // namespace webdb
}  // namespace dashql

extern "C" {
extern int64_t dashql_webdb_fs_read(dashql::BlobID blobId, void *buffer, int64_t bytes);
extern int64_t dashql_webdb_fs_write(dashql::BlobID blobId, void *buffer, int64_t bytes);

extern void dashql_webdb_fs_directory_remove(const char *path);
extern bool dashql_webdb_fs_directory_exists(const char *path);
extern void dashql_webdb_fs_directory_create(const char *path);
extern bool dashql_webdb_fs_directory_list_files(const char *path);
void dashql_webdb_fs_directory_list_files_callback(const char *path, bool is_dir) {
    (*list_files_callback)(path, is_dir);
}
extern dashql::BlobID dashql_webdb_fs_file_open(const char *path, uint8_t flags);
extern void dashql_webdb_fs_file_close(dashql::BlobID blobId);
extern int64_t dashql_webdb_fs_file_get_size(dashql::BlobID blobId);
extern time_t dashql_webdb_fs_file_get_last_modified_time(dashql::BlobID blobId);
extern void dashql_webdb_fs_file_move(const char *from, const char *to);
extern void dashql_webdb_fs_file_set_pointer(dashql::BlobID blobId, duckdb::idx_t location);
extern bool dashql_webdb_fs_file_exists(const char *path);
extern bool dashql_webdb_fs_file_remove(const char *path);

#ifndef EMSCRIPTEN
int64_t dashql_webdb_fs_read(dashql::BlobID blobId, void *buffer, int64_t bytes) { return {}; }
int64_t dashql_webdb_fs_write(dashql::BlobID blobId, void *buffer, int64_t bytes) { return {}; }

bool dashql_webdb_fs_directory_exists(const char *path) { return {}; };
void dashql_webdb_fs_directory_create(const char *path) {}
void dashql_webdb_fs_directory_remove(const char *path) {}
bool dashql_webdb_fs_directory_list_files(const char *path) {}

dashql::BlobID dashql_webdb_fs_file_open(const char *path, uint8_t flags) { return {}; }
void dashql_webdb_fs_file_close(dashql::BlobID blobId) {}
int64_t dashql_webdb_fs_file_get_size(dashql::BlobID blobId) { return {}; };
time_t dashql_webdb_fs_file_get_last_modified_time(dashql::BlobID blobId) { return {}; };
void dashql_webdb_fs_file_move(const char *from, const char *to) {}
void dashql_webdb_fs_file_set_pointer(dashql::BlobID blobId, duckdb::idx_t location) {}
bool dashql_webdb_fs_file_exists(const char *path) { return {}; };
bool dashql_webdb_fs_file_remove(const char *path) { return {}; };
#endif
}
