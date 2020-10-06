// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TYPES_TIME_H_
#define INCLUDE_DUCKDB_WEBAPI_TYPES_TIME_H_

#include <cstdint>
#include <tuple>

namespace duckdb_webapi {

using dtime_t = int32_t;

struct Time {
    /// Convert time to number
    static dtime_t fromTime(int32_t hour, int32_t min, int32_t sec, int32_t msec);
    /// Convert number to time
    static std::tuple<int32_t, int32_t, int32_t, int32_t> toTime(dtime_t n);
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_TYPES_TIME_H_
