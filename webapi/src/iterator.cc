// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/iterator.h"

#include <random>
#include <tuple>
#include <unordered_map>
#include <variant>
#include <optional>
#include <stack>

namespace duckdb_webapi {

// Constructor
QueryResultForwardIterator::QueryResultForwardIterator(WebAPI::Connection& connection, proto::QueryResult& result)
    : connection(connection), result(result), globalRowIndex(0), chunkRowBegin(0), chunkID(0), chunkBuffer(), chunk(nullptr) {}

/// Advance the iterator
ExpectedSignal QueryResultForwardIterator::advance() {
    // Reached end?
    if (isEnd())
        return {};
    assert(!!chunk);

    // Get next chunk (if neccessary)
    if ((++globalRowIndex - chunkRowBegin) < chunk->row_count()) {
        ++chunkID;
        if (auto chunks = result.data_chunks(); chunks && chunkID < chunks->size()) {
            chunk = chunks->Get(chunkID);
        } else {
            auto result = connection.fetchQueryResults();
            if (!result.isOk())
                return result.getErr();
            chunk = &result.get();
            chunkBuffer = result.releaseBuffer();
        }
        chunkRowBegin = 0;
    }
    return {};
}

/// Is at end?
bool QueryResultForwardIterator::isEnd() const {
    return !chunk || (chunkRowBegin >= chunk->row_count());
}



} // namespace duckdb_webapi
