#include <cstddef>

#include "duckdb/web/io/filesystem_api.h"

#ifndef EMSCRIPTEN
size_t duckdb_web_fs_file_open(const char *path, size_t pathLen, uint8_t flags) { return {}; }
void duckdb_web_fs_file_close(size_t fileId) {}
ptrdiff_t duckdb_web_fs_file_get_size(size_t fileId) { return {}; };
ptrdiff_t duckdb_web_fs_read(size_t fileId, void *buffer, int64_t bytes) { return {}; }
ptrdiff_t duckdb_web_fs_write(size_t fileId, void *buffer, int64_t bytes) { return {}; }
void duckdb_web_fs_file_sync(size_t fileId) {}

bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen) { return {}; };
void duckdb_web_fs_directory_create(const char *path, size_t pathLen) {}
void duckdb_web_fs_directory_remove(const char *path, size_t pathLen) {}
bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen) { return {}; }
void duckdb_web_fs_glob(const char *path, size_t pathLen) {}
time_t duckdb_web_fs_file_get_last_modified_time(size_t fileId) { return {}; };
void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen) {}
bool duckdb_web_fs_file_exists(const char *path, size_t pathLen) { return {}; };
bool duckdb_web_fs_file_remove(const char *path, size_t pathLen) { return {}; };
#endif
