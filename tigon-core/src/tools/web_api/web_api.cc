//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "common/vector_operations/vector_operations.hpp"
#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/web_api_generated.h"
#include <cstdio>
#include <optional>
#include <unordered_map>

namespace fb = flatbuffers;
using namespace tigon;

namespace {

/// The Web API
class WebAPI {
  public:
    /// A buffer id
    using BufferID = uint32_t;
    /// A query id
    using QueryID = uint32_t;

    /// An invalid query id
    static constexpr BufferID INVALID_BUFFER_ID = 0;
    /// An invalid query id
    static constexpr QueryID INVALID_QUERY_ID = 0;

  protected:
    /// A buffer
    class Buffer {
        /// The detached flatbuffer
        fb::DetachedBuffer detachedBuffer;

      public:
        /// Constructor
        Buffer(fb::DetachedBuffer b) : detachedBuffer(std::move(b)) {}

        /// Get the data
        uint8_t *getData() { return detachedBuffer.data(); }

        /// Get the size
        uint32_t getSize() { return detachedBuffer.size(); }
    };

    /// The database
    duckdb::DuckDB database;
    /// The next query id
    uint32_t nextQueryID;
    /// The next buffer id
    uint32_t nextBufferID;
    /// The buffers
    std::unordered_map<BufferID, Buffer> buffers;

    /// Allocate a query id
    uint32_t allocateQueryID() {
        auto id = nextQueryID++;
        nextQueryID = !nextQueryID ? 1 : nextQueryID;
        return id;
    }

    /// Allocate a buffer id
    uint32_t allocateBufferID() {
        auto id = nextBufferID++;
        nextBufferID = !nextBufferID ? 1 : nextBufferID;
        return id;
    }

    /// Register a buffer
    BufferID registerBuffer(flatbuffers::DetachedBuffer buffer);

  public:
    /// Constructor
    WebAPI();

    /// Get a buffer
    uint8_t *getBuffer(BufferID buffer);
    /// Get a buffer size
    uint32_t getBufferSize(BufferID buffer);
    /// Release a buffer
    void releaseBuffer(BufferID buffer);

    /// Run a query
    BufferID runQuery(const char *text);

    /// The static instance
    static std::unique_ptr<WebAPI> Instance;
};

/// The instance
std::unique_ptr<WebAPI> WebAPI::Instance;

/// Register a buffer
WebAPI::BufferID WebAPI::registerBuffer(flatbuffers::DetachedBuffer buffer) {
    auto id = allocateBufferID();
    buffers.insert({id, Buffer{std::move(buffer)}});
    return id;
}

/// Constructor
WebAPI::WebAPI() : database(nullptr), nextQueryID(1), nextBufferID(1), buffers() {}

/// Get a buffer
uint8_t *WebAPI::getBuffer(WebAPI::BufferID id) {
    auto iter = buffers.find(id);
    return iter == buffers.end() ? nullptr : iter->second.getData();
}

/// Get the size of a buffer
uint32_t WebAPI::getBufferSize(WebAPI::BufferID id) {
    auto iter = buffers.find(id);
    return iter == buffers.end() ? 0 : iter->second.getSize();
}

/// Release a buffer
void WebAPI::releaseBuffer(WebAPI::BufferID id) { buffers.erase(id); }

/// Write a fixed-length result column
template <typename T>
fb::Offset<webapi::QueryResultColumn> writeFixedLengthResultColumn(fb::FlatBufferBuilder &builder,
                                                                   duckdb::Vector &vec) {
    uint8_t *nullmask;
    uint8_t *data;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    auto d = builder.CreateUninitializedVector(vec.count, sizeof(T), &data);
    duckdb::VectorOperations::Exec(vec.sel_vector, 0,
                                   [&](duckdb::index_t i, duckdb::index_t k) {
                                       nullmask[k] = vec.nullmask[i];
                                       reinterpret_cast<T *>(data)[k] = vec.data[i];
                                   },
                                   0);
    webapi::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<webapi::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_fixed_length_data(d);
    return c.Finish();
}

/// Write a string result column
fb::Offset<webapi::QueryResultColumn> writeStringResultColumn(fb::FlatBufferBuilder &builder, duckdb::Vector &vec) {
    uint8_t *nullmask;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    builder.StartVector(vec.count, sizeof(fb::Offset<fb::String>));
    auto **source = reinterpret_cast<const char **>(vec.data);
    for (size_t i = 0; i < vec.count; ++i) {
        nullmask[i] = source[i] == nullptr;
        builder.PushElement(builder.CreateString(source[i]));
    }
    webapi::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<webapi::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_string_data({builder.EndVector(vec.count)});
    return c.Finish();
}

/// Run a query
WebAPI::BufferID WebAPI::runQuery(const char *text) {
    auto queryID = allocateQueryID();

    // Create a new connection
    duckdb::Connection conn{database};
    // Send the query to the existing database
    auto result = conn.SendQuery(text);

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Query failed?
    if (!result->success) {
        // Write the error
        auto message = builder.CreateString(result->error);
        webapi::ErrorBuilder errorBuilder{builder};
        errorBuilder.add_message(message);
        errorBuilder.add_code(webapi::ErrorCode::Raw);
        auto error = errorBuilder.Finish();

        // Write the result
        webapi::QueryResultBuilder resultBuilder{builder};
        resultBuilder.add_error(error);
        auto queryResult = resultBuilder.Finish();

        // Finish the flatbuffer
        builder.Finish(queryResult);
        return registerBuffer(builder.Release());
    }

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<webapi::QueryResultChunk>> chunks;
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
        // Write chunk columns
        std::vector<fb::Offset<webapi::QueryResultColumn>> columns;
        for (size_t v = 0; v < chunk->column_count; ++v) {
            auto &vec = chunk->GetVector(v);

            // Write result column
            fb::Offset<webapi::QueryResultColumn> column;
            switch (vec.type) {
            case duckdb::TypeId::INVALID:
            case duckdb::TypeId::VARBINARY:
                // TODO
                break;
            case duckdb::TypeId::BOOLEAN:
                column = writeFixedLengthResultColumn<bool>(builder, vec);
                break;
            case duckdb::TypeId::TINYINT:
                column = writeFixedLengthResultColumn<int16_t>(builder, vec);
                break;
            case duckdb::TypeId::SMALLINT:
                column = writeFixedLengthResultColumn<int32_t>(builder, vec);
                break;
            case duckdb::TypeId::INTEGER:
                column = writeFixedLengthResultColumn<int64_t>(builder, vec);
                break;
            case duckdb::TypeId::BIGINT:
                column = writeFixedLengthResultColumn<int64_t>(builder, vec);
                break;
            case duckdb::TypeId::POINTER:
                column = writeFixedLengthResultColumn<uint64_t>(builder, vec);
                break;
            case duckdb::TypeId::HASH:
                column = writeFixedLengthResultColumn<uint64_t>(builder, vec);
                break;
            case duckdb::TypeId::FLOAT:
                column = writeFixedLengthResultColumn<float>(builder, vec);
                break;
            case duckdb::TypeId::DOUBLE:
                column = writeFixedLengthResultColumn<double>(builder, vec);
                break;
            case duckdb::TypeId::VARCHAR:
                column = writeStringResultColumn(builder, vec);
                break;
            }

            // Push new chunk column
            columns.push_back(column);
        }
        auto columnOffset = builder.CreateVector(columns);

        // Build result chunk
        webapi::QueryResultChunkBuilder chunkBuilder{builder};
        chunkBuilder.add_columns(columnOffset);
        chunks.push_back(chunkBuilder.Finish());
    }
    auto dataChunks = builder.CreateVector(chunks);

    // Write column types
    fb::Offset<fb::Vector<uint8_t>> columnRawTypes;
    {
        uint8_t *writer;
        columnRawTypes = builder.CreateUninitializedVector<uint8_t>(result->types.size(), &writer);
        for (size_t i = 0; i < result->types.size(); ++i) {
            writer[i] = static_cast<uint8_t>(result->types[i]);
        }
    }

    // Write column sql types
    fb::Offset<fb::Vector<const webapi::SQLType *>> columnSQLTypes;
    {
        webapi::SQLType *writer;
        columnSQLTypes = builder.CreateUninitializedVectorOfStructs<webapi::SQLType>(result->sql_types.size(), &writer);
        for (size_t i = 0; i < result->sql_types.size(); ++i) {
            writer[i] = webapi::SQLType{static_cast<webapi::SQLTypeID>(result->sql_types[i].id),
                                        result->sql_types[i].width, result->sql_types[i].scale};
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result->names);

    // Write the query result
    webapi::QueryResultBuilder resultBuilder{builder};
    resultBuilder.add_query_id(queryID);
    resultBuilder.add_column_names(columnNames);
    resultBuilder.add_column_raw_types(columnRawTypes);
    resultBuilder.add_column_sql_types(columnSQLTypes);
    resultBuilder.add_data_chunks(dataChunks);
    auto queryResult = resultBuilder.Finish();

    // Finish the flatbuffer
    builder.Finish(queryResult);
    return registerBuffer(builder.Release());
}

} // namespace

extern "C" {

/// Get a buffer
uint8_t *tigon_get_buffer(WebAPI::BufferID id) { return WebAPI::Instance->getBuffer(id); }

/// Get a buffer size
uint32_t tigon_get_buffer_size(WebAPI::BufferID id) { return WebAPI::Instance->getBufferSize(id); }

/// Release a buffer
void tigon_release_buffer(WebAPI::BufferID id) { WebAPI::Instance->releaseBuffer(id); }

/// Run a query
WebAPI::BufferID tigon_run_query(char *text) { return WebAPI::Instance->runQuery(text); }
}

/// Initialize the web api
int main() {
    WebAPI::Instance = std::make_unique<WebAPI>();
    printf("tigon core ready\n");
    return 0;
}
