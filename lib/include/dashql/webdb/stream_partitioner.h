// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_STREAM_PARTITIONER_H_
#define INCLUDE_DASHQL_WEBDB_STREAM_PARTITIONER_H_

#include "duckdb.hpp"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/main/query_result.hpp"
#include "flatbuffers/flatbuffers.h"

namespace duckdb {
namespace web {

using PartitionMask = std::vector<bool>;

/// We use a stream partitioner to efficiently track partition boundaries on sorted output.
///
/// It works as follows:
/// For N specified columns, we pairwise scan the individual column values and write N partition masks.
/// A partition masks contains a 0 whenever a value equals the predecessor and 1 if it doesnt.
/// We then bitwise AND all the partition masks and attach them to a query result chunk.
///
/// The client code can then just split the result based on the partition mask entries.
/// That allows us to implement grouped and stacked charts much more efficiently by splitting the row proxy vectors.
class StreamPartitioner {
    /// The current query result
    const duckdb::QueryResult* query_result_;
    /// The columns that should be partitioned
    std::vector<size_t> partition_columns_;
    /// The last row of the previous chunk (if any)
    std::vector<duckdb::Value> last_chunk_row_;

    /// Constructor
    StreamPartitioner();

    /// Setup the partitioning of a query
    void partition(duckdb::QueryResult& result, std::vector<size_t> columns);
    /// Consume the next query result chunk 
    void consumeQueryResultChunk(duckdb::DataChunk& chunk, PartitionMask& out);
};

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DASHQL_WEBDB_STREAM_PARTITIONER_H_
