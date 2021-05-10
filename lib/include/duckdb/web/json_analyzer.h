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
#include "duckdb/web/json_reader.h"
#include "duckdb/web/reservoir_sample.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

struct FileRange {
    size_t offset;
    size_t size;
};

struct TableType {
    /// The shape
    TableShape shape = TableShape::UNRECOGNIZED;
    /// The type
    std::shared_ptr<arrow::DataType> type = nullptr;
    /// The array ranges
    std::unordered_map<std::string, FileRange> ranges = {};
};

/// Infer the type of a JSON table
arrow::Result<TableType> InferTableType(std::istream& in);

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
