// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_
#define INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_

#include <unordered_map>

#include "arrow/result.h"
#include "duckdb.hpp"
#include "duckdb/web/filesystem.h"
#include "miniz.hpp"

namespace duckdb {
namespace web {

struct ZipArchive {
    /// The file buffer
    std::unique_ptr<uint8_t[]> file_buffer;
    /// The full file buffer
    duckdb_miniz::mz_zip_archive archive;
};

class Zipper {
   protected:
    /// The filesystem
    duckdb::FileSystem& filesystem_;
    /// The next archive id
    size_t next_achive_id_;
    /// The loaded archives
    std::unordered_map<size_t, ZipArchive> loaded_archives_;

   public:
    /// Constructor
    Zipper(duckdb::FileSystem& filesystem);

    /// Load zip from a buffer
    arrow::Result<size_t> LoadFromFile(const char* path);
    /// Get the number of files in the archive
    arrow::Result<size_t> GetFileCount(size_t archiveID);
    /// Get the file info as JSON
    arrow::Result<std::string> GetFileInfoAsJSON(size_t archiveID, size_t fileID);
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_
