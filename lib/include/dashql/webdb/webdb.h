// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_WEBDB_H_
#define INCLUDE_DUCKDB_WEB_WEBDB_H_

#include <cstring>
#include <stdexcept>
#include <string>
#include <unordered_map>

#include "dashql/common/expected.h"
#include "dashql/common/ffi_response.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "duckdb.hpp"

namespace dashql {
namespace webdb {

/// The Web API context
class WebDB {
   public:
    /// A connection
    class Connection {
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

        /// Get a connection
        auto& GetConnection() { return connection_; }

        /// Run a SQL query
        ExpectedBuffer<proto::webdb::QueryResult> RunQuery(std::string_view text);
        /// Send a SQL query
        ExpectedBuffer<proto::webdb::QueryResult> SendQuery(std::string_view text);
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
