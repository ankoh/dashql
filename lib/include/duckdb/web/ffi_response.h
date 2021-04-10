// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_
#define INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_

#include "arrow/io/buffered.h"
#include "arrow/io/interfaces.h"
#include "arrow/ipc/writer.h"

namespace duckdb {
namespace web {

struct FFIResponse {
    /// The status code
    uint64_t statusCode;
    /// The data ptr (if any)
    uint64_t dataPtr;
    /// The data size
    uint64_t dataSize;
} __attribute((packed));

class FFIResponseBuffer {
   protected:
    /// The status message
    std::string status_message_;
    /// The arrow buffer (if any)
    std::shared_ptr<arrow::Buffer> arrow_buffer_;

   public:
    /// Constructor
    FFIResponseBuffer();

    /// Clear the response buffer
    void Clear();
    /// Store the arrow status
    void Store(FFIResponse& response, arrow::Status status);
    /// Store the result buffer
    void Store(FFIResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result);

    /// Get the instance
    static FFIResponseBuffer& GetInstance();
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_
