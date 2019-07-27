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

    /// A buffer
    class Buffer {
        /// The detached flatbuffer
        flatbuffers::DetachedBuffer detachedBuffer;

      public:
        /// Constructor
        Buffer(flatbuffers::DetachedBuffer b) : detachedBuffer(std::move(b)) {}
        /// Get the data
        uint8_t *getData() { return detachedBuffer.data(); }
        /// Get the size
        uint32_t getSize() { return detachedBuffer.size(); }
    };

    /// A response
    class Response {
        friend class Session;

        protected:
        /// The session
        Session& session;

        /// The status code
        proto::StatusCode statusCode;
        /// The error message (if any)
        std::string errorMessage;
        /// The data (if any)
        Buffer* data;
        /// Leaked the data?
        bool dataLeaked;

        /// Reset the reponse
        void reset();
        /// Request succeeded
        void requestSucceeded(Buffer* data);
        /// Request failed
        void requestFailed(proto::StatusCode status, std::string error);

        public:
        /// Constructor
        Response(Session& session);
        /// Destructor
        ~Response();

        /// Get the status
        auto getStatus() const { return statusCode; }
        /// Get the error
        auto& getError() const { return errorMessage; }
        /// Get the data
        Buffer* getData() {
            dataLeaked = !!data;
            return data;
        }
    };

    /// A session
    class Session {
        protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database;

        /// The next query id
        uint64_t nextQueryID;
        /// The buffers linked to this session
        std::unordered_map<Buffer*, std::unique_ptr<Buffer>> buffers;
        /// The (last) response
        Response response;

        /// Allocate a query id
        uint64_t allocateQueryID() { return ++nextQueryID; }
        /// Register a buffer
        Buffer* registerBuffer(flatbuffers::DetachedBuffer buffer);

        public:
        /// Constructor
        Session(std::shared_ptr<duckdb::DuckDB> database);
        /// Destructor
        ~Session();

        /// Get the response status
        auto getResponseStatus() { return response.getStatus(); }
        /// Get the response error
        auto& getResponseErrorMessage() { return response.getError(); }
        /// Get the response data
        auto* getResponseData() { return response.getData(); }

        /// Release a buffer
        void releaseBuffer(Buffer* buffer);
        /// Run a query
        void query(std::string_view text);

        /// Extract parquet file
        void extractParquet(const uint8_t* buffer, uint32_t bufferSize);
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
