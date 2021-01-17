#include "dashql/common/blob_stream.h"

#include <cstring>

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

}  // namespace dashql

extern "C" {

size_t dashql_pong();
size_t dashql_ping() { return dashql_pong(); }

size_t dashql_blob_stream_underflow(dashql::BlobID, char*, size_t);

#ifndef EMSCRIPTEN
size_t dashql_pong() { return 0; }
size_t dashql_blob_stream_underflow(dashql::BlobID, char*, size_t) { return 0; }
#endif
}
