// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_WEBDB_H_
#define INCLUDE_DUCKDB_WEB_WEBDB_H_

#include <cstring>
#include <stdexcept>
#include <string>
#include <unordered_map>

#include "duckdb.hpp"
#include "duckdb/web/common/expected.h"
#include "duckdb/web/common/span.h"
#include "duckdb/web/proto/query_plan_generated.h"
#include "duckdb/web/proto/query_result_generated.h"
#include "duckdb/web/proto/tablegen_generated.h"
#include "duckdb/web/proto/vector_generated.h"

namespace duckdb {
namespace web {

/// The Web API context
class WebDB {
   public:
    class Connection;

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

    /// A connection
    class Connection {
        friend class Response;

       protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database_;
        /// The connection
        duckdb::Connection connection_;

        /// The current query id
        uint64_t current_query_id_;
        /// The current query result (if any)
        std::unique_ptr<duckdb::QueryResult> current_query_result_;

       public:
        /// Constructor
        Connection(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Connection() = default;

        /// Run a SQL query
        ExpectedBuffer<proto::QueryResult> RunQuery(std::string_view text);
        /// Send a SQL query
        ExpectedBuffer<proto::QueryResult> SendQuery(std::string_view text);
        /// Fetch query results
        ExpectedBuffer<proto::QueryResultChunk> FetchQueryResults();
        /// Analyze a SQL query
        ExpectedBuffer<proto::QueryPlan> AnalyzeQuery(std::string_view text);
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
    WebDB();

    /// Create a connection
    Connection* Connect();
    /// End a connection
    void Disconnect(Connection* connection);
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_WEBDB_H_
