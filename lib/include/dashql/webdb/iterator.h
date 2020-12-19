// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_ITERATOR_H_
#define INCLUDE_DASHQL_WEBDB_ITERATOR_H_

#include "dashql/proto_generated.h"
#include "dashql/common/expected.h"
#include "dashql/webdb/webdb.h"

namespace dashql {
namespace webdb {

/// The query result forward iterator
struct QueryResultIterator {
   protected:
    /// The connection
    WebDB::Connection& connection;
    /// The query result
    const proto::webdb::QueryResult& result;
    /// The global row index
    uint64_t globalRowIndex;
    /// The chunk row begin
    uint64_t chunkRowBegin;
    /// The chunk identifier
    uint64_t chunkID;
    /// The chunk buffer (if any)
    flatbuffers::DetachedBuffer chunkBuffer;
    /// The chunk
    const proto::webdb::QueryResultChunk* chunk;

    /// Verify the result chunk
    bool Verify(const proto::webdb::QueryResultChunk& chunk) const;

   public:
    /// Constructor
    QueryResultIterator(WebDB::Connection& connection, const proto::webdb::QueryResult& result);

    /// Get the column types
    auto column_count() const { return result.column_types()->size(); }
    /// Get the column types
    auto& column_types() const { return *result.column_types(); }
    /// Get the column types
    auto& column_names() const { return *result.column_names(); }
    /// Get the chunk row
    auto chunk_row() const { return globalRowIndex - chunkRowBegin; }

    /// Is at end?
    bool IsEnd() const;
    /// Advance the iterator
    Signal Next();
    /// Iterator increment
    QueryResultIterator& operator++() {
        Next();
        return *this;
    }
    /// Get a value
    duckdb::Value GetValue(size_t col_idx) const;
};

}  // namespace webdb
}  // namespace dashql

#endif  // INCLUDE_DASHQL_WEBDB_ITERATOR_H_
