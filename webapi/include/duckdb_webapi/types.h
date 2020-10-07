// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TYPES_H_
#define INCLUDE_DUCKDB_WEBAPI_TYPES_H_

#include "duckdb/common/types.hpp"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"

namespace duckdb_webapi {

using hash_t = duckdb::hash_t;
using timestamp_t = duckdb::timestamp_t;
using dtime_t = duckdb::dtime_t;
using date_t = duckdb::date_t;
using hugeint_t = duckdb::hugeint_t;

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_VALUE_VALUE_H_
