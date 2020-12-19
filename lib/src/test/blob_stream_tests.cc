#include "dashql/test/blob_stream_tests.h"

#include <cassert>
#include <cstring>

namespace dashql {
namespace test {

/// The registered blobs
std::vector<Blob> Blob::registered_blobs_;
/// Register a new blob
size_t Blob::Register(Blob&& blob) {
    auto id = registered_blobs_.size();
    registered_blobs_.push_back(std::move(blob));
    return id;
}
/// The stream underflow handler
size_t Blob::StreamUnderflow(size_t blob_id, char* buffer, size_t buffer_cap) {
    assert(blob_id < registered_blobs_.size());
    auto& blob = registered_blobs_[blob_id];
    if (blob.offset >= blob.buffer.size()) {
        return 0;
    }
    auto n = std::min(blob.buffer.size() - blob.offset, buffer_cap);
    std::memcpy(buffer, blob.buffer.data() + blob.offset, n);
    blob.offset += n;
    if (blob.offset >= blob.buffer.size()) {
        blob.buffer.resize(0);
    }
    return n;
}

}  // namespace test
}  // namespace dashql
