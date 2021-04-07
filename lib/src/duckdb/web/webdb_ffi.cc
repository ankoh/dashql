// Copyright (c) 2020 The DashQL Authors

#include <iostream>

#include "arrow/buffer.h"
#include "arrow/status.h"
#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/web/filesystem.h"
#include "duckdb/web/webdb.h"

using namespace duckdb::web;

namespace {

/// A packed response
struct FFIResponse {
    /// The status code
    uint64_t statusCode;
    /// The data ptr (if any)
    uint64_t dataPtr;
    /// The data size
    uint64_t dataSize;
} __attribute((packed));

/// A response buffer
class FFIResponseBuffer {
   protected:
    /// The status message
    std::string status_message_;
    /// The arrow buffer (if any)
    std::shared_ptr<arrow::Buffer> arrow_buffer_;

   public:
    /// Constructor
    FFIResponseBuffer() : status_message_(), arrow_buffer_() { Clear(); }

    /// Clear the response buffer
    void Clear() {
        status_message_.clear();
        arrow_buffer_.reset();
    }

    /// Store the detached flatbuffer
    void Store(FFIResponse& response, arrow::Status status) {
        Clear();
        response.statusCode = static_cast<uint64_t>(status.code());
        if (!status.ok()) {
            status_message_ = status.message();
            response.dataPtr = reinterpret_cast<uintptr_t>(status_message_.data());
            response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        }
    }

    /// Store the detached flatbuffer
    void Store(FFIResponse& response, arrow::Result<std::shared_ptr<arrow::Buffer>> result) {
        Clear();
        response.statusCode = static_cast<uint64_t>(result.status().code());
        if (result.ok()) {
            arrow_buffer_ = result.ValueUnsafe();
            response.dataPtr = reinterpret_cast<uintptr_t>(arrow_buffer_->data());
            response.dataSize = arrow_buffer_->size();
        } else {
            status_message_ = result.status().message();
            response.dataPtr = reinterpret_cast<uintptr_t>(status_message_.data());
            response.dataSize = reinterpret_cast<uintptr_t>(status_message_.size());
        }
    }

    /// Get the instance
    static FFIResponseBuffer& GetInstance();
};

FFIResponseBuffer& FFIResponseBuffer::GetInstance() {
    static FFIResponseBuffer instance;
    return instance;
}

}  // namespace

extern "C" {

using ConnectionHdl = uintptr_t;
using BufferHdl = uintptr_t;

/// Create a conn
ConnectionHdl duckdb_web_connect() { return reinterpret_cast<ConnectionHdl>(WebDB::GetInstance().Connect()); }
/// End a conn
void duckdb_web_disconnect(ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    WebDB::GetInstance().Disconnect(c);
}

/// Access a buffer
void* duckdb_web_access_buffer(ConnectionHdl /*connHdl*/, BufferHdl bufferHdl) {
    return reinterpret_cast<void*>(bufferHdl);
}

/// Run a query
void duckdb_web_run_query(FFIResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->RunQuery(script);
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Send a query
void duckdb_web_send_query(FFIResponse* packed, ConnectionHdl connHdl, const char* script) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->SendQuery(script);
    FFIResponseBuffer::GetInstance().Store(*packed, r.status());
}

/// Fetch query results
void duckdb_web_fetch_query_results(FFIResponse* packed, ConnectionHdl connHdl) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    auto r = c->FetchQueryResults();
    FFIResponseBuffer::GetInstance().Store(*packed, std::move(r));
}

/// Import CSV from a file
void duckdb_web_import_csv(dashql::FFIResponse* packed, ConnectionHdl connHdl, const char* filePath,
                           const char* schemaName, const char* tableName) {
    auto c = reinterpret_cast<WebDB::Connection*>(connHdl);
    using LT = duckdb::LogicalType;

    std::vector<duckdb::LogicalType> column_types{LT::INTEGER, LT::INTEGER, LT::INTEGER};
    duckdb::DataChunk output_chunk;
    output_chunk.Initialize(column_types);

    duckdb::BufferedCSVReaderOptions options;
    options.num_cols = 3;
    auto& fs = WebDB::GetInstance().GetFileSystem();
    auto handle = fs.OpenFile(filePath, duckdb::FileFlags::FILE_FLAGS_READ);
    duckdb::web::FileSystemStreamBuffer streambuf(fs, *handle);
    try {
        duckdb::BufferedCSVReader reader(options, column_types, std::make_unique<std::istream>(&streambuf));
        reader.ParseCSV(output_chunk);
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Signal::OK());
    } catch (const std::exception& e) {
        dashql::FFIResponseBuffer::GetInstance().Store(*packed, dashql::Error(dashql::ErrorCode::CSV_PARSER_ERROR)
                                                                    << e.what());
    }
}
}
