// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_
#define INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_

#include "arrow/io/buffered.h"
#include "arrow/io/interfaces.h"
#include "arrow/ipc/writer.h"

namespace duckdb {
namespace web {

struct WASMResponse {
    /// The status code
    double statusCode;
    /// The data ptr of value (if any)
    double dataOrValue;
    /// The data size
    double dataSize;
} __attribute((packed));

class WASMResponseBuffer {
   protected:
    /// The status message
    std::string status_message_;
    /// The string result buffer (if any)
    std::string result_str_;
    /// The arrow result buffer (if any)
    std::shared_ptr<arrow::Buffer> result_arrow_;

   public:
    /// Constructor
    WASMResponseBuffer();

    /// Clear the response buffer
    void Clear();
    /// Store the arrow status
    void Store(WASMResponse& response, arrow::Status status);
    /// Store the result buffer
    void Store(WASMResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result);
    /// Store the result string
    void Store(WASMResponse& response, arrow::Result<std::string> result);
    /// Store the result double
    void Store(WASMResponse& response, arrow::Result<double> result);

    /// Get the instance
    static WASMResponseBuffer& GetInstance();
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_FFI_RESPONSE_H_
