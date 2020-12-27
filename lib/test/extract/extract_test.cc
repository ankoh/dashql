// Copyright (c) 2020 The DashQL Authors

#include "dashql/extract/extract.h"

#include <sstream>

#include "gtest/gtest.h"

using namespace std;
using namespace dashql;
namespace sx = dashql::proto::syntax;

namespace {

struct Blob {
   protected:
    /// The global blobs
    static std::vector<Blob> registered_blobs_;
    /// The buffer
    std::string buffer;
    /// The offset
    size_t offset;

   public:
    /// Constructor
    Blob(std::string buffer) : buffer(move(buffer)), offset(0) {}

   public:
    /// Register a global blob
    static size_t Register(Blob&& blob);
    /// Blob stream underflow function
    static size_t StreamUnderflow(size_t blob_id, char* buffer, size_t buffer_cap);
};

/// The registered blobs
std::vector<Blob> Blob::registered_blobs_;
/// Register a new blob
size_t Blob::Register(Blob&& blob) {
    auto id = registered_blobs_.size();
    registered_blobs_.push_back(move(blob));
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

}  // namespace
