// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_IO_FILESYSTEM_API_H_
#define INCLUDE_DUCKDB_WEB_IO_FILESYSTEM_API_H_

#include <cstddef>
#include <cstdint>
#include <ctime>

extern "C" {
size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags);
void duckdb_web_fs_file_close(size_t fileId);
ptrdiff_t duckdb_web_fs_file_get_size(size_t fileId);
ptrdiff_t duckdb_web_fs_read(size_t fileId, void *buffer, ptrdiff_t bytes);
ptrdiff_t duckdb_web_fs_write(size_t fileId, void *buffer, ptrdiff_t bytes);
void duckdb_web_fs_file_sync(size_t fileId);

bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen);
void duckdb_web_fs_directory_create(const char *path, size_t pathLen);
void duckdb_web_fs_directory_remove(const char *path, size_t pathLen);
bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen);
void duckdb_web_fs_directory_list_files_callback(const char *path, size_t pathLen, bool is_dir);
void duckdb_web_fs_glob(const char *path, size_t pathLen);
void duckdb_web_fs_glob_callback(const char *path, size_t pathLen);

time_t duckdb_web_fs_file_get_last_modified_time(size_t fileId);
void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen);
void duckdb_web_fs_file_set_pointer(size_t fileId, size_t location);
bool duckdb_web_fs_file_exists(const char *path, size_t pathLen);
bool duckdb_web_fs_file_remove(const char *path, size_t pathLen);
}

#endif
