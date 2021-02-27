// Copyright (c) 2020 The DashQL Authors

#include "dashql/dataframe/dataframe.h"

#include "dashql/proto_generated.h"
#include "duckdb/common/types.hpp"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace dataframe {
Dataframe::Dataframe() {}

ExpectedBuffer<proto::webdb::QueryResult> Dataframe::Query(Dataframe::AlgebraTree algebra_tree) {
    try {
        auto builder = flatbuffers::FlatBufferBuilder(1024);

        auto names = std::vector<std::string>();
        auto types = std::vector<duckdb::LogicalType>();

        auto columnNames = builder.CreateVectorOfStrings(names);

        flatbuffers::Offset<flatbuffers::Vector<const proto::webdb::SQLType *>> columnTypes;
        {
            proto::webdb::SQLType *writer;
            columnTypes = builder.CreateUninitializedVectorOfStructs<proto::webdb::SQLType>(types.size(), &writer);
            for (size_t i = 0; i < types.size(); ++i) {
                auto type = types[i];
                writer[i] = proto::webdb::SQLType{
                    static_cast<proto::webdb::SQLTypeID>(type.id()),
                    type.width(),
                    type.scale(),
                };
            }
        }

        proto::webdb::QueryResultBuilder result_builder{builder};
        result_builder.add_column_names(columnNames);
        result_builder.add_column_types(columnTypes);
        auto result_offset = result_builder.Finish();

        builder.Finish(result_offset);
        return {builder.Release()};
    } catch (std::exception &e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

void Dataframe::Write() {}

void Dataframe::End() {}

ExpectedBuffer<proto::webdb::QueryResultChunk> Dataframe::Next() {
    auto builder = flatbuffers::FlatBufferBuilder(1024);

    auto size = 0;
    std::vector<flatbuffers::Offset<proto::webdb::Vector>> columns;
    auto column_offset = builder.CreateVector(columns);

    proto::webdb::QueryResultChunkBuilder chunk_builder{builder};
    chunk_builder.add_row_count(size);
    chunk_builder.add_columns(column_offset);
    auto chunk_offset = chunk_builder.Finish();

    builder.Finish(chunk_offset);
    return {builder.Release()};
}
}  // namespace dataframe
}  // namespace dashql
