// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_IO_STREAMBUF_H_
#define INCLUDE_DUCKDB_WEB_IO_STREAMBUF_H_

#include <streambuf>

#include "duckdb/web/io/buffer_manager.h"

namespace duckdb {
namespace web {
namespace io {

class InputFileStreamBuffer : public std::streambuf {
   private:
    /// The buffer manager
    std::shared_ptr<BufferManager> buffer_manager_;
    /// The file
    BufferManager::FileRef file_;
    /// The buffer
    BufferManager::BufferRef buffer_;
    /// The next page id
    size_t next_page_id_;

   protected:
    /// Load next page
    bool NextPage();
    /// Get the position
    size_t GetPosition() {
        assert(next_page_id_ > 0);
        return ((next_page_id_ - 1) << buffer_manager_->GetPageSizeShift()) + (gptr() - eback());
    }
    /// Virtual function (to be read s-how-many-c) called by other member functions to get an estimate
    /// on the number of characters available in the associated input sequence.
    std::streamsize showmanyc() override { return file_.GetSize() - GetPosition(); }
    /// Retrieves characters from the controlled input sequence and stores them in the array pointed by s,
    /// until either n characters have been extracted or the end of the sequence is reached.
    std::streamsize xsgetn(char* out, std::streamsize n) override;
    /// Ensures that at least one character is available in the input area by updating the pointers to
    /// the input area (if needed) and reading more data in from the input sequence (if applicable).
    /// Returns the value of that character (converted to int_type with Traits::to_int_type(c)) on success or
    /// Traits::eof() on failure.
    int_type underflow() override {
        if (gptr() < egptr()) return sgetc();
        return NextPage() ? sgetc() : traits_type::eof();
    }
    /// Ensures that at least one character is available in the input area by updating the pointers to
    /// the input area (if needed). On success returns the value of that character and advances the value of
    /// the get pointer by one character. On failure returns traits::eof().
    int_type uflow() override {
        if (gptr() < egptr()) return sbumpc();
        return NextPage() ? sgetc() : traits_type::eof();
    }
    /// Set internal position pointer to relative position
    pos_type seekoff(off_type off, std::ios_base::seekdir dir, std::ios_base::openmode) override;
    /// Set internal position pointer to absolute position
    pos_type seekpos(pos_type pos, std::ios_base::openmode) override;

   public:
    /// Constructor
    InputFileStreamBuffer(std::shared_ptr<BufferManager> buffer_manager, std::string_view path)
        : buffer_manager_(std::move(buffer_manager)),
          file_(buffer_manager_->OpenFile(path)),
          buffer_(buffer_manager_->FixPage(file_, 0, false)),
          next_page_id_(1) {
        auto data = buffer_.GetData();
        setg(data.data(), data.data(), data.data() + data.size());
    }
};

}  // namespace io
}  // namespace web
}  // namespace duckdb

#endif