// Copyright (c) 2020 The DashQL Authors
#ifndef INCLUDE_DUCKDB_WEB_CSV_READER_H_
#define INCLUDE_DUCKDB_WEB_CSV_READER_H_

#include "arrow/result.h"
#include "duckdb.hpp"
#include "duckdb/execution/operator/persistent/buffered_csv_reader.hpp"
#include "duckdb/parser/column_definition.hpp"
#include "duckdb/web/io/filesystem_buffer.h"
#include "duckdb/web/webdb.h"

namespace duckdb {
namespace web {

struct CSVReaderArgs {
    /// The table schema
    std::string_view schema;
    /// The table name
    std::string_view table;
    /// The buffered csv reader options
    duckdb::BufferedCSVReaderOptions options;
};

/// An arrow inserter
class CSVReader {
   protected:
    /// The database
    duckdb::Connection& connection_;
    /// The buffered csv reader
    duckdb::BufferedCSVReader reader_;
    /// The table
    std::string schema_;
    /// The schema
    std::string table_;

   public:
    /// Constructor
    CSVReader(duckdb::Connection& connection, std::unique_ptr<std::istream> in, CSVReaderArgs args);

    /// Initialize the reader and create the table.
    arrow::Status Initialize();
    /// Read from CSV until the input is depleted
    arrow::Result<size_t> ParseEntireInput();

    /// Read the csv reader arguments from a json document
    static arrow::Result<CSVReaderArgs> ReadArgumentsFromJSON(std::string_view input);
};

}  // namespace web
}  // namespace duckdb

#endif
