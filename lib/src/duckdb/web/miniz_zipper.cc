#include "duckdb/web/miniz_zipper.h"

#include <duckdb/common/file_system.hpp>

#include "miniz.hpp"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace duckdb {
namespace web {

/// Constructor
Zipper::Zipper(std::shared_ptr<io::BufferManager> buffer_manager)
    : buffer_manager_(std::move(buffer_manager)), next_achive_id_(), loaded_archives_() {}

/// Open a file
arrow::Result<size_t> Zipper::LoadFromFile(const char* path) {
    // Read the full file into the buffer.
    /// XXX Miniz currently does not support streaming archive extraction.
    ///     We'd actually prefer reading the file incrementally.
    std::unique_ptr<uint8_t[]> buffer = nullptr;
    size_t buffer_size = 0;
    {
        auto file = buffer_manager_->OpenFile(path);
        buffer_size = buffer_manager_->GetFileSize(file);
        buffer = std::unique_ptr<uint8_t[]>(new uint8_t[buffer_size]());
        buffer_manager_->Read(file, buffer.get(), buffer_size, 0);
    }

    // Load the miniz archive
    duckdb_miniz::mz_zip_archive archive;
    auto ok = duckdb_miniz::mz_zip_reader_init_mem(&archive, buffer.get(), buffer_size, 0);
    if (!ok) {
        return arrow::Status{arrow::StatusCode::ExecutionError, "failed to read zip archive"};
    }

    // Register as loaded archive
    auto archive_id = next_achive_id_++;
    loaded_archives_.insert({archive_id, ZipArchive{.file_buffer = std::move(buffer), .archive = std::move(archive)}});
    return archive_id;
}

/// Get the number of entries in the archive
arrow::Result<size_t> Zipper::GetEntryCount(size_t archiveID) {
    auto iter = loaded_archives_.find(archiveID);
    if (iter == loaded_archives_.end()) return 0;
    return duckdb_miniz::mz_zip_reader_get_num_files(&iter->second.archive);
}

/// Get the entry info as JSON
arrow::Result<std::string> Zipper::GetEntryInfoAsJSON(size_t archiveID, size_t fileID) {
    auto iter = loaded_archives_.find(archiveID);
    if (iter == loaded_archives_.end()) return "";
    duckdb_miniz::mz_zip_archive_file_stat stat;
    duckdb_miniz::mz_zip_reader_file_stat(&iter->second.archive, fileID, &stat);

    // Write JSON with the SAX api
    rapidjson::StringBuffer out;
    rapidjson::Writer writer(out);
    writer.StartObject();
    writer.Key("fileIndex");
    writer.Uint(fileID);
    writer.Key("fileName");
    writer.String(stat.m_filename, std::strlen(stat.m_filename));
    writer.Key("versionMadeBy");
    writer.Uint(stat.m_version_made_by);
    writer.Key("versionNeeded");
    writer.Uint(stat.m_version_needed);
    writer.Key("centralDirOffset");
    writer.Uint(stat.m_central_dir_ofs);
    writer.Key("headerOffset");
    writer.Uint(stat.m_local_header_ofs);
    writer.Key("crc32");
    writer.Uint(stat.m_crc32);
    writer.Key("bitFlag");
    writer.Uint(stat.m_bit_flag);
    writer.Key("method");
    writer.Uint(stat.m_method);
    writer.Key("sizeCompressed");
    writer.Uint(stat.m_comp_size);
    writer.Key("sizeUncompressed");
    writer.Uint(stat.m_uncomp_size);
    writer.Key("attributesInternal");
    writer.Uint(stat.m_internal_attr);
    writer.Key("attributesExternal");
    writer.Uint(stat.m_external_attr);
    writer.Key("isDirectory");
    writer.Bool(stat.m_is_directory);
    writer.Key("isEncrypted");
    writer.Bool(stat.m_is_encrypted);
    writer.Key("isSupported");
    writer.Bool(stat.m_is_supported);
    writer.Key("comment");
    writer.String(stat.m_comment, stat.m_comment_size);
    writer.EndObject();

    return out.GetString();
}

}  // namespace web
}  // namespace duckdb
