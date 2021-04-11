// Copyright (c) 2020 The DashQL Authors

#include "duckdb/web/filesystem.h"

#include <iostream>
#include <string>
#include <vector>

static const std::function<void(std::string, bool)> *list_files_callback = {};
static std::vector<std::string> *glob_results = {};

namespace duckdb {
namespace web {

void WebDBFileHandle::Close() { duckdb_web_fs_file_close(blob_id); }

std::unique_ptr<duckdb::FileHandle> WebDBFileSystem::OpenFile(const char *path, uint8_t flags,
                                                              duckdb::FileLockType lock) {
    return std::make_unique<WebDBFileHandle>(*this, std::string(path),
                                             duckdb_web_fs_file_open(path, strlen(path), flags));
}

void WebDBFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    duckdb_web_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

void WebDBFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) {
    duckdb_web_fs_file_set_pointer(((WebDBFileHandle &)handle).blob_id, location);
    duckdb_web_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_read(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) {
    return duckdb_web_fs_write(((WebDBFileHandle &)handle).blob_id, buffer, nr_bytes);
}

int64_t WebDBFileSystem::GetFileSize(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_size(((WebDBFileHandle &)handle).blob_id);
}

time_t WebDBFileSystem::GetLastModifiedTime(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_get_last_modified_time(((WebDBFileHandle &)handle).blob_id);
}

void WebDBFileSystem::Truncate(duckdb::FileHandle &handle, int64_t new_size) {
    std::cout << "Truncate not implemented" << std::endl;
}

bool WebDBFileSystem::DirectoryExists(const std::string &directory) {
    return duckdb_web_fs_directory_exists(directory.c_str(), directory.size());
}

void WebDBFileSystem::CreateDirectory(const std::string &directory) {
    duckdb_web_fs_directory_create(directory.c_str(), directory.size());
}

void WebDBFileSystem::RemoveDirectory(const std::string &directory) {
    return duckdb_web_fs_directory_remove(directory.c_str(), directory.size());
}

bool WebDBFileSystem::ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) {
    list_files_callback = &callback;
    bool result = duckdb_web_fs_directory_list_files(directory.c_str(), directory.size());
    list_files_callback = {};
    return result;
}

void WebDBFileSystem::MoveFile(const std::string &source, const std::string &target) {
    duckdb_web_fs_file_move(source.c_str(), source.size(), target.c_str(), target.size());
}

bool WebDBFileSystem::FileExists(const std::string &filename) {
    return duckdb_web_fs_file_exists(filename.c_str(), filename.size());
}

void WebDBFileSystem::RemoveFile(const std::string &filename) {
    std::cout << "WebDBFileSystem not implemented" << std::endl;
}

// std::string WebDBFileSystem::PathSeparator() {
//     std::cout << "PathSeparator not implemented" << std::endl;
//     return {};
// }
//
// std::string WebDBFileSystem::JoinPath(const std::string &a, const std::string &path) {
//     std::cout << "JoinPath not implemented" << std::endl;
//     return {};
// }

void WebDBFileSystem::FileSync(duckdb::FileHandle &handle) {
    return duckdb_web_fs_file_sync(((WebDBFileHandle &)handle).blob_id);
}

void WebDBFileSystem::SetWorkingDirectory(const std::string &path) {
    std::cout << "SetWorkingDirectory not implemented" << std::endl;
}

std::string WebDBFileSystem::GetWorkingDirectory() {
    std::cout << "GetWorkingDirectory not implemented" << std::endl;
    return {};
}

std::string WebDBFileSystem::GetHomeDirectory() {
    std::cout << "GetHomeDirectory not implemented" << std::endl;
    return {};
}

std::vector<std::string> WebDBFileSystem::Glob(const std::string &path) {
    std::vector<std::string> results;
    glob_results = &results;
    duckdb_web_fs_glob(path.c_str(), path.size());
    glob_results = {};

    return results;
}

// duckdb::idx_t WebDBFileSystem::GetAvailableMemory() {
//     std::cout << "GetAvailableMemory not implemented" << std::endl;
//     return {};
// }

FileSystemStreamBuffer::FileSystemStreamBuffer(duckdb::FileSystem &file_system, duckdb::FileHandle &file_handle)
    : file_system_(file_system),
      file_handle_(file_handle),
      file_size_(file_system_.GetFileSize(file_handle)),
      file_pos_(0) {
    buffer_.reserve(FS_STREAMBUF_SIZE);
}

std::streamsize FileSystemStreamBuffer::showmanyc() {
    if (egptr() - gptr() == 0) {
        underflow();
    }
    return egptr() - gptr();
}

FileSystemStreamBuffer::pos_type FileSystemStreamBuffer::seekoff(FileSystemStreamBuffer::off_type off,
                                                                 std::ios_base::seekdir dir, std::ios_base::openmode) {
    if (dir == std::ios_base::beg) {
        file_pos_ = off;
    } else if (dir == std::ios_base::end) {
        file_pos_ = file_size_ - off;
    } else {
        file_pos_ += off;
    }

    return file_pos_;
}

FileSystemStreamBuffer::pos_type FileSystemStreamBuffer::seekpos(FileSystemStreamBuffer::pos_type pos,
                                                                 std::ios_base::openmode) {
    file_pos_ = pos;
    return file_pos_;
}

FileSystemStreamBuffer::int_type FileSystemStreamBuffer::underflow() {
    if (gptr() < egptr()) return *gptr();
    if (file_pos_ >= file_size_) return std::streambuf::traits_type::eof();

    auto read = std::min(file_size_ - (int64_t)file_pos_, (int64_t)buffer_.capacity());
    buffer_.resize(read);
    file_system_.Read(file_handle_, &buffer_[0], read, file_pos_);
    setg(&buffer_[0], &buffer_[0], &buffer_[0] + buffer_.size());
    file_pos_ += read;
    return *gptr();
}

}  // namespace web
}  // namespace duckdb

extern "C" {
extern ssize_t duckdb_web_fs_tell(size_t blobId);
extern void duckdb_web_fs_advance(size_t blobId, ssize_t bytes);
extern ssize_t duckdb_web_fs_peek(size_t blobId, void *buffer, ssize_t bytes);
extern ssize_t duckdb_web_fs_read(size_t blobId, void *buffer, ssize_t bytes);
extern ssize_t duckdb_web_fs_write(size_t blobId, void *buffer, ssize_t bytes);

extern void duckdb_web_fs_directory_remove(const char *path, size_t pathLen);
extern bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen);
extern void duckdb_web_fs_directory_create(const char *path, size_t pathLen);
extern bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen);

extern void duckdb_web_fs_glob(const char *path, size_t pathLen);

void duckdb_web_fs_directory_list_files_callback(const char *path, size_t pathLen, bool is_dir) {
    (*list_files_callback)(std::string(path, pathLen), is_dir);
}
void duckdb_web_fs_glob_callback(const char *path, size_t pathLen) { glob_results->emplace_back(path, pathLen); }

extern void duckdb_web_fs_file_sync(size_t blobId);
extern size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags);
extern void duckdb_web_fs_file_close(size_t blobId);
extern ssize_t duckdb_web_fs_file_get_size(size_t blobId);
extern time_t duckdb_web_fs_file_get_last_modified_time(size_t blobId);
extern void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen);
extern void duckdb_web_fs_file_set_pointer(size_t blobId, duckdb::idx_t location);
extern bool duckdb_web_fs_file_exists(const char *path, size_t pathLen);
extern bool duckdb_web_fs_file_remove(const char *path, size_t pathLen);

#ifndef EMSCRIPTEN
int64_t duckdb_web_fs_read(size_t blobId, void *buffer, int64_t bytes) { return {}; }
int64_t duckdb_web_fs_write(size_t blobId, void *buffer, int64_t bytes) { return {}; }

bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen) { return {}; };
void duckdb_web_fs_directory_create(const char *path, size_t pathLen) {}
void duckdb_web_fs_directory_remove(const char *path, size_t pathLen) {}
bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen) { return {}; }
void duckdb_web_fs_glob(const char *path, size_t pathLen) {}

void duckdb_web_fs_file_sync(size_t blobId) {}
size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags) { return {}; }
void duckdb_web_fs_file_close(size_t blobId) {}
int64_t duckdb_web_fs_file_get_size(size_t blobId) { return {}; };
time_t duckdb_web_fs_file_get_last_modified_time(size_t blobId) { return {}; };
void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen) {}
void duckdb_web_fs_file_set_pointer(size_t blobId, duckdb::idx_t location) {}
bool duckdb_web_fs_file_exists(const char *path, size_t pathLen) { return {}; };
bool duckdb_web_fs_file_remove(const char *path, size_t pathLen) { return {}; };
#endif
}
