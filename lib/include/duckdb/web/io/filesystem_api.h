// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_IO_FILESYSTEM_API_H_
#define INCLUDE_DUCKDB_WEB_IO_FILESYSTEM_API_H_

#include <cstddef>
#include <cstdint>
#include <ctime>
#include <memory>

namespace duckdb {
namespace web {
namespace io {

class File {
   public:
    /// File mode (read or write)
    enum Mode { READ, WRITE };

    /// Destructor
    virtual ~File() = default;

    /// Returns the `Mode` this file was opened with.
    virtual Mode GetMode() const = 0;
    /// Returns the current size of the file in bytes.
    virtual size_t Size() const = 0;
    /// Resizes the file to `new_size`.
    virtual void Resize(size_t new_size) = 0;
    /// Reads a block of the file.
    /// `offset + size` must not be larger than `size()`.
    virtual void ReadBlock(size_t offset, size_t size, char *block) = 0;
    /// Writes a block to the file.
    /// `offset + size` must not be larger than `size()`.
    /// If you want to write past the end of the file, use `resize()` first.
    /// This function must not be used when the file was opened in `READ` mode.
    virtual void WriteBlock(const char *block, size_t offset, size_t size) = 0;
    /// Returns the file last modified time of a file handle, returns timespec with zero on all attributes on error
    virtual time_t GetLastModifiedTime() = 0;

    /// Opens a file with the given mode. Existing files are never overwritten
    static std::shared_ptr<File> OpenFile(const char *filename, Mode mode);
    /// Opens a temporary file in `WRITE` mode. The file will be deleted automatically after use.
    static std::shared_ptr<File> MakeTemporaryFile();
};

}  // namespace io
}  // namespace web
}  // namespace duckdb

extern "C" {
bool duckdb_web_fs_directory_exists(const char *path, size_t pathLen);
void duckdb_web_fs_directory_create(const char *path, size_t pathLen);
void duckdb_web_fs_directory_remove(const char *path, size_t pathLen);
bool duckdb_web_fs_directory_list_files(const char *path, size_t pathLen);
void duckdb_web_fs_directory_list_files_callback(const char *path, size_t pathLen, bool is_dir);
void duckdb_web_fs_glob(const char *path, size_t pathLen);
void duckdb_web_fs_glob_callback(const char *path, size_t pathLen);

void duckdb_web_fs_file_move(const char *from, size_t fromLen, const char *to, size_t toLen);
bool duckdb_web_fs_file_exists(const char *path, size_t pathLen);
bool duckdb_web_fs_file_remove(const char *path, size_t pathLen);
}

#endif
