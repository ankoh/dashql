// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_API_H_
#define INCLUDE_DUCKDB_WEBAPI_API_H_

#include "duckdb.hpp"

#include <stdexcept>
#include <string>
#include <unordered_map>
#include "duckdb_webapi/expected.h"
#include "duckdb_webapi/common/span.h"
#include "duckdb_webapi/proto/api_generated.h"
#include "duckdb_webapi/proto/query_plan_generated.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/proto/tablegen_generated.h"
#include "duckdb_webapi/proto/value_generated.h"

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
            /// The error string (if any)
            uint64_t error;
            /// The data ptr (if any)
            uint64_t data;
            /// The data size
            uint64_t dataSize;
        } __attribute((packed));

        // An adopted buffer
        class AdoptedBuffer {
            /// The bytes
            nonstd::span<std::byte> bytes;

            public:
            // Constructor
            AdoptedBuffer(nonstd::span<std::byte> s)
                : bytes(s) {}
            // Destructor
            ~AdoptedBuffer() { delete bytes.data(); }
            // Move construction
            AdoptedBuffer(AdoptedBuffer&& other)
                : bytes(other.bytes) {}
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
            std::unordered_map<void*, flatbuffers::DetachedBuffer> detachedBuffers;
            /// The adopted buffers owned by this session
            std::unordered_map<void*, AdoptedBuffer> adoptedBuffers;

            /// The request status code
            proto::StatusCode requestStatus;
            /// The request data (if any)
            std::pair<void*, size_t> requestData;
            /// The request error (if any)
            std::optional<Error> requestError;

            /// Clear the request
            void clearRequest();
            /// Write succeeded
            void requestSucceeded(flatbuffers::DetachedBuffer&& buffer);
            /// Write failed
            void requestFailed(Error&& error);

            public:
            /// Constructor
            ContextData();

            /// Store the result
            template<typename T>
            void respond(ExpectedBuffer<T>&& result, Response& response) {
                if (result)
                    requestSucceeded(result.releaseBuffer());
                else
                    requestFailed(result.releaseError());
                response.statusCode = static_cast<uint32_t>(requestStatus);
                response.error = !!requestError ? 0 : reinterpret_cast<uintptr_t>(requestError->getMessage());
                response.data = reinterpret_cast<uintptr_t>(std::get<0>(requestData));
                response.dataSize = std::get<1>(requestData);
            }
            /// Register a detached flatbuffer buffer
            std::pair<void*, size_t> registerBuffer(flatbuffers::DetachedBuffer buffer);
            /// Register a raw buffer
            std::pair<void*, size_t> registerBuffer(nonstd::span<std::byte> buffer);
            /// Release a buffer
            void releaseBuffer(void* buffer);
        };

        /// A connection
        class Connection {
            friend class Response;

            protected:
            /// The database
            std::shared_ptr<duckdb::DuckDB> database;
            /// The connection
            duckdb::Connection connection;
            /// The context data
            std::unique_ptr<ContextData> contextData;

            /// The current query id
            uint64_t currentQueryID;
            /// The current query result (if any)
            std::unique_ptr<duckdb::QueryResult> currentQueryResult;

            public:
            /// Constructor
            Connection(std::shared_ptr<duckdb::DuckDB> database);
            /// Destructor
            ~Connection();

            /// Get the buffer manager
            auto& getContext() { return *contextData; }

            /// Run a SQL query
            ExpectedBuffer<proto::QueryResult> runQuery(std::string_view text);
            /// Start a SQL query
            ExpectedBuffer<proto::QueryResult> sendQuery(std::string_view text);
            /// Fetch query results
            ExpectedBuffer<proto::QueryResultChunk> fetchQueryResults();
            /// Analyze a SQL query
            ExpectedBuffer<proto::QueryPlan> analyzeQuery(std::string_view text);
            /// Format a query plan
            ExpectedBuffer<proto::FormattedText> formatQueryPlan(void* query_plan);
            /// Generate a table
            ExpectedSignal generateTable(proto::TableSpecification& spec);
        };

    protected:
        /// The (shared) database
        std::shared_ptr<duckdb::DuckDB> database;
        /// The connections
        std::unordered_map<Connection*, std::unique_ptr<Connection>> connections;

    public:
        /// Constructor
        WebAPI();

        /// Create a connection
        Connection& connect();
        /// End a connection
        void disconnect(Connection* session);
    };

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_API_H_
