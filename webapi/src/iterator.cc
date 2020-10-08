// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/iterator.h"
#include "duckdb_webapi/types.h"
#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/proto/sql_type_generated.h"
#include "duckdb/common/types/date.hpp"

#include <optional>
#include <random>
#include <stack>
#include <tuple>
#include <unordered_map>
#include <variant>

namespace duckdb_webapi {

// Constructor
QueryResultIterator::QueryResultIterator(WebAPI::Connection& connection, const proto::QueryResult& result)
    : connection(connection),
      result(result),
      globalRowIndex(0),
      chunkRowBegin(0),
      chunkID(0),
      chunkBuffer(),
      chunk(nullptr) {

    // Get initial chunk
    if (auto chunks = result.data_chunks(); chunks && chunks->size() > 0) {
        chunk = chunks->Get(0);
    } else {
        auto result = connection.FetchQueryResults();
        if (!result.IsOk())
            return;
        chunk = &result.value();
        chunkBuffer = result.ReleaseBuffer();
    }
}

/// Verify the result chunk
bool QueryResultIterator::Verify(const proto::QueryResultChunk& chunk) const {
    auto columns = chunk.columns();
    if (!columns || columns->size() != result.column_types()->size())
        return false;
    // XXX Check row counts
    return true;
}

/// Advance the iterator
ExpectedSignal QueryResultIterator::Next() {
    // Reached end?
    if (IsEnd()) return {};

    // Still in current chunk?
    ++globalRowIndex;
    if (chunk_row() < chunk->row_count()) return {};

    // Get next chunk (if neccessary)
    ++chunkID;
    if (auto chunks = result.data_chunks(); chunks && chunkID < chunks->size()) {
        chunk = chunks->Get(chunkID);
    } else {
        auto result = connection.FetchQueryResults();
        if (!result.IsOk()) return result.err();
        chunk = &result.value();
        chunkBuffer = result.ReleaseBuffer();
    }
    chunkRowBegin = globalRowIndex;
    assert(Verify(*chunk));
    return {};
}

/// Is at end?
bool QueryResultIterator::IsEnd() const { return !chunk || (chunk_row() >= chunk->row_count()); }

/// Get a value
duckdb::Value QueryResultIterator::GetValue(size_t col_idx) const {
    if (!chunk || !chunk->columns() || chunk->columns()->size() <= col_idx)
        return duckdb::Value{};
    auto column = chunk->columns()->Get(col_idx);
    auto type = result.column_types()->Get(col_idx);
    auto row = chunk_row();
    assert(row < chunk->row_count());

    // Values
    auto v_i64 = 0ll;
    auto v_u64 = 0ull;
    auto v_f64 = 0.0L;
    auto v_i128 = hugeint_t();
    const char* value_str = nullptr;
    bool null = false;
    interval_t v_interval;
    auto copy = [&](auto& var, auto* vec) {
        var = vec->values()->Get(row);
        null = vec->null_mask()->Get(row);
    };

    // Load value depending on physical type
    switch (column->variant_type()) {
        case proto::VectorVariant::NONE:
            break;
        case proto::VectorVariant::VectorI8:
            copy(v_i64, column->variant_as_VectorI8());
            break;
        case proto::VectorVariant::VectorU8:
            copy(v_u64, column->variant_as_VectorU8());
            break;
        case proto::VectorVariant::VectorI16:
            copy(v_i64, column->variant_as_VectorI16());
            break;
        case proto::VectorVariant::VectorU16:
            copy(v_u64, column->variant_as_VectorU16());
            break;
        case proto::VectorVariant::VectorI32:
            copy(v_i64, column->variant_as_VectorI32());
            break;
        case proto::VectorVariant::VectorU32:
            copy(v_u64, column->variant_as_VectorU32());
            break;
        case proto::VectorVariant::VectorI64:
            copy(v_i64, column->variant_as_VectorI64());
            break;
        case proto::VectorVariant::VectorU64:
            copy(v_u64, column->variant_as_VectorU64());
            break;
        case proto::VectorVariant::VectorI128: {
            auto* vec_i128 = column->variant_as_VectorI128();
            auto* values = vec_i128->values();
            auto* null_mask = vec_i128->null_mask();
            auto v = values->Get(row);
            v_i128.lower = v->lower();
            v_i128.upper = v->upper();
            null = null_mask->Get(row);
            break;
        }
        case proto::VectorVariant::VectorF32:
            copy(v_f64, column->variant_as_VectorF32());
            break;
        case proto::VectorVariant::VectorF64:
            copy(v_f64, column->variant_as_VectorF64());
            break;
        case proto::VectorVariant::VectorInterval: {
            auto* vec_interval = column->variant_as_VectorInterval();
            auto* values = vec_interval->values();
            auto* null_mask = vec_interval->null_mask();
            auto* v = values->Get(row);
            v_interval.months = v->months();
            v_interval.days = v->days();
            v_interval.msecs = v->msecs();
            null = null_mask->Get(row);
            break;
        }
        case proto::VectorVariant::VectorString: {
            auto* vec_i128 = column->variant_as_VectorString();
            auto* values = vec_i128->values();
            auto* null_mask = vec_i128->null_mask();
            value_str = values->Get(row)->c_str();
            null = null_mask->Get(row);
            break;
        }
    }

    // Get value
    switch (type->type_id()) {
        case proto::SQLTypeID::ANY:
            return duckdb::Value{duckdb::LogicalType::ANY};
        case proto::SQLTypeID::INVALID:
        case proto::SQLTypeID::UNKNOWN:
        case proto::SQLTypeID::SQLNULL:
            return duckdb::Value{};
        case proto::SQLTypeID::BOOLEAN:
            return duckdb::Value::BOOLEAN(v_i64);
        case proto::SQLTypeID::TINYINT:
            return duckdb::Value::TINYINT(v_i64);
        case proto::SQLTypeID::SMALLINT:
            return duckdb::Value::SMALLINT(v_i64);
        case proto::SQLTypeID::INTEGER:
            return duckdb::Value::INTEGER(v_i64);
        case proto::SQLTypeID::BIGINT:
            return duckdb::Value::BIGINT(v_i64);
        case proto::SQLTypeID::FLOAT:
            return duckdb::Value::FLOAT(v_f64);
        case proto::SQLTypeID::DOUBLE:
            return duckdb::Value::FLOAT(v_f64);
        case proto::SQLTypeID::CHAR:
            return duckdb::Value(value_str);
        case proto::SQLTypeID::VARCHAR:
            return duckdb::Value(value_str);
        case proto::SQLTypeID::HUGEINT:
            return duckdb::Value::HUGEINT(v_i128);
        case proto::SQLTypeID::DATE:
            return duckdb::Value::DATE(v_i64);
        case proto::SQLTypeID::TIME:
            return duckdb::Value::TIME(v_i64);
        case proto::SQLTypeID::TIMESTAMP:
            return duckdb::Value::TIMESTAMP(v_i64);
        case proto::SQLTypeID::INTERVAL:
            return duckdb::Value::INTERVAL(v_interval);
        case proto::SQLTypeID::BLOB:
        case proto::SQLTypeID::DECIMAL:
        case proto::SQLTypeID::HASH:
        case proto::SQLTypeID::LIST:
        case proto::SQLTypeID::POINTER:
        case proto::SQLTypeID::STRUCT:
        case proto::SQLTypeID::VARBINARY:
            return duckdb::Value{};
    }
    return duckdb::Value{};
}

}  // namespace duckdb_webapi
