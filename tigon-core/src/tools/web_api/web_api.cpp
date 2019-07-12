#include <cstdio>
#include <optional>
#include <unordered_map>
#include "common/vector_operations/vector_operations.hpp"
#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/web_api_generated.h"

namespace fb = flatbuffers;
using namespace tigon;

namespace {

/// The Web API
class WebAPI {
   public:
    /// A buffer id
    using BufferID = uint32_t;

   protected:
    /// A buffer
    class Buffer {
        /// The detached flatbuffer
        fb::DetachedBuffer detachedBuffer;
    };

    /// The database
    duckdb::DuckDB database;
    /// The next query id
    uint64_t nextQueryID;
    /// The buffers
    std::unordered_map<BufferID, Buffer> buffers;

   public:
    /// Constructor
    WebAPI();

    /// Get a buffer
    uint8_t* getBuffer(BufferID buffer);
    /// Get a buffer size
    uint32_t getBufferSize(BufferID buffer);
    /// Release a buffer
    void releaseBuffer(BufferID buffer);

    /// Run a query
    BufferID runQuery(const char* text);

    /// The static instance
    static std::unique_ptr<WebAPI> Instance;
};

/// The instance
std::unique_ptr<WebAPI> WebAPI::Instance;

/// Constructor
WebAPI::WebAPI() : database(nullptr), nextQueryID(), buffers() {}

/// Write a fixed-length result column
template <typename T>
fb::Offset<webapi::QueryResultColumn> writeFixedLengthResultColumn(
    fb::FlatBufferBuilder& builder, duckdb::Vector& vec) {
    uint8_t* nullmask;
    uint8_t* data;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    auto d = builder.CreateUninitializedVector(vec.count, sizeof(T), &data);
    duckdb::VectorOperations::Exec(vec.sel_vector, 0,
                                   [&](duckdb::index_t i, duckdb::index_t k) {
                                       nullmask[k] = vec.nullmask[i];
                                       reinterpret_cast<T*>(data)[k] =
                                           vec.data[i];
                                   },
                                   0);
    webapi::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<webapi::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_fixed_length_data(d);
    return c.Finish();
}

/// Write a string result column
fb::Offset<webapi::QueryResultColumn> writeStringResultColumn(
    fb::FlatBufferBuilder& builder, duckdb::Vector& vec) {
    uint8_t* nullmask;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    builder.StartVector(vec.count, sizeof(fb::Offset<fb::String>));
    auto** source = reinterpret_cast<const char**>(vec.data);
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
WebAPI::BufferID WebAPI::runQuery(const char* text) {
    auto queryID = nextQueryID++;

    // Create a new connection
    duckdb::Connection conn{database};
    // Send the query to the existing database
    auto result = conn.SendQuery(text);

    // Query failed?
    if (!result->success) {
        return 0;
    }

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<webapi::QueryResultChunk>> chunks;
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0;
         chunk = result->Fetch()) {
        // Write chunk columns
        std::vector<fb::Offset<webapi::QueryResultColumn>> columns;
        for (size_t v = 0; v < chunk->column_count; ++v) {
            auto& vec = chunk->GetVector(v);

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
                    column =
                        writeFixedLengthResultColumn<int16_t>(builder, vec);
                    break;
                case duckdb::TypeId::SMALLINT:
                    column =
                        writeFixedLengthResultColumn<int32_t>(builder, vec);
                    break;
                case duckdb::TypeId::INTEGER:
                    column =
                        writeFixedLengthResultColumn<int64_t>(builder, vec);
                    break;
                case duckdb::TypeId::BIGINT:
                    column =
                        writeFixedLengthResultColumn<int64_t>(builder, vec);
                    break;
                case duckdb::TypeId::POINTER:
                    column =
                        writeFixedLengthResultColumn<uint64_t>(builder, vec);
                    break;
                case duckdb::TypeId::HASH:
                    column =
                        writeFixedLengthResultColumn<uint64_t>(builder, vec);
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
        uint8_t* writer;
        columnRawTypes = builder.CreateUninitializedVector<uint8_t>(
            result->types.size(), &writer);
        for (size_t i = 0; i < result->types.size(); ++i) {
            writer[i] = static_cast<uint8_t>(result->types[i]);
        }
    }

    // Write column sql types
    fb::Offset<fb::Vector<const webapi::SQLType*>> columnSQLTypes;
    {
        webapi::SQLType* writer;
        columnSQLTypes =
            builder.CreateUninitializedVectorOfStructs<webapi::SQLType>(
                result->sql_types.size(), &writer);
        for (size_t i = 0; i < result->sql_types.size(); ++i) {
            writer[i] = webapi::SQLType{
                static_cast<webapi::SQLTypeID>(result->sql_types[i].id),
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

    auto buffer = builder.Release();

    // Write names
    return 0;
}

}  // namespace

extern "C" {

/// Run a query
WebAPI::BufferID tigon_db_query(char* text) {
    return WebAPI::Instance->runQuery(text);
}

}

/// Initialize the web api
int main() {
    WebAPI::Instance = std::make_unique<WebAPI>();
    printf("tigon core ready\n");
    return 0;
}
