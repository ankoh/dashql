// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_TYPES_TIMESTAMP_H_
#define INCLUDE_DUCKDB_WEBAPI_TYPES_TIMESTAMP_H_

#include "duckdb_webapi/types/date.h"
#include "duckdb_webapi/types/time.h"
#include <cstdint>
#include <tuple>

namespace duckdb_webapi {

using timestamp_t = int64_t;

struct Timestamp {
    /// Get date from timestamp
    static inline date_t getDate(timestamp_t timestamp) { return (date_t)(((int64_t)timestamp) >> 32); }
    /// Get time from timestamp
    static inline dtime_t getTime(timestamp_t timestamp) { return (dtime_t)(timestamp & 0xFFFFFFFF); }
    /// Convert date and time to timestamp
    static inline timestamp_t fromDateTime(date_t date, dtime_t time) { return ((int64_t)date << 32 | (int64_t)time); }
    /// Convert timestamp to date and time
    static inline std::pair<date_t, dtime_t> getDateTime(timestamp_t dateTime) {
        return {getDate(dateTime), getTime(dateTime)};
    }
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_TYPES_TIMESTAMP_H_
