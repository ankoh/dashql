// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_FILESYSTEM_H_
#define INCLUDE_DUCKDB_WEB_FILESYSTEM_H_

#include <arrow/util/string_view.h>

#include "duckdb/common/constants.hpp"
#include "duckdb/common/file_system.hpp"

namespace duckdb {
namespace web {

class WebDBFileHandle : public duckdb::FileHandle {
   public:
    /// Constructor
    WebDBFileHandle(duckdb::FileSystem &file_system, std::string path, size_t blob_id)
        : duckdb::FileHandle(file_system, path), blob_id(blob_id) {}
    /// Destructor
    WebDBFileHandle(const WebDBFileHandle &) = delete;
    virtual ~WebDBFileHandle() {}

   protected:
    void Close() override;

   public:
    size_t blob_id;
};

class SeekableFileSystem : public duckdb::FileSystem {
   public:
    virtual ~SeekableFileSystem();

    /// Set the current position in the file
    virtual void SetFilePointer(duckdb::FileHandle &handle, size_t pos);
};

class WebFileSystem : public SeekableFileSystem {
   public:
    /// Constructor
    WebFileSystem() {}
    /// Destructor
    virtual ~WebFileSystem() {}

    /// Set the current position in the file
    void SetFilePointer(duckdb::FileHandle &handle, size_t pos) override;

    /// Open a file
    std::unique_ptr<duckdb::FileHandle> OpenFile(const char *path, uint8_t flags,
                                                 duckdb::FileLockType lock = duckdb::FileLockType::NO_LOCK) override;
    /// Read exactly nr_bytes from the specified location in the file. Fails if nr_bytes could not be read. This is
    /// equivalent to calling SetFilePointer(location) followed by calling Read().
    void Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) override;
    /// Write exactly nr_bytes to the specified location in the file. Fails if nr_bytes could not be read. This is
    /// equivalent to calling SetFilePointer(location) followed by calling Write().
    void Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes, duckdb::idx_t location) override;
    /// Read nr_bytes from the specified file into the buffer, moving the file pointer forward by nr_bytes. Returns the
    /// amount of bytes read.
    int64_t Read(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) override;
    /// Write nr_bytes from the buffer into the file, moving the file pointer forward by nr_bytes.
    int64_t Write(duckdb::FileHandle &handle, void *buffer, int64_t nr_bytes) override;

    /// Returns the file size of a file handle, returns -1 on error
    int64_t GetFileSize(duckdb::FileHandle &handle) override;
    /// Returns the file last modified time of a file handle, returns timespec with zero on all attributes on error
    time_t GetLastModifiedTime(duckdb::FileHandle &handle) override;
    /// Truncate a file to a maximum size of new_size, new_size should be smaller than or equal to the current size of
    /// the file
    void Truncate(duckdb::FileHandle &handle, int64_t new_size) override;

    /// Check if a directory exists
    bool DirectoryExists(const std::string &directory) override;
    /// Create a directory if it does not exist
    void CreateDirectory(const std::string &directory) override;
    /// Recursively remove a directory and all files in it
    void RemoveDirectory(const std::string &directory) override;
    /// List files in a directory, invoking the callback method for each one with (filename, is_dir)
    bool ListFiles(const std::string &directory, const std::function<void(std::string, bool)> &callback) override;
    /// Move a file from source path to the target, StorageManager relies on this being an atomic action for ACID
    /// properties
    void MoveFile(const std::string &source, const std::string &target) override;
    /// Check if a file exists
    bool FileExists(const std::string &filename) override;
    /// Remove a file from disk
    void RemoveFile(const std::string &filename) override;
    // /// Path separator for the current file system
    // std::string PathSeparator() override;
    // /// Join two paths together
    // std::string JoinPath(const std::string &a, const std::string &path) override;
    /// Sync a file handle to disk
    void FileSync(duckdb::FileHandle &handle) override;

    /// Sets the working directory
    void SetWorkingDirectory(const std::string &path) override;
    /// Gets the working directory
    std::string GetWorkingDirectory() override;
    /// Gets the users home directory
    std::string GetHomeDirectory() override;

    /// Runs a glob on the file system, returning a list of matching files
    std::vector<std::string> Glob(const std::string &path) override;

    // /// Returns the system-available memory in bytes
    // duckdb::idx_t GetAvailableMemory() override;
};

}  // namespace web
}  // namespace duckdb

#endif
