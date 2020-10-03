// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TABLEGEN_H_
#define INCLUDE_DUCKDB_WEBAPI_TABLEGEN_H_

#include "duckdb.hpp"
#include "duckdb/main/connection.hpp"
#include "duckdb_webapi/proto/tablegen_generated.h"

namespace duckdb_webapi {

/// Generate table
void generateTable(duckdb::Connection& conn, proto::TableSpecification& spec);

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_TABLEGEN_H_
