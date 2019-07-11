#include <cstdio>
#include "duckdb.hpp"
#include "common/vector_operations/vector_operations.hpp"
#include "flatbuffers/flatbuffers.h"
#include "tigon/proto/web_api_generated.h"
#include <optional>

namespace fb = flatbuffers;
using namespace tigon;

std::unique_ptr<duckdb::DuckDB> db;

namespace {

template<typename T>
fb::Offset<webapi::QueryResultColumn> writeQueryResultColumn(fb::FlatBufferBuilder& builder, duckdb::Vector& vec) {
    uint8_t* nullmask;
    uint8_t* data;
    auto e = builder.CreateUninitializedVector(vec.count, sizeof(T), &data);
    auto n = builder.CreateUninitializedVector(vec.count, sizeof(bool), &nullmask);
    duckdb::VectorOperations::Exec(
        vec.sel_vector, 0,
        [&](duckdb::index_t i, duckdb::index_t k) {
            reinterpret_cast<bool*>(data)[k] = vec.data[i];
            reinterpret_cast<T*>(nullmask)[k] = vec.nullmask[i];
        }, 0);
    webapi::QueryResultColumnBuilder c{builder};
    c.add_type_id(static_cast<webapi::RawTypeID>(vec.type));
    c.add_null_mask(n);
    c.add_data(e);
    return c.Finish();
}

}

extern "C" {

void run_query(char* text) {
    duckdb::Connection conn{*db};
    auto result = conn.Query(text);
    auto result_str = result->ToString();
    printf("%s\n", result_str.c_str());


}

uint8_t* tigon_db_query(char* text);


uint8_t* tigon_db_query(char* text) {
    // Create a new connection
    duckdb::Connection conn{*db};
    // Send the query to the existing database
    auto result = conn.SendQuery(text);

    // Query failed?
    if (!result->success) {
        return nullptr;
    }

    // Create the buffer builder
    fb::FlatBufferBuilder builder{1024};

    // Fetch result rows and immediately write them into a flatbuffer
    std::vector<fb::Offset<webapi::QueryResultChunk>> chunks;
    for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {

        // Write chunk columns
        std::vector<fb::Offset<webapi::QueryResultColumn>> chunkColumns;
        for (size_t v = 0; v < chunk->column_count; ++v) {
            auto& vec = chunk->GetVector(v);

            // Write column data
            fb::Offset<webapi::QueryResultColumn> col;
            switch (vec.type) {
                case duckdb::TypeId::INVALID:
                case duckdb::TypeId::VARBINARY:
                    // TODO
                    break;
                case duckdb::TypeId::BOOLEAN:
                    col = writeQueryResultColumn<bool>(builder, vec);
                    break;
                case duckdb::TypeId::TINYINT: {
                    col = writeQueryResultColumn<int16_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::SMALLINT: {
                    col = writeQueryResultColumn<int32_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::INTEGER: {
                    col = writeQueryResultColumn<int64_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::BIGINT: {
                    col = writeQueryResultColumn<int64_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::POINTER: {
                    col = writeQueryResultColumn<uint64_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::HASH: {
                    col = writeQueryResultColumn<uint64_t>(builder, vec);
                    break;
                }
                case duckdb::TypeId::FLOAT: {
                    col = writeQueryResultColumn<float>(builder, vec);
                    break;
                }
                case duckdb::TypeId::DOUBLE: {
                    col = writeQueryResultColumn<double>(builder, vec);
                    break;
                }
                case Type::VARCHAR:
                {
                    // TODO first sum string lengths
                    // then write in sequence
                    // OR special casing strings to get constant access?

                    std::vector<fb::Offset<fb::String>> colStrs;
                    colStrs.reserve(vector.count);
                    auto** data = reinterpret_cast<const char **>(vector.data);
                    for (size_t i = 0; i < vector.count; ++i) {
                        if (data[i] == nullptr) {
                            // TODO
                        }
                        colStrs.push_back(builder.CreateString(data[i]));
                    }
                    col = webapi::QueryResultColumnBuilder{builder};
                    break;
                }
            }
        }
    }

    // Write types
    {
        webapi::RawTypeID* writer;
        builder.CreateUninitializedVector<webapi::RawTypeID>(result->types.size(), &writer);
        for (size_t i = 0; i < result->types.size(); ++i) {
            writer[i] = static_cast<webapi::RawTypeID>(result->types[i]);
        }
    }

    // Write sql types
    {
        webapi::SQLType* writer;
        builder.CreateUninitializedVectorOfStructs<webapi::SQLType>(result->sql_types.size(), &writer);
        for (size_t i = 0; i < result->sql_types.size(); ++i) {
            writer[i] = webapi::SQLType{
                static_cast<webapi::SQLTypeID>(result->sql_types[i].id),
                result->sql_types[i].width,
                result->sql_types[i].scale
            };
        }
    }

    return nullptr;
}

}

int main() {
    db = std::make_unique<duckdb::DuckDB>(nullptr);
    printf("tigon core ready\n");
    return 0;
}

