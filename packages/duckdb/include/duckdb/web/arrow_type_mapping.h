#pragma once

#include <cstdint>

#include "arrow/array/array_base.h"
#include "arrow/type_fwd.h"

// Forward declare DuckDB types to avoid full header dependency
namespace duckdb {
struct LogicalType;
class Vector;
}  // namespace duckdb

namespace duckdb {
namespace web {

/// Map arrow type
arrow::Result<duckdb::LogicalType> mapArrowTypeToDuckDB(const arrow::DataType& type);
/// Map duckdb type to arrow
arrow::Result<std::shared_ptr<arrow::DataType>> mapDuckDBTypeToArrow(const duckdb::LogicalType& type);
/// Convert an arrow array to a DuckDB vector
arrow::Status convertArrowArrayToDuckDBVector(arrow::Array& in, duckdb::Vector& out);

}  // namespace web
}  // namespace duckdb
