// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_ITERATOR_H_
#define INCLUDE_DUCKDB_WEBAPI_ITERATOR_H_

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/common/expected.h"
#include "duckdb_webapi/proto/query_result_generated.h"

namespace duckdb_webapi {

/// The query result forward iterator
struct QueryResultForwardIterator {
    /// The connection
    WebAPI::Connection& connection;
    /// The query result
    proto::QueryResult& result;
    /// The global row index
    uint64_t globalRowIndex;
    /// The chunk row begin
    uint64_t chunkRowBegin;
    /// The chunk identifier
    uint64_t chunkID;
    /// The chunk buffer (if any)
    flatbuffers::DetachedBuffer chunkBuffer;
    /// The chunk
    const proto::QueryResultChunk* chunk;

    /// Constructor
    QueryResultForwardIterator(WebAPI::Connection& connection, proto::QueryResult& result);

    /// Is at end?
    bool isEnd() const;
    /// Advance the iterator
    ExpectedSignal advance();
    /// Iterator increment
    QueryResultForwardIterator& operator++() {
        advance();
        return *this;
    }
};


} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_ITERATOR_H_
