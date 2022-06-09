#ifndef INCLUDE_DUCKDB_ARROWAPI_DATABASE_H_
#define INCLUDE_DUCKDB_ARROWAPI_DATABASE_H_

#include <cstring>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>

#include "arrow/api.h"
#include "duckdb.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/main/prepared_statement.hpp"
#include "duckdb/main/query_result.hpp"
#include "duckdb/parser/parser.hpp"

namespace duckdb {
namespace arrowapi {

class Database {
   public:
    /// A connection
    class Connection {
       protected:
        /// The webdb
        Database& webdb_;
        /// The connection
        duckdb::Connection connection_;

        /// The current result (if any)
        std::unique_ptr<duckdb::QueryResult> current_query_result_ = nullptr;
        /// The current arrow schema (if any)
        std::shared_ptr<arrow::Schema> current_schema_ = nullptr;
        /// The current patched arrow schema (if any)
        std::shared_ptr<arrow::Schema> current_schema_patched_ = nullptr;

        // Fully materialize a given result set and return it as an Arrow Buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> MaterializeQueryResult(
            std::unique_ptr<duckdb::QueryResult> result);
        // Setup streaming of a result set and return the schema as an Arrow Buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> StreamQueryResult(std::unique_ptr<duckdb::QueryResult> result);

       public:
        /// Constructor
        Connection(Database& webdb);
        /// Destructor
        ~Connection();

        /// Get a connection
        auto& connection() { return connection_; }
        /// Get the filesystem
        duckdb::FileSystem& filesystem();

        /// Run a query and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> RunQuery(std::string_view text);
        /// Send a query and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> SendQuery(std::string_view text);
        /// Fetch query results and return an arrow buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> FetchQueryResults();
        /// Get table names
        arrow::Result<std::string> GetTableNames(std::string_view text);
    };

   protected:
    /// The (shared) database
    std::shared_ptr<duckdb::DuckDB> database_;
    /// The connections
    std::unordered_map<Connection*, std::unique_ptr<Connection>> connections_;

   public:
    /// Constructor
    Database(std::shared_ptr<duckdb::DuckDB> db);
    /// Destructor
    ~Database();

    /// Get the version
    std::string_view GetVersion();
    /// Tokenize a script and return tokens as json
    std::string Tokenize(std::string_view text);
    /// Create a connection
    Connection* Connect();
    /// End a connection
    void Disconnect(Connection* connection);

    /// Get the static webdb instance
    static arrow::Result<std::reference_wrapper<Database>> Get();
    /// Create the default webdb database
    static std::unique_ptr<Database> Create();
};

}  // namespace arrowapi
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_ARROW_DATABASE_H_
