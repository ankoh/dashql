// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#include <memory>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_parser.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

struct JSONReaderOptions {
    /// The table shape
    std::optional<TableShape> table_shape = std::nullopt;
    /// The table type
    std::shared_ptr<arrow::DataType> table_type = nullptr;

    /// Read from input stream
    arrow::Status ReadFrom(const rapidjson::Document& doc);
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
