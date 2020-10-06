// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_
#define INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_

#include <cstdint>
#include <tuple>

namespace duckdb_webapi {

using date_t = int32_t;

struct Date {
    /// Convert date to number
    static date_t fromDate(int32_t year, int32_t month, int32_t day);
    /// Convert number to date
    static std::tuple<int32_t, int32_t, int32_t> toDate(date_t date);
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_TYPES_DATE_H_
