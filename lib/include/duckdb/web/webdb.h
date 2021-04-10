// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_WEBDB_H_
#define INCLUDE_DUCKDB_WEB_WEBDB_H_

#include <cstring>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>

#include "arrow/io/buffered.h"
#include "arrow/io/interfaces.h"
#include "arrow/ipc/writer.h"
#include "dashql/common/ffi_response.h"
#include "dashql/proto_generated.h"
#include "duckdb.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/web/miniz_zipper.h"
#include "nonstd/span.h"

namespace duckdb {
namespace web {

class WebDB {
   public:
    /// A connection
    class Connection {
       protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database_;
        /// The connection
        duckdb::Connection connection_;

        /// The current result (if any)
        std::unique_ptr<duckdb::QueryResult> current_query_result_;
        /// The current arrow schema (if any)
        std::shared_ptr<arrow::Schema> current_schema_;

       public:
        /// Constructor
        Connection(std::shared_ptr<duckdb::DuckDB> database);

        /// Get a connection
        auto& GetConnection() { return connection_; }

        /// Get the filesystem attached to the database of this connection
        duckdb::FileSystem& GetFileSystem();
        /// Run a query and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> RunQuery(std::string_view text);
        /// Send a query and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> SendQuery(std::string_view text);
        /// Fetch query results and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> FetchQueryResults();
    };

   protected:
    /// The (shared) database
    std::shared_ptr<duckdb::DuckDB> database_;
    /// The connections
    std::unordered_map<Connection*, std::unique_ptr<Connection>> connections_;
    /// The database config
    duckdb::DBConfig db_config_;

    /// The zipper
    std::unique_ptr<Zipper> zip_;

   public:
    /// Constructor
    WebDB();

    /// Create a connection
    Connection* Connect();
    /// End a connection
    void Disconnect(Connection* connection);

    /// Get the filesystem attached to the database
    duckdb::FileSystem& GetFileSystem();
    /// Get the zipper
    auto& Zip() { return *zip_; }

    /// Get the static webdb instance
    static WebDB& GetInstance();
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_WEBDB_H_
