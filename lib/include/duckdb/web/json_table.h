// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_TABLE_H_
#define INCLUDE_DUCKDB_WEB_JSON_TABLE_H_

#include <iostream>
#include <memory>
#include <string>

#include "arrow/type.h"
#include "arrow/type_fwd.h"
#include "duckdb/web/io/ifstream.h"
#include "duckdb/web/json_parser.h"
#include "duckdb/web/json_reader.h"
#include "duckdb/web/json_table_options.h"
#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"

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
    /// The column boundaries
    std::unordered_map<std::string, FileRange> column_boundaries = {};
};

/// An table reader
class TableReader {
   protected:
    /// Find the column boundaries
    static arrow::Status FindColumnBoundaries(std::istream& in, TableType& type);

   public:
    /// Prepare the table reader
    virtual arrow::Status Prepare() = 0;
    /// Read next chunk
    virtual arrow::Status ReadNextBatch() = 0;
};

}  // namespace json
}  // namespace web
}  // namespace duckdb

#endif
