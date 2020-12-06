// Copyright (c) 2020 The DashQL Authors

#include "dashql/session.h"

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

/// A test helper that exposes the csv extraction function
class SessionProxy : public Session {
   public:
    /// Constructor
    SessionProxy() : Session() {}

    using Session::ExtractCSV;
};

class SessionTest : public ::testing::Test {
   protected:
    SessionProxy session;

    void SetUp() override {}
};

TEST_F(SessionTest, CSVExtractAutoDetect) {
//     std::string input = R"CSV(a,b,t,d,ts
// 123,TEST2,12:12:12,01-01-2000,01-01-90 12:12:00
// 345,TEST2,14:15:30,02-02-2002,02-02-02 14:15:00
// 346,TEST2,15:16:17,13-12-2004,13-12-04 15:16:00)CSV";
// 
//     auto blob_id = Blob::Register(input);
//     BlobIStreamBuffer blob_streambuf{Blob::StreamUnderflow, blob_id};
// 
//     duckdb::BufferedCSVReaderOptions csv_options;
//     csv_options.file_path = std::string{"blob:"} + std::to_string(blob_id);
//     csv_options.auto_detect = true;
// 
//     session.ExtractCSV(blob_streambuf, csv_options, {}, "", "test1");
}

}  // namespace
