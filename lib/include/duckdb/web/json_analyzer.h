// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_ANALYZER_H_
#define INCLUDE_DUCKDB_WEB_JSON_ANALYZER_H_

#include <limits>
#include <memory>
#include <unordered_map>
#include <unordered_set>

#include "arrow/array/builder_nested.h"
#include "arrow/type.h"
#include "arrow/type_traits.h"
#include "duckdb/web/reservoir_sample.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

/// Get the table shape
enum TableShape {
    // Unknown table shape
    UNRECOGNIZED,
    // Document is an array of rows.
    // E.g. [{"a":1,"b":2}, {"a":3,"b":4}]
    ROW_ARRAY,
    // Document is an object with column array fields.
    // E.g. {"a":[1,3],"b":[2,4]}
    COLUMN_ARRAYS,
};

/// Infer the type of a JSON table
arrow::Result<std::pair<TableShape, std::shared_ptr<arrow::DataType>>> InferTableType(std::istream& in);

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif