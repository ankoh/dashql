//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_
#define INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"

#include "google/protobuf/message_lite.h"
#include "google/protobuf/arena.h"
#include "tigon/common/span.h"
#include "tigon/proto/duckdb.pb.h"
#include "tigon/proto/tql.pb.h"
#include "tigon/proto/web_api.pb.h"
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace tigon {

/// The Web API context
class WebAPI {
  protected:
    /// A buffer
    class Buffer {
        /// The data
        std::unique_ptr<std::byte[]> data;
        /// The size
        size_t size;
        
        public:
        // Constructor
        Buffer(std::unique_ptr<std::byte[]> data, size_t size)
            : data(std::move(data)), size(size)  {}
        // Move construction
        Buffer(Buffer&& other)
            : data(std::move(other.data)), size(other.size) {}
        // Move assignment
        Buffer& operator=(Buffer&& other) {
            data = std::move(other.data);
            size = std::move(other.size);
            return *this;
        }
        // Get as span
        auto asSpan() { return nonstd::span<std::byte>{data.get(), static_cast<long>(size)}; }
        // Is empty?
        auto isEmpty() { return data == nullptr || size == 0; }
    };

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
        tigon::proto::web_api::StatusCode status_code;
        /// The error (if any)
        std::string error;
        /// The data (if any)
        nonstd::span<std::byte> data;

        /// Request succeeded
        void requestSucceeded(nonstd::span<std::byte> data);
        /// Request failed
        void requestFailed(tigon::proto::web_api::StatusCode status, std::string error);

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
        /// Write packed response
        void writePacked(Packed& response);
    };

    /// A session
    class Session {
        friend class Response;

        protected:
        /// The database
        std::shared_ptr<duckdb::DuckDB> database;
        /// The detached flatbuffers owned by this session
        std::unordered_map<void*, Buffer> buffers;
        /// The (last) response
        Response response;
        /// The next query id
        uint64_t nextQueryID;

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

        /// Encode a message
        nonstd::span<std::byte> serializeMessage(google::protobuf::MessageLite& msg);
        /// Register a buffer
        nonstd::span<std::byte> registerBuffer(std::unique_ptr<std::byte[]> data, size_t data_size);
        /// Release a buffer
        void releaseBuffer(void* buffer);

        /// Parse TQL
        void parseTQL(std::string_view text);
        /// Run SQL query
        void runQuery(std::string_view text);
        /// Plan SQL query
        void planQuery(std::string_view text);
    };

    /// A grid element 
    struct GridElement {
        int32_t width;
        int32_t height;
        int32_t x;
        int32_t y;
    } __attribute((packed));

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

    /// Compute a grid layout
    static void computeGridLayout(nonstd::span<GridElement> elements);
};

} // namespace tigon

#endif // INCLUDE_TIGON_TOOLS_WEB_WEB_API_H_
