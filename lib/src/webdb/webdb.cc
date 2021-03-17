// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/webdb.h"

#include <cstdio>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

#include "dashql/proto_generated.h"
#include "dashql/webdb/codec.h"
#include "dashql/webdb/filesystem.h"
#include "dashql/webdb/partitioner.h"
#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"
#include "flatbuffers/flatbuffers.h"
#include "parquet-extension.hpp"
#include "spdlog/spdlog.h"

namespace fb = flatbuffers;
namespace p = dashql::proto::webdb;

namespace dashql {
namespace webdb {

/// Get the static webdb instance
WebDB& WebDB::GetInstance() {
    static std::unique_ptr<WebDB> db = nullptr;
    if (db == nullptr) {
        db = std::make_unique<WebDB>();
    }
    return *db;
}

/// Constructor
WebDB::Connection::Connection(std::shared_ptr<duckdb::DuckDB> db)
    : database_(std::move(db)),
      connection_(*database_),
      current_query_id_(),
      current_query_result_(),
      current_stream_partitioner_() {}

/// Run a SQL query
ExpectedBuffer<p::QueryResult> WebDB::Connection::RunQuery(std::string_view text, const QueryRunOptions& options) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_.reset();
        current_stream_partitioner_.reset();
        auto query_id = ++current_query_id_;

        // Create stream partitioner (if necessary)
        std::optional<Partitioner> partitioner = std::nullopt;
        if (!options.partition_boundaries.empty()) {
            partitioner.emplace(Partitioner{*result, options.partition_boundaries});
        }
        PartitionBoundaries partitionBoundaries;

        // Encode result chunks
        fb::FlatBufferBuilder builder{1024};
        std::vector<flatbuffers::Offset<proto::webdb::QueryResultChunk>> chunks;
        for (auto chunk = result->Fetch(); !!chunk && chunk->size() > 0; chunk = result->Fetch()) {
            // Pass chunk to stream partitioner
            if (partitioner) {
                if (partitionBoundaries.size() < chunk->size()) {
                    partitionBoundaries.resize(chunk->size(), 0);
                }
                std::fill(partitionBoundaries.begin(), partitionBoundaries.begin() + chunk->size(), 0);
                partitioner->consumeChunk(*chunk, partitionBoundaries);
            }

            // Write flatbuffer
            auto chunk_ofs = WriteQueryResultChunk(builder, *result, query_id, chunk.get(), partitionBoundaries);
            chunks.push_back(chunk_ofs);
        }
        auto chunkVec = builder.CreateVector(std::move(chunks));

        // Write the result buffer
        auto query_result_ofs = WriteQueryResult(builder, *result, query_id, chunkVec);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Start a SQL query
ExpectedBuffer<p::QueryResult> WebDB::Connection::SendQuery(std::string_view text, const QueryRunOptions& options) {
    try {
        // Send the query
        auto result = connection_.SendQuery(std::string{text});
        if (!result->success) return {ErrorCode::QUERY_FAILED, move(result->error)};
        current_query_result_ = move(result);
        current_stream_partitioner_.reset();

        // Create stream partitioner (if necessary)
        if (!options.partition_boundaries.empty()) {
            current_stream_partitioner_ = std::make_unique<Partitioner>(*result, options.partition_boundaries);
        }

        // Encode no result chunks
        fb::FlatBufferBuilder builder{1024};
        std::vector<flatbuffers::Offset<proto::webdb::QueryResultChunk>> chunks;
        auto chunkVec = builder.CreateVector(std::move(chunks));
        auto query_result_ofs = WriteQueryResult(builder, *current_query_result_, ++current_query_id_, chunkVec);
        builder.Finish(query_result_ofs);
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Fetch query results
ExpectedBuffer<p::QueryResultChunk> WebDB::Connection::FetchQueryResults() {
    try {
        // Fetch data if a query is active
        std::unique_ptr<duckdb::DataChunk> chunk;
        nonstd::span<duckdb::LogicalType> types;
        if (current_query_result_ != nullptr) {
            chunk = current_query_result_->Fetch();
            types = current_query_result_->types;
        }
        if (!current_query_result_->success) return {ErrorCode::QUERY_FAILED, move(current_query_result_->error)};

        // Encode the partition mask (if configured)
        PartitionBoundaries partitionBoundaries;
        if (current_stream_partitioner_ && !!chunk) {
            partitionBoundaries.resize(chunk->size(), 0);
            current_stream_partitioner_->consumeChunk(*chunk, partitionBoundaries);
        }

        // Get query result
        fb::FlatBufferBuilder builder{128};
        auto ofs =
            WriteQueryResultChunk(builder, *current_query_result_, current_query_id_, chunk.get(), partitionBoundaries);
        builder.Finish(ofs);

        // Last chunk?
        if (chunk && chunk->size() == 0) current_query_result_.reset();
        return {builder.Release()};
    } catch (std::exception& e) {
        return {ErrorCode::QUERY_FAILED, e.what()};
    }
}

/// Analyze a SQL query
ExpectedBuffer<p::QueryPlan> WebDB::Connection::AnalyzeQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database_};
    duckdb::Parser parser;
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();
    // Invalid statement count?
    if (parser.statements.size() != 1) return ErrorCode::INVALID_REQUEST;

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Write the plan buffer
    fb::FlatBufferBuilder builder{1024};
    auto plan_ofs = WriteQueryPlan(builder, *planner.plan);

    // Return buffer
    builder.Finish(plan_ofs);
    return {builder.Release()};
}

/// Constructor
WebDB::WebDB() : database_(), connections_(), db_config_() {
    db_config_.file_system = std::make_unique<WebDBFileSystem>();
    database_ = std::make_shared<duckdb::DuckDB>(nullptr, &db_config_);
    database_->LoadExtension<duckdb::ParquetExtension>();
}

/// Create a session
WebDB::Connection* WebDB::Connect() {
    auto conn = std::make_unique<WebDB::Connection>(database_);
    auto conn_ptr = conn.get();
    connections_.insert({conn_ptr, move(conn)});
    return conn_ptr;
}

/// End a session
void WebDB::Disconnect(Connection* session) { connections_.erase(session); }

}  // namespace webdb
}  // namespace dashql
