#pragma once

#include <cstring>
#include <memory>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>

#include "arrow/buffer.h"
#include "arrow/result.h"
#include "arrow/status.h"
#include "duckdb.hpp"
#include "duckdb/web/arrow_insert_options.h"
#include "duckdb/web/arrow_stream_buffer.h"
#include "duckdb/web/config.h"
#include "duckdb/web/environment.h"

namespace duckdb {
// Forward declarations
class QueryResult;
class PendingQueryResult;
class PreparedStatement;
class SQLStatement;
class DataChunk;
class Vector;
struct ExpressionState;

namespace web {

struct UDFFunctionDeclaration;

struct DuckDBWasmResultsWrapper {
    // Additional ResponseStatuses to be >= 256, and mirrored to packages/duckdb-wasm/src/status.ts
    // Missing mapping result in a throw, but they should eventually align (it's fine if typescript side only has a
    // subset)
    enum ResponseStatus : uint32_t { ARROW_BUFFER = 0, MAX_ARROW_ERROR = 255, DUCKDB_WASM_RETRY = 256 };
    DuckDBWasmResultsWrapper(arrow::Result<std::shared_ptr<arrow::Buffer>> res,
                             ResponseStatus status = ResponseStatus::ARROW_BUFFER)
        : arrow_buffer(res), status(status) {}
    DuckDBWasmResultsWrapper(arrow::Status res, ResponseStatus status = ResponseStatus::ARROW_BUFFER)
        : arrow_buffer(res), status(status) {}
    DuckDBWasmResultsWrapper(ResponseStatus status = ResponseStatus::ARROW_BUFFER)
        : DuckDBWasmResultsWrapper(nullptr, status) {}
    arrow::Result<std::shared_ptr<arrow::Buffer>> arrow_buffer;
    ResponseStatus status;
};

class WebDB {
   public:
    /// A connection
    class Connection {
        friend WebDB;

       protected:
        /// The webdb
        WebDB& webdb_;
        /// The connection
        duckdb::Connection connection_;

        /// The statements extracted from the text passed to PendingQuery
        std::vector<duckdb::unique_ptr<duckdb::SQLStatement>> current_pending_statements_;
        /// The index of the currently-running statement (in the above list)
        size_t current_pending_statement_index_ = 0;
        /// The value of allow_stream_result passed to PendingQuery
        bool current_allow_stream_result_ = false;
        /// The current pending query result (if any)
        duckdb::unique_ptr<duckdb::PendingQueryResult> current_pending_query_result_ = nullptr;
        /// The current pending query was canceled
        bool current_pending_query_was_canceled_ = false;
        /// The current query result (if any)
        duckdb::unique_ptr<duckdb::QueryResult> current_query_result_ = nullptr;
        /// The current arrow schema (if any)
        std::shared_ptr<arrow::Schema> current_schema_ = nullptr;
        /// The current patched arrow schema (if any)
        std::shared_ptr<arrow::Schema> current_schema_patched_ = nullptr;

        /// The currently active prepared statements
        std::unordered_map<size_t, duckdb::unique_ptr<duckdb::PreparedStatement>> prepared_statements_ = {};
        /// The next prepared statement id
        size_t next_prepared_statement_id_ = 0;
        /// The current arrow ipc input stream
        std::optional<ArrowInsertOptions> arrow_insert_options_ = std::nullopt;
        /// The current arrow ipc input stream
        std::unique_ptr<BufferingArrowIPCStreamDecoder> arrow_ipc_stream_;

        // Setup streaming of a result set and return the schema as an Arrow Buffer
        arrow::Result<std::shared_ptr<arrow::Buffer>> StreamQueryResult(duckdb::unique_ptr<duckdb::QueryResult> result);
        // Execute a prepared statement by setting up all arguments and returning the query result
        arrow::Result<duckdb::unique_ptr<duckdb::QueryResult>> ExecutePreparedStatement(size_t statement_id,
                                                                                        std::string_view args_json);

       public:
        /// Constructor
        Connection(WebDB& webdb);
        /// Destructor
        ~Connection();

        /// Get a connection
        auto& connection() { return connection_; }

        /// Run a query and return the materialized query result
        arrow::Result<std::shared_ptr<arrow::Buffer>> RunQuery(std::string_view text);
        /// Execute a query as pending query and return the stream schema when finished
        arrow::Result<std::shared_ptr<arrow::Buffer>> PendingQuery(std::string_view text, bool allow_stream_result);
        /// Poll a pending query and return the schema when finished
        arrow::Result<std::shared_ptr<arrow::Buffer>> PollPendingQuery();
        /// Cancel a pending query
        bool CancelPendingQuery();
        /// Fetch a data chunk from a pending query
        DuckDBWasmResultsWrapper FetchQueryResults();

        /// Prepare a statement and return its identifier
        arrow::Result<size_t> CreatePreparedStatement(std::string_view text);
        /// Execute a prepared statement with the given parameters in stringifed json format and return full result
        arrow::Result<std::shared_ptr<arrow::Buffer>> RunPreparedStatement(size_t statement_id,
                                                                           std::string_view args_json);
        /// Execute a prepared statement with the given parameters in stringifed json format and stream result
        arrow::Result<std::shared_ptr<arrow::Buffer>> SendPreparedStatement(size_t statement_id,
                                                                            std::string_view args_json);
        /// Close a prepared statement by its identifier
        arrow::Status ClosePreparedStatement(size_t statement_id);

        /// Insert an arrow record batch from an IPC stream
        arrow::Status InsertArrowFromIPCStream(std::span<const uint8_t> stream, std::string_view options);
    };

   protected:
    /// The config
    std::shared_ptr<WebDBConfig> config_;
    /// The (shared) database
    duckdb::shared_ptr<duckdb::DuckDB> database_;
    /// The connections
    std::unordered_map<Connection*, duckdb::unique_ptr<Connection>> connections_;

   public:
    /// Constructor
    WebDB(WebTag);
    /// Constructor
    WebDB(NativeTag, duckdb::unique_ptr<duckdb::FileSystem> fs = duckdb::FileSystem::CreateLocal());
    /// Destructor
    ~WebDB();

    /// Get the database
    auto& database() { return *database_; }

    /// Get the version
    std::string_view GetVersion();

    /// Create a connection
    Connection* Connect();
    /// End a connection
    void Disconnect(Connection* connection);
    /// Reset the database
    arrow::Status Reset();
    /// Open a database
    arrow::Status Open(std::string_view args_json = "");

    /// Get the static webdb instance
    static arrow::Result<std::reference_wrapper<WebDB>> Get();
    /// Create the default webdb database
    static duckdb::unique_ptr<WebDB> Create();
};

}  // namespace web
}  // namespace duckdb
