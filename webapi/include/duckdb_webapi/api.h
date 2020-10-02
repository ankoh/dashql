// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_API_H_
#define INCLUDE_DUCKDB_WEBAPI_API_H_

#include "duckdb.hpp"

#include <stdexcept>
#include <string>
#include <unordered_map>
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

        /// A response
        class Response {
            friend class Connection;

            public:
            /// The return type
            struct Packed {
                /// The status code
                uint64_t status_code;
                /// The error string (if any)
                uint64_t error;
                /// The data ptr (if any)
                uint64_t data;
                /// The data size
                uint64_t data_size;
            } __attribute((packed));

            protected:
            /// The session
            Connection& session;

            /// The status code
            proto::StatusCode status_code;
            /// The error (if any)
            std::string error;
            /// The data (if any)
            std::pair<void*, size_t> data;

            /// Request succeeded
            void requestSucceeded(flatbuffers::DetachedBuffer buffer);
            /// Request failed
            void requestFailed(proto::StatusCode status, std::string error);

            public:
            /// Constructor
            Response(Connection& session);
            /// Destructor
            ~Response();

            /// Get the status code
            auto getStatus() { return status_code; }
            /// Get the error (if any)
            auto& getError() { return error; }
            /// Get the data (if any)
            auto& getData() { return data; }

            /// Clear the response
            void clear();
            /// Write packed
            void writePacked(Packed& buffer);
        };

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

        /// A session
        class Connection {
            friend class Response;

            protected:
            /// The database
            std::shared_ptr<duckdb::DuckDB> database;
            /// The connection
            duckdb::Connection connection;
            /// The detached flatbuffers owned by this session
            std::unordered_map<void*, flatbuffers::DetachedBuffer> detachedBuffers;
            /// The adopted buffers owned by this session
            std::unordered_map<void*, AdoptedBuffer> adoptedBuffers;
            /// The (last) response
            Response response;
            /// The current query id
            uint64_t currentQueryID;
            /// The current query result (if any)
            std::unique_ptr<duckdb::QueryResult> currentQueryResult;

            /// Allocate a query id
            uint64_t allocateQueryID() { return ++currentQueryID; }

            public:
            /// Constructor
            Connection(std::shared_ptr<duckdb::DuckDB> database);
            /// Destructor
            ~Connection();

            /// Get the response
            auto& getResponse() { return response; }
            /// Write the response
            void writePackedResponse(Response::Packed& packed);
            /// Register a detached flatbuffer buffer
            std::pair<void*, size_t> registerBuffer(flatbuffers::DetachedBuffer buffer);
            /// Register a raw buffer
            std::pair<void*, size_t> registerBuffer(nonstd::span<std::byte> buffer);
            /// Release a buffer
            void releaseBuffer(void* buffer);

            /// Run a SQL query
            void runQuery(std::string_view text);
            /// Start a SQL query
            void sendQuery(std::string_view text);
            /// Fetch query results
            void fetchQueryResults();
            /// Analyze a SQL query
            void analyzeQuery(std::string_view text);
            /// Format a query plan
            void formatQueryPlan(void* query_plan);
            /// Generate a table
            void generateTable(proto::TableSpec& spec);
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

} // namespace tigon

#endif // INCLUDE_DUCKDB_WEBAPI_API_H_
