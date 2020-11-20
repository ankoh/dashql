// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_TABLEGEN_H_
#define INCLUDE_DUCKDB_WEB_TABLEGEN_H_

#include "dashql/common/expected.h"
#include "duckdb.hpp"
#include "duckdb/main/connection.hpp"
#include "duckdb/web/proto/tablegen_generated.h"

namespace duckdb {
namespace web {

/// Generate table
dashql::ExpectedSignal generateTable(duckdb::Connection& conn, proto::TableSpecification& spec);

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_TABLEGEN_H_
