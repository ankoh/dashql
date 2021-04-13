// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_
#define INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_

#include "arrow/io/interfaces.h"
#include "duckdb/common/constants.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/web/io/buffer_manager.h"

namespace duckdb {
namespace web {
namespace io {

class InputFileStream : virtual public arrow::io::InputStream {
   protected:
    /// The file system
    BufferManager& buffer_manager_;
    /// The file id
    BufferManager::FileRef file_;
    /// The file position
    size_t file_position_ = 0;
    /// The temporarily fixed page
    std::optional<BufferManager::BufferRef> tmp_page_ = std::nullopt;

   public:
    /// Constructor
    InputFileStream(io::BufferManager& buffer_manager, std::string_view path);
    /// Destructor
    ~InputFileStream() override;

    /// File interface

    /// Close the stream cleanly
    ///
    /// After Close() is called, closed() returns true and the stream is not
    /// available for further operations.
    arrow::Status Close() override;

    /// Close the stream abruptly
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

    /// Read data from current file position.
    ///
    /// Read at most `nbytes` from the current file position into `out`.
    /// The number of bytes read is returned.
    arrow::Result<int64_t> Read(int64_t nbytes, void* out) override;

    /// Read data from current file position.
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

    /// Return zero-copy string_view to upcoming bytes.
    ///
    /// Do not modify the stream position. The view becomes invalid after
    /// any operation on the stream.  May trigger buffering if the requested
    /// size is larger than the number of buffered bytes.
    ///
    /// May return NotImplemented on streams that don't support it.
    ///
    /// \param[in] nbytes the maximum number of bytes to see
    arrow::Result<arrow::util::string_view> Peek(int64_t nbytes) override;

    /// Return true if InputStream is capable of zero copy Buffer reads
    ///
    /// Zero copy reads imply the use of Buffer-returning Read() overloads.
    ///
    /// XXX We could
    bool supports_zero_copy() const override { return false; }
};

}  // namespace io
}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_ARROW_STREAMS_H_
