// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_READER_H_
#define INCLUDE_DUCKDB_WEB_JSON_READER_H_

#define RAPIDJSON_HAS_STDSTRING 1
#define RAPIDJSON_HAS_CXX11_RVALUE_REFS 1
#define RAPIDJSON_HAS_CXX11_RANGE_FOR 1

#include <memory>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/json_analyzer.h"
#include "duckdb/web/json_parser.h"
#include "rapidjson/document.h"

namespace duckdb {
namespace web {
namespace json {

/// Read field from a json object
arrow::Result<std::shared_ptr<arrow::Field>> ReadField(const rapidjson::Value& obj);
/// Read fields from a json array
arrow::Result<std::vector<std::shared_ptr<arrow::Field>>> ReadFields(const rapidjson::Value::ConstArray& fields);

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
