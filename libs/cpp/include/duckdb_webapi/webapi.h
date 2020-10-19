// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_WEBAPI_H_
#define INCLUDE_DUCKDB_WEBAPI_WEBAPI_H_

#include <stdexcept>
#include <string>
#include <cstring>
#include <unordered_map>

#include "duckdb.hpp"
#include "duckdb_webapi/common/expected.h"
#include "duckdb_webapi/common/span.h"
#include "duckdb_webapi/proto/api_generated.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/proto/tablegen_generated.h"
#include "duckdb_webapi/proto/vector_generated.h"

namespace duckdb_webapi {

/// The Web API context
class WebAPI {
   public:
    class Connection;
    class ContextData;

    /// The return type
    struct Response {
        /// The status code
        uint64_t statusCode;
        /// The data ptr (if any)
        uint64_t dataPtr;
        /// The data size
        uint64_t dataSize;
    } __attribute((packed));

    // An adopted buffer
    class AdoptedBuffer {
        /// The bytes
        nonstd::span<std::byte> bytes;

       public:
        // Constructor
        AdoptedBuffer(nonstd::span<std::byte> s) : bytes(s) {}
        // Destructor
        ~AdoptedBuffer() { delete bytes.data(); }
        // Move construction
        AdoptedBuffer(AdoptedBuffer&& other) : bytes(other.bytes) {}
        // Delete the copy constructor
        AdoptedBuffer(const AdoptedBuffer& other) = delete;
        // Move assignment
        AdoptedBuffer& operator=(AdoptedBuffer&& other) {
            delete bytes.data();
            bytes = std::move(other.bytes);
            return *this;
        }
        // Delete the copy assignment
        AdoptedBuffer& operator=(const AdoptedBuffer& other) = delete;
    };

    /// A context data manager
    class ContextData {
       protected:
        /// The detached flatbuffers owned by this session
        std::unordered_map<void*, flatbuffers::DetachedBuffer> detached_buffers_;
        /// The adopted buffers owned by this session
        std::unordered_map<void*, AdoptedBuffer> adopted_buffers_;

        /// The request status code
        proto::StatusCode request_status_;
        /// The request data (if any)
        std::pair<void*, size_t> request_data_;
        /// The request error (if any)
        std::optional<Error> request_error_;

        /// Clear the request
        void clearRequest();

       public:
        /// Constructor
        ContextData();

        /// Store the result
        template <typename T> void Respond(ExpectedBuffer<T>&& result, Response& response) {
            clearRequest();
            if (result) {
                request_status_ = proto::StatusCode::SUCCESS;
                request_data_ = RegisterBuffer(result.ReleaseBuffer());
                auto [d, n] = request_data_;
                response.dataPtr = reinterpret_cast<uintptr_t>(d);
                response.dataSize = n;
            } else {
                request_status_ = proto::StatusCode::ERROR;
                request_error_ = result.ReleaseError();
                auto m = request_error_->message();
                m = m == nullptr ? "" : m;
                response.dataPtr = reinterpret_cast<uintptr_t>(m);
                response.dataSize = strlen(m);
            }
            response.statusCode = static_cast<uint32_t>(request_status_);
        }
        /// Register a detached flatbuffer buffer
        std::pair<void*, size_t> RegisterBuffer(flatbuffers::DetachedBuffer buffer);
        /// Register a raw buffer
        std::pair<void*, size_t> RegisterBuffer(nonstd::span<std::byte> buffer);
        /// Release a buffer
        void ReleaseBuffer(void* buffer);
    };

    /// A connection
    class Connection {
        friend class Response;

       protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database_;
        /// The connection
        duckdb::Connection connection_;
        /// The context data
        std::unique_ptr<ContextData> context_data_;

        /// The current query id
        uint64_t current_query_id_;
        /// The current query result (if any)
        std::unique_ptr<duckdb::QueryResult> current_query_result_;

       public:
        /// Constructor
        Connection(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Connection() = default;

        /// Get the buffer manager
        auto& context_data() { return *context_data_; }

        /// Run a SQL query
        ExpectedBuffer<proto::QueryResult> RunQuery(std::string_view text);
        /// Send a SQL query
        ExpectedBuffer<proto::QueryResult> SendQuery(std::string_view text);
        /// Fetch query results
        ExpectedBuffer<proto::QueryResultChunk> FetchQueryResults();
        /// Analyze a SQL query
        ExpectedBuffer<proto::QueryPlan> AnalyzeQuery(std::string_view text);
        /// Format a query plan
        ExpectedBuffer<proto::FormattedText> FormatQueryPlan(void* query_plan);
        /// Generate a table
        ExpectedSignal GenerateTable(proto::TableSpecification& spec);
    };

   protected:
    /// The (shared) database
    std::shared_ptr<duckdb::DuckDB> database_;
    /// The connections
    std::unordered_map<Connection*, std::unique_ptr<Connection>> connections_;

   public:
    /// Constructor
    WebAPI();

    /// Create a connection
    Connection& Connect();
    /// End a connection
    void Disconnect(Connection* connection);
};

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_WEBAPI_H_
