// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_WEBDB_H_
#define INCLUDE_DUCKDB_WEB_WEBDB_H_

#include <cstring>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>

#include "dashql/common/expected.h"
#include "dashql/common/ffi_response.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"
#include "duckdb.hpp"
#include "duckdb/web/partitioner.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {

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

        dashql::Signal ImportJSONColumnMajor(rapidjson::Document const& json, std::string schema, std::string table);
        dashql::Signal ImportJSONRowMajor(rapidjson::Document const& json, std::string schema, std::string table);

       public:
        /// Constructor
        Connection(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Connection() = default;

        /// Get a connection
        auto& GetConnection() { return connection_; }

        /// Get the filesystem attached to the database of this connection
        duckdb::FileSystem& GetFileSystem();
        /// Run a SQL query
        dashql::ExpectedBuffer<proto::QueryResult> RunQuery(std::string_view text, const QueryRunOptions& args = {});
        /// Send a SQL query
        dashql::ExpectedBuffer<proto::QueryResult> SendQuery(std::string_view text, const QueryRunOptions& args = {});
        /// Fetch query results
        dashql::ExpectedBuffer<proto::QueryResultChunk> FetchQueryResults();
        /// Analyze a SQL query
        dashql::ExpectedBuffer<proto::QueryPlan> AnalyzeQuery(std::string_view text);
        /// Import CSV from a file
        dashql::Signal ImportCSV(std::string filePath, std::string schema, std::string table);
        /// Import JSON string (object of columns or array of rows) into the given table
        dashql::Signal ImportJSON(std::string_view json, std::string schema, std::string table);
    };

   protected:
    /// The (shared) database
    std::shared_ptr<duckdb::DuckDB> database_;
    /// The connections
    std::unordered_map<Connection*, std::unique_ptr<Connection>> connections_;

    duckdb::DBConfig db_config_;

   public:
    /// Constructor
    WebDB();

    /// Create a connection
    Connection* Connect();
    /// End a connection
    void Disconnect(Connection* connection);

    /// Get the filesystem attached to the database
    duckdb::FileSystem& GetFileSystem();

    /// Get the static webdb instance
    static WebDB& GetInstance();
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_WEBDB_H_
