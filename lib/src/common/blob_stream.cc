#include "dashql/common/blob_stream.h"

#include <cstring>
#include <iostream>
#include <sstream>

namespace dashql {

BlobStreamBufferBase::BlobStreamBufferBase(BlobStreamBufferBase::UnderflowFunc underflow, BlobID blob_id)
    : underflow_func_(underflow), blob_id_(blob_id), reached_eof_() {}

std::streamsize BlobStreamBufferBase::showmanyc() {
    if (egptr() - gptr() == 0) {
        underflow();
    }
    return egptr() - gptr();
}

std::streamsize BlobStreamBufferBase::xsgetn(char* out, std::streamsize capacity) {
    std::streamsize copied = 0;
    while (copied < capacity) {
        auto available = egptr() - gptr();
        if (available) {
            auto remaining = static_cast<size_t>(capacity - copied);
            auto to_copy = std::min<size_t>(available, remaining);
            std::memcpy(out, gptr(), to_copy);
            out += to_copy;
            copied += to_copy;
            gbump(to_copy);
        }
        if (copied < capacity) {
            underflow();
            if (IsEOF()) break;
        }
    }
    return copied;
}

BlobStreamBuffer::BlobStreamBuffer(UnderflowFunc underflow, BlobID blob_id, CachedBuffers* cached_buffers)
    : BlobStreamBufferBase(underflow, blob_id), cached_buffers_(cached_buffers), cache_iter_(0), buffer_() {
    buffer_.reserve(BLOB_STREAMBUF_SIZE);
}

BlobStreamBufferBase::int_type BlobStreamBuffer::underflow() {
    if (gptr() < egptr()) return *gptr();
    if (reached_eof_) return traits_type::eof();

    // Hits the cache?
    if (cached_buffers_ && (cache_iter_++ < cached_buffers_->size())) {
        auto& buffer = cached_buffers_->at(cache_iter_);
        assert(!buffer.empty());
        setg(buffer.begin(), buffer.begin(), buffer.end());
        return *gptr();
    }

    // Fill buffer with new data
    auto n = underflow_func_(blob_id_, buffer_.begin(), buffer_.capacity());
    buffer_.resize_static(n);
    setg(buffer_.begin(), buffer_.begin(), buffer_.end());
    reached_eof_ = n == 0;
    return reached_eof_ ? traits_type::eof() : *gptr();
}

CachingBlobStreamBuffer::CachingBlobStreamBuffer(UnderflowFunc underflow, BlobID blob_id,
                                                 CachedBuffers&& cached_buffers)
    : BlobStreamBufferBase(underflow, blob_id), buffers_(move(cached_buffers)) {
    if (buffers_.empty()) {
        buffers_.emplace_back();
        buffers_.back().reserve(BLOB_STREAMBUF_SIZE);
    }
}

void CachingBlobStreamBuffer::Rewind() {
    assert(!buffers_.empty());
    auto& first = buffers_.front();
    setg(first.begin(), first.begin(), first.end());
}

BlobStreamBufferBase::int_type CachingBlobStreamBuffer::underflow() {
    if (gptr() < egptr()) return *gptr();
    if (reached_eof_) return traits_type::eof();

    // Space left in previous buffer?
    auto& last = buffers_.back();
    size_t n = 0;
    if ((last.size() + BLOB_STREAMBUF_MIN_READ) < last.capacity()) {
        // Load data into previous buffer
        n = underflow_func_(blob_id_, last.end(), last.capacity() - last.size());
        setg(last.end(), last.end(), last.end() + n);
        last.resize_static(last.size() + n);
    } else {
        // Load BLOB chunk into new buffer
        buffers_.emplace_back();
        auto& buffer = buffers_.back();
        buffer.resize(BLOB_STREAMBUF_SIZE);
        n = underflow_func_(blob_id_, buffer.begin(), buffer.capacity());
        buffer.resize_static(n);
        setg(buffer.begin(), buffer.begin(), buffer.end());
    }
    reached_eof_ = n == 0;
    return reached_eof_ ? traits_type::eof() : *gptr();
}

FileSystemStreamBuffer::FileSystemStreamBuffer(duckdb::FileSystem& file_system, duckdb::FileHandle& file_handle)
    : file_system_(file_system),
      file_handle_(file_handle),
      file_size_(file_system_.GetFileSize(file_handle_)),
      file_pos_(0) {
    buffer_.reserve(BLOB_STREAMBUF_SIZE);
}

std::streamsize FileSystemStreamBuffer::showmanyc() {
    if (egptr() - gptr() == 0) {
        underflow();
    }
    return egptr() - gptr();
}

FileSystemStreamBuffer::pos_type FileSystemStreamBuffer::seekoff(FileSystemStreamBuffer::off_type off,
                                                                 std::ios_base::seekdir dir, std::ios_base::openmode) {
    if (dir == std::ios_base::beg) {
        file_pos_ = off;
    } else if (dir == std::ios_base::end) {
        file_pos_ = file_size_ - off;
    } else {
        file_pos_ += off;
    }

    return file_pos_;
}

FileSystemStreamBuffer::pos_type FileSystemStreamBuffer::seekpos(FileSystemStreamBuffer::pos_type pos,
                                                                 std::ios_base::openmode) {
    file_pos_ = pos;
    return file_pos_;
}

FileSystemStreamBuffer::int_type FileSystemStreamBuffer::underflow() {
    if (gptr() < egptr()) return *gptr();
    if (file_pos_ >= file_size_) return std::streambuf::traits_type::eof();

    auto read = std::min(file_size_ - file_pos_, (int64_t)buffer_.capacity());
    buffer_.resize_static(read);
    file_system_.Read(file_handle_, buffer_.begin(), read, file_pos_);
    setg(buffer_.begin(), buffer_.begin(), buffer_.end());
    file_pos_ += read;
    return *gptr();
}

}  // namespace dashql

extern "C" {

size_t duckdb_web_pong();
size_t duckdb_web_ping() { return duckdb_web_pong(); }

extern size_t duckdb_web_blob_stream_underflow(dashql::BlobID, char*, size_t);

#ifndef EMSCRIPTEN
size_t duckdb_web_pong() { return 0; }
size_t duckdb_web_blob_stream_underflow(dashql::BlobID, char*, size_t) { return 0; }

#endif
}
