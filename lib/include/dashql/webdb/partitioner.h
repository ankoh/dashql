// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_PARTITIONER_H_
#define INCLUDE_DASHQL_WEBDB_PARTITIONER_H_

#include "dashql/common/span.h"
#include "duckdb/common/types/data_chunk.hpp"
#include "duckdb/main/query_result.hpp"

namespace dashql {
namespace webdb {

using PartitionBoundaries = std::vector<bool>;

/// We use a stream partitioner to efficiently track partition boundaries on sorted output.
///
/// It works as follows:
/// For N specified columns, we pairwise scan the individual column values and write N partition masks.
/// A partition mask contains a 0 whenever a value equals the predecessor and 1 if it doesnt.
/// We then bitwise AND all the partition masks and attach them to a query result chunk.
///
/// The client code can then just split the result based on the partition mask entries.
/// That allows us to implement grouped and stacked charts much more efficiently by splitting the row proxy vectors.
class Partitioner {
    /// The query result
    const duckdb::QueryResult& query_result_;
    /// The columns that should be partitioned
    const std::vector<size_t> partition_columns_;
    /// The last row of the previous chunk (if any)
    std::vector<duckdb::Value> previous_values_;

   public:
    /// Constructor
    Partitioner(const duckdb::QueryResult& result, nonstd::span<const uint32_t> columns);

    /// Consume the next query result chunk 
    void consumeChunk(duckdb::DataChunk& chunk, PartitionBoundaries& out);
};

}  // namespace webdb
}  // namespace dashql

#endif  // INCLUDE_DASHQL_WEBDB_PARTITIONER_H_
