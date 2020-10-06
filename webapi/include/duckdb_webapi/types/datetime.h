// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_
#define INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_

#include <cstdint>

namespace duckdb_webapi {

using date_t = uint32_t;

/// Convert number to date
void numberToDate(int32_t n, int32_t &year, int32_t &month, int32_t &day);
/// Convert date to number
int32_t dateToNumber(int32_t year, int32_t month, int32_t day);

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_
