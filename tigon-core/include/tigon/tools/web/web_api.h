//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_
#define INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_

#include "common/vector_operations/vector_operations.hpp"
#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/web_api_generated.h"
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace tigon {

/// The Web API context
class WebAPI {
  public:
    class Session;

    /// A response
    class Response {
        friend class Session;

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
        Session& session;

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
        Response(Session& session);
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

    /// A session
    class Session {
        friend class Response;

        protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database;
        /// The buffers linked to this session
        std::unordered_map<void*, flatbuffers::DetachedBuffer> buffers;
        /// The (last) response
        Response response;
        /// The next query id
        uint64_t nextQueryID;

        /// Register a buffer
        std::pair<void*, size_t> registerBuffer(flatbuffers::DetachedBuffer buffer);
        /// Allocate a query id
        uint64_t allocateQueryID() { return ++nextQueryID; }

        public:
        /// Constructor
        Session(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Session();

        /// Get the response
        auto& getResponse() { return response; }
        /// Write the response
        void writePackedResponse(Response::Packed& packed);
        /// Release a buffer
        void releaseBuffer(void* buffer);

        /// Parse TQL
        void parseTQL(std::string_view text);
        /// Run SQL query
        void runQuery(std::string_view text);
        /// Plan SQL query
        void planQuery(std::string_view text);
    };

  protected:
    /// The (shared) database
    std::shared_ptr<duckdb::DuckDB> database;
    /// The sessions
    std::unordered_map<Session*, std::unique_ptr<Session>> sessions;

  public:
    /// Constructor
    WebAPI();

    /// Create a session
    Session& createSession();
    /// End a session
    void endSession(Session* session);
};

} // namespace tigon

#endif // INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_
