// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_STREAMS_H_
#define INCLUDE_DASHQL_COMMON_STREAMS_H_

#include <iostream>
#include <memory>
#include <vector>

#include "dashql/common/pod_vector.h"
#include "duckdb/common/file_system.hpp"

namespace dashql {

using BlobID = size_t;

constexpr size_t BLOB_STREAMBUF_SIZE = 16 * 1024;
constexpr size_t BLOB_STREAMBUF_MIN_READ = 128;

class BlobStreamBufferBase : public std::streambuf {
   public:
    using UnderflowFunc = size_t (*)(BlobID, char*, size_t);
    using CachedBuffers = std::vector<PodVector<char>>;

   protected:
    /// The underflow function
    UnderflowFunc underflow_func_;
    /// The blob id
    BlobID blob_id_;
    /// Reached the blob end?
    bool reached_eof_;

    /// Is at EOF?
    inline bool IsEOF() const { return reached_eof_ && (egptr() == gptr()); }

   public:
    /// Constructor
    BlobStreamBufferBase(UnderflowFunc underflow, BlobID blob_id);

    /// Virtual function (to be read s-how-many-c) called by other member functions to get
    /// an estimate on the number of characters available in the associated input sequence.
    std::streamsize showmanyc() override;
    /// Retrieves characters from the controlled input sequence and stores them in the array pointed by s,
    /// until either n characters have been extracted or the end of the sequence is reached.
    std::streamsize xsgetn(char* out, std::streamsize capacity) override;
    /// Virtual function called by other member functions to get the current character
    /// in the controlled input sequence without changing the current position.
    ///
    /// Derived classes can override this behavior to modify the gptr and egptr internal pointers in such a way
    /// that more characters from the input sequence may be made accessible through the buffer.
    int_type underflow() override = 0;
};

class BlobStreamBuffer : public BlobStreamBufferBase {
   protected:
    /// The cached buffers (if any)
    CachedBuffers* cached_buffers_;
    /// The cache iterator
    size_t cache_iter_;
    /// The buffer
    PodVector<char> buffer_;

   public:
    /// Constructor
    BlobStreamBuffer(UnderflowFunc underflow, BlobID blob_id, CachedBuffers* cached_buffers = nullptr);

    /// Virtual function called by other member functions to get the current character
    /// in the controlled input sequence without changing the current position.
    /// Derived classes can override this behavior to modify the gptr and egptr internal pointers in such a way
    /// that more characters from the input sequence may be made accessible through the buffer.
    int_type underflow() override;
};

class CachingBlobStreamBuffer : public BlobStreamBufferBase {
   protected:
    /// The buffer
    CachedBuffers buffers_;

   public:
    /// Constructor
    CachingBlobStreamBuffer(UnderflowFunc underflow, BlobID blob_id, CachedBuffers&& cached_buffers = {});

    /// Rewind the caching blob stream
    void Rewind();

    /// Virtual function called by other member functions to get the current character
    /// in the controlled input sequence without changing the current position.
    /// Derived classes can override this behavior to modify the gptr and egptr internal pointers in such a way
    /// that more characters from the input sequence may be made accessible through the buffer.
    int_type underflow() override;
};

class FileSystemStreamBuffer : public std::streambuf {
   public:
    FileSystemStreamBuffer(duckdb::FileSystem& file_system, duckdb::FileHandle& file_handle)
        : file_system(file_system), file_handle(file_handle), pos(0) {}

   protected:
    FileSystemStreamBuffer* setbuf(char_type*, std::streamsize) override { return this; }

    pos_type seekoff(off_type off, std::ios_base::seekdir dir, std::ios_base::openmode) override {  //
        if (dir == std::ios_base::beg) {
            pos = off;
        } else if (dir == std::ios_base::end) {
            pos = file_system.GetFileSize(file_handle) - off;
        } else {
            pos += off;
        }

        file_system.Se(file_handle, pos);

        return pos;
    }

    pos_type seekpos(pos_type pos, std::ios_base::openmode dir) override {  //
        return {};
    }

    std::streamsize showmanyc() override {  //
        return {};
    }

    int_type underflow() override {  //
        return {};
    }

    int_type uflow() override {  //
        return {};
    }

    std::streamsize xsgetn(char_type* s, std::streamsize count) override {  //
        return {};
    }

   private:
    duckdb::FileSystem& file_system;
    duckdb::FileHandle& file_handle;
    pos_type pos;
};

}  // namespace dashql

extern "C" {

size_t duckdb_web_blob_stream_underflow(dashql::BlobID, char*, size_t);
}

#endif  // INCLUDE_DASHQL_COMMON_STREAMS_H_
