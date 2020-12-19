// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_TEST_BLOB_STREAM_TESTS_H_
#define INCLUDE_DASHQL_PARSER_TEST_BLOB_STREAM_TESTS_H_

#include <vector>
#include <string>

namespace dashql {
namespace test {

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


}
}

#endif
