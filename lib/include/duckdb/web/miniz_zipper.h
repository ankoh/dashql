// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_
#define INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_

#include <optional>
#include <unordered_map>

#include "arrow/result.h"
#include "duckdb.hpp"
#include "duckdb/web/io/buffer_manager.h"
#include "miniz.hpp"

namespace duckdb {
namespace web {

struct ZipReader {
    /// The file buffer
    std::unique_ptr<char[]> file_buffer = nullptr;
    /// The full file buffer
    duckdb_miniz::mz_zip_archive archive;
    /// The data including the global directory
    nonstd::span<char> archive_data = {};
    /// The archive comment
    std::string archive_comment = {};

    /// Constructor
    ZipReader();
    /// Destructor
    ~ZipReader();
};

class Zipper {
   protected:
    /// The filesystem
    std::shared_ptr<io::BufferManager> buffer_manager_;
    /// The loaded archives
    std::optional<ZipReader> current_reader_ = std::nullopt;

   public:
    /// Constructor
    Zipper(std::shared_ptr<io::BufferManager> buffer_manager);

    /// Load zip from a buffer
    arrow::Status LoadFromFile(const char* path);
    /// Get the number of files in the archive
    arrow::Result<size_t> GetEntryCount();
    /// Get the entry info as JSON
    arrow::Result<std::string> GetEntryInfoAsJSON(size_t entryID);
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_MINIZ_ZIPPER_H_
