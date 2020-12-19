// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/iterator.h"

#include <optional>
#include <random>
#include <stack>
#include <tuple>
#include <unordered_map>
#include <variant>

#include "dashql/proto_generated.h"
#include "duckdb/common/types/date.hpp"

namespace p = dashql::proto::webdb;
using duckdb::hugeint_t;
using duckdb::interval_t;

namespace dashql {
namespace webdb {

// Constructor
QueryResultIterator::QueryResultIterator(WebDB::Connection& connection, const p::QueryResult& result)
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
        if (!result.IsOk()) return;
        chunk = &result.value();
        chunkBuffer = result.ReleaseBuffer();
    }
}

/// Verify the result chunk
bool QueryResultIterator::Verify(const p::QueryResultChunk& chunk) const {
    auto columns = chunk.columns();
    if (!columns || columns->size() != result.column_types()->size()) return false;
    // XXX Check row counts
    return true;
}

/// Advance the iterator
Signal QueryResultIterator::Next() {
    // Reached end?
    if (IsEnd()) return Signal::OK();

    // Still in current chunk?
    ++globalRowIndex;
    if (chunk_row() < chunk->row_count()) return Signal::OK();

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
    return Signal::OK();
}

/// Is at end?
bool QueryResultIterator::IsEnd() const { return !chunk || (chunk_row() >= chunk->row_count()); }

/// Get a value
duckdb::Value QueryResultIterator::GetValue(size_t col_idx) const {
    if (!chunk || !chunk->columns() || col_idx >= chunk->columns()->size()) return duckdb::Value{};
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
        if (vec->null_mask()) null = vec->null_mask()->Get(row);
    };

    // Load value depending on physical type
    switch (column->variant_type()) {
        case p::VectorVariant::NONE:
            break;
        case p::VectorVariant::VectorI8:
            copy(v_i64, column->variant_as_VectorI8());
            break;
        case p::VectorVariant::VectorU8:
            copy(v_u64, column->variant_as_VectorU8());
            break;
        case p::VectorVariant::VectorI16:
            copy(v_i64, column->variant_as_VectorI16());
            break;
        case p::VectorVariant::VectorU16:
            copy(v_u64, column->variant_as_VectorU16());
            break;
        case p::VectorVariant::VectorI32:
            copy(v_i64, column->variant_as_VectorI32());
            break;
        case p::VectorVariant::VectorU32:
            copy(v_u64, column->variant_as_VectorU32());
            break;
        case p::VectorVariant::VectorI64:
            copy(v_i64, column->variant_as_VectorI64());
            break;
        case p::VectorVariant::VectorU64:
            copy(v_u64, column->variant_as_VectorU64());
            break;
        case p::VectorVariant::VectorI128: {
            auto* vec_i128 = column->variant_as_VectorI128();
            auto* values = vec_i128->values();
            auto* null_mask = vec_i128->null_mask();
            auto v = values->Get(row);
            v_i128.lower = v->lower();
            v_i128.upper = v->upper();
            if (null_mask) null = null_mask->Get(row);
            break;
        }
        case p::VectorVariant::VectorF32:
            copy(v_f64, column->variant_as_VectorF32());
            break;
        case p::VectorVariant::VectorF64:
            copy(v_f64, column->variant_as_VectorF64());
            break;
        case p::VectorVariant::VectorInterval: {
            auto* vec_interval = column->variant_as_VectorInterval();
            auto* values = vec_interval->values();
            auto* null_mask = vec_interval->null_mask();
            auto* v = values->Get(row);
            v_interval.months = v->months();
            v_interval.days = v->days();
            v_interval.micros = v->micros();
            if (null_mask) null = null_mask->Get(row);
            break;
        }
        case p::VectorVariant::VectorString: {
            auto* vec_i128 = column->variant_as_VectorString();
            auto* values = vec_i128->values();
            auto* null_mask = vec_i128->null_mask();
            value_str = values->Get(row)->c_str();
            if (null_mask) null = null_mask->Get(row);
            break;
        }
    }

    // Get value
    switch (type->type_id()) {
        case p::SQLTypeID::ANY:
            return duckdb::Value{duckdb::LogicalType::ANY};
        case p::SQLTypeID::INVALID:
        case p::SQLTypeID::UNKNOWN:
        case p::SQLTypeID::SQLNULL:
            return duckdb::Value{};
        case p::SQLTypeID::BOOLEAN:
            return duckdb::Value::BOOLEAN(v_u64);
        case p::SQLTypeID::TINYINT:
            return duckdb::Value::TINYINT(v_i64);
        case p::SQLTypeID::SMALLINT:
            return duckdb::Value::SMALLINT(v_i64);
        case p::SQLTypeID::INTEGER:
            return duckdb::Value::INTEGER(v_i64);
        case p::SQLTypeID::BIGINT:
            return duckdb::Value::BIGINT(v_i64);
        case p::SQLTypeID::FLOAT:
            return duckdb::Value::FLOAT(v_f64);
        case p::SQLTypeID::DOUBLE:
            return duckdb::Value::FLOAT(v_f64);
        case p::SQLTypeID::CHAR:
            return duckdb::Value(value_str);
        case p::SQLTypeID::VARCHAR:
            return duckdb::Value(value_str);
        case p::SQLTypeID::HUGEINT:
            return duckdb::Value::HUGEINT(v_i128);
        case p::SQLTypeID::DATE:
            return duckdb::Value::DATE(v_i64);
        case p::SQLTypeID::TIME:
            return duckdb::Value::TIME(v_i64);
        case p::SQLTypeID::TIMESTAMP:
            return duckdb::Value::TIMESTAMP(v_i64);
        case p::SQLTypeID::INTERVAL:
            return duckdb::Value::INTERVAL(v_interval);
        case p::SQLTypeID::BLOB:
        case p::SQLTypeID::DECIMAL:
        case p::SQLTypeID::HASH:
        case p::SQLTypeID::LIST:
        case p::SQLTypeID::POINTER:
        case p::SQLTypeID::STRUCT:
        case p::SQLTypeID::VARBINARY:
            return duckdb::Value{};
    }
    return duckdb::Value{};
}

}  // namespace webdb
}  // namespace dashql
