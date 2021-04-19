// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_ARROW_INSERTER_H_
#define INCLUDE_DUCKDB_WEB_ARROW_INSERTER_H_

#include "duckdb.hpp"
#include "duckdb/web/io/buffer_manager.h"

namespace duckdb {
namespace web {

/// An arrow inserter
class ArrowInserter {
   protected:
    /// The database
    duckdb::DuckDB& database;

   public:
    /// Constructor
    ArrowInserter(duckdb::DuckDB& database);

    /// Create a table from an arrow stream header
    void CreateTable(nonstd::span<char> data);
    /// Append a record batch to a table
    void AppendRecordBatch(nonstd::span<char> data);
};

}  // namespace web
}  // namespace duckdb

#endif
