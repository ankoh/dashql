// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_WEBDB_H_
#define INCLUDE_DASHQL_WEBDB_WEBDB_H_

#include <cstring>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <unordered_map>

#include "dashql/common/expected.h"
#include "dashql/common/ffi_response.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/partitioner.h"
#include "duckdb.hpp"

namespace dashql {
namespace webdb {

struct QueryRunOptions {
    /// Partition boundary keys
    std::vector<uint32_t> partition_boundaries = {};

    /// Constructor
    QueryRunOptions() = default;
    /// Set partition boundary columns
    QueryRunOptions& WithPartitionBoundaries(std::initializer_list<uint32_t> columns) {
        partition_boundaries = {columns};
        return *this;
    }
};

class WebDB {
   public:
    /// A connection
    class Connection {
       public:

       protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database_;
        /// The connection
        duckdb::Connection connection_;

        /// The current query id
        uint64_t current_query_id_;
        /// The current query result (if any)
        std::unique_ptr<duckdb::QueryResult> current_query_result_;
        /// The stream partitioniner (if any)
        std::unique_ptr<Partitioner> current_stream_partitioner_;

       public:
        /// Constructor
        Connection(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Connection() = default;

        /// Get a connection
        auto& GetConnection() { return connection_; }

        /// Run a SQL query
        ExpectedBuffer<proto::webdb::QueryResult> RunQuery(std::string_view text, const QueryRunOptions& args = {});
        /// Send a SQL query
        ExpectedBuffer<proto::webdb::QueryResult> SendQuery(std::string_view text, const QueryRunOptions& args = {});
        /// Fetch query results
        ExpectedBuffer<proto::webdb::QueryResultChunk> FetchQueryResults();
        /// Analyze a SQL query
        ExpectedBuffer<proto::webdb::QueryPlan> AnalyzeQuery(std::string_view text);
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

    /// Get the static webdb instance
    static WebDB& GetInstance();
};

}  // namespace webdb
}  // namespace dashql

#endif  // INCLUDE_DUCKDB_WEB_WEBDB_H_
