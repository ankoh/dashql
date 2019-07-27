//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"
#include "common/vector_operations/vector_operations.hpp"
#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/web_api_generated.h"
#include <cstdio>
#include <memory>
#include <optional>
#include <unordered_map>

namespace fb = flatbuffers;
using namespace tigon;

/// Reset the response
void WebAPI::Response::reset() {
    statusCode = proto::StatusCode::Success;
    errorMessage.clear();
    if (!!data & !dataLeaked) {
        session.releaseBuffer(data);
    }
    data = nullptr;
    dataLeaked = false;
}

/// Request succeeded
void WebAPI::Response::requestSucceeded(Buffer* d) {
    reset();
    statusCode = proto::StatusCode::Success;
    data = d;
}

void WebAPI::Response::requestFailed(proto::StatusCode status, std::string err) {
    reset();
    statusCode = status;
    errorMessage = move(err);
}

/// Constructor
WebAPI::Response::Response(WebAPI::Session &session)
    : session(session), statusCode(), errorMessage(), data(nullptr), dataLeaked(false) {}

/// Destructor
WebAPI::Response::~Response() { reset(); }

/// Constructor
WebAPI::Session::Session(std::shared_ptr<duckdb::DuckDB> database)
    : database(std::move(database)), nextQueryID(), buffers(), response(*this) {}

/// Destructor
WebAPI::Session::~Session() {}

/// Register a buffer
WebAPI::Buffer *WebAPI::Session::registerBuffer(flatbuffers::DetachedBuffer detached) {
    auto buffer = std::make_unique<WebAPI::Buffer>(std::move(detached));
    auto bufferPtr = buffer.get();
    buffers.insert({bufferPtr, move(buffer)});
    return bufferPtr;
}

/// Release a buffer
void WebAPI::Session::releaseBuffer(WebAPI::Buffer *buffer) { buffers.erase(buffer); }

/// Write a fixed-length result column
template <typename T>
static fb::Offset<proto::QueryResultColumn> writeFixedLengthResultColumn(fb::FlatBufferBuilder &builder,
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
    proto::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<proto::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_fixed_length_data(d);
    return c.Finish();
}

/// Write a string result column
static fb::Offset<proto::QueryResultColumn> writeStringResultColumn(fb::FlatBufferBuilder &builder,
                                                                    duckdb::Vector &vec) {
    uint8_t *nullmask;
    auto n = builder.CreateUninitializedVector(vec.count, &nullmask);
    builder.StartVector(vec.count, sizeof(fb::Offset<fb::String>));
    auto **source = reinterpret_cast<const char **>(vec.data);
    for (size_t i = 0; i < vec.count; ++i) {
        nullmask[i] = source[i] == nullptr;
        builder.PushElement(builder.CreateString(source[i]));
    }
    proto::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<proto::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_string_data({builder.EndVector(vec.count)});
    return c.Finish();
}

/// Run a query
void WebAPI::Session::query(std::string_view text) {
    auto queryID = allocateQueryID();

    // Create a new connection
    duckdb::Connection conn{*database};
    // Send the query to the existing database
    auto result = conn.SendQuery(std::string{text});

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Query failed?
    if (!result->success) {
        response.requestFailed(proto::StatusCode::GenericError, result->error);
        return;
    }

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<proto::QueryResultChunk>> chunks;
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
        // Write chunk columns
        std::vector<fb::Offset<proto::QueryResultColumn>> columns;
        for (size_t v = 0; v < chunk->column_count; ++v) {
            auto &vec = chunk->GetVector(v);

            // Write result column
            fb::Offset<proto::QueryResultColumn> column;
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
        proto::QueryResultChunkBuilder chunkBuilder{builder};
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
    fb::Offset<fb::Vector<const proto::SQLType *>> columnSQLTypes;
    {
        proto::SQLType *writer;
        columnSQLTypes = builder.CreateUninitializedVectorOfStructs<proto::SQLType>(result->sql_types.size(), &writer);
        for (size_t i = 0; i < result->sql_types.size(); ++i) {
            writer[i] = proto::SQLType{static_cast<proto::SQLTypeID>(result->sql_types[i].id),
                                       result->sql_types[i].width, result->sql_types[i].scale};
        }
    }

    // Write column names
    auto columnNames = builder.CreateVectorOfStrings(result->names);

    // Write the query result
    proto::QueryResultBuilder resultBuilder{builder};
    resultBuilder.add_query_id(queryID);
    resultBuilder.add_column_names(columnNames);
    resultBuilder.add_column_raw_types(columnRawTypes);
    resultBuilder.add_column_sql_types(columnSQLTypes);
    resultBuilder.add_data_chunks(dataChunks);
    auto queryResult = resultBuilder.Finish();

    // Finish the flatbuffer
    builder.Finish(queryResult);
    auto buffer = registerBuffer(builder.Release());

    // Mark as successfull
    response.requestSucceeded(buffer);
}

/// Constructor
WebAPI::WebAPI()
    : database(std::make_shared<duckdb::DuckDB>()), sessions() {}

/// Create a session
WebAPI::Session& WebAPI::createSession() {
    auto session = std::make_unique<WebAPI::Session>(database);
    auto sessionPtr = session.get();
    sessions.insert({sessionPtr, move(session)});
    return *sessionPtr;
}

/// End a session
void WebAPI::endSession(Session* session) {
    sessions.erase(session);
}
