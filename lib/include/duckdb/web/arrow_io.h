// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_
#define INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_

#include "arrow/io/interfaces.h"
#include "duckdb/common/constants.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/web/filesystem.h"

namespace duckdb {
namespace web {

class WebDBInputFileStream : virtual public arrow::io::InputStream {
   protected:
    /// The file system
    duckdb::web::SeekableFileSystem& file_system_;
    /// The file handle
    std::unique_ptr<duckdb::web::WebDBFileHandle> file_handle_;
    /// The temporary buffer (if any)
    std::shared_ptr<arrow::ResizableBuffer> tmp_;
    /// The file position
    size_t file_position_;

   public:
    /// Constructor
    WebDBInputFileStream(duckdb::web::WebDBFileSystem& fs, std::unique_ptr<duckdb::web::WebDBFileHandle> handle);
    /// Destructor
    ~WebDBInputFileStream() override;

    /// File interface

    /// \brief Close the stream cleanly
    ///
    /// For writable streams, this will attempt to flush any pending data
    /// before releasing the underlying resource.
    ///
    /// After Close() is called, closed() returns true and the stream is not
    /// available for further operations.
    arrow::Status Close() override;

    /// \brief Close the stream abruptly
    ///
    /// This method does not guarantee that any pending data is flushed.
    /// It merely releases any underlying resource used by the stream for
    /// its operation.
    ///
    /// After Abort() is called, closed() returns true and the stream is not
    /// available for further operations.
    arrow::Status Abort() override;

    /// \brief Return the position in this stream
    arrow::Result<int64_t> Tell() const override;

    /// \brief Return whether the stream is closed
    bool closed() const override;

    /// Readable

    /// \brief Read data from current file position.
    ///
    /// Read at most `nbytes` from the current file position into `out`.
    /// The number of bytes read is returned.
    arrow::Result<int64_t> Read(int64_t nbytes, void* out) override;

    /// \brief Read data from current file position.
    ///
    /// Read at most `nbytes` from the current file position. Less bytes may
    /// be read if EOF is reached. This method updates the current file position.
    ///
    /// In some cases (e.g. a memory-mapped file), this method may avoid a
    /// memory copy.
    arrow::Result<std::shared_ptr<arrow::Buffer>> Read(int64_t nbytes) override;

    /// Input stream

    /// \brief Advance or skip stream indicated number of bytes
    /// \param[in] nbytes the number to move forward
    /// \return Status
    arrow::Status Advance(int64_t nbytes);

    /// \brief Return zero-copy string_view to upcoming bytes.
    ///
    /// Do not modify the stream position.  The view becomes invalid after
    /// any operation on the stream.  May trigger buffering if the requested
    /// size is larger than the number of buffered bytes.
    ///
    /// May return NotImplemented on streams that don't support it.
    ///
    /// \param[in] nbytes the maximum number of bytes to see
    arrow::Result<arrow::util::string_view> Peek(int64_t nbytes) override;

    /// \brief Return true if InputStream is capable of zero copy Buffer reads
    ///
    /// Zero copy reads imply the use of Buffer-returning Read() overloads.
    bool supports_zero_copy() const override;
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_
