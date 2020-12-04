#include "dashql/common/blob_stream.h"

namespace dashql {

/// Constructor
BlobIStreamBuffer::BlobIStreamBuffer(BlobIStreamBuffer::UnderflowFunc underflow, BlobID blob_id)
    : underflow_func_(underflow), blob_id_(blob_id), blob_offset_(), blob_end_(), buffer_() {}

/// Virtual function (to be read s-how-many-c) called by other member functions to get
/// an estimate on the number of characters available in the associated input sequence.
std::streamsize BlobIStreamBuffer::showmanyc() {
    if (egptr() - gptr() == 0) {
        underflow();
    }
    return egptr() - gptr();
}

/// Retrieves characters from the controlled input sequence and stores them in the array pointed by s,
/// until either n characters have been extracted or the end of the sequence is reached.
std::streamsize BlobIStreamBuffer::xsgetn(char* out, std::streamsize capacity) {
    std::streamsize copied = 0;
    while (copied < capacity) {
        auto available = egptr() - gptr();
        if (available) {
            auto remaining = static_cast<size_t>(capacity - copied);
            auto to_copy = std::min<size_t>(available, remaining);
            memcpy(out, gptr(), to_copy);
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

/// Virtual function called by other member functions to get the current character
/// in the controlled input sequence without changing the current position.
BlobIStreamBuffer::int_type BlobIStreamBuffer::underflow() {
    if (gptr() < egptr()) {
        return *gptr();
    }
    if (blob_end_) {
        blob_offset_ += egptr() - eback();
        auto n = underflow_func_(blob_id_, buffer_.data(), buffer_.size());
        blob_end_ = n == 0;
        setg(buffer_.data(), buffer_.data(), buffer_.data() + n);
        return blob_end_ ? traits_type::eof() : *gptr();
    }
    return traits_type::eof();
}

}
