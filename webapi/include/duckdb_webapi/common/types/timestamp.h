// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_TIMESTAMP_H_
#define INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_TIMESTAMP_H_

#include <cstdint>
#include <tuple>

#include "duckdb_webapi/common/types/date.h"
#include "duckdb_webapi/common/types/time.h"

namespace duckdb_webapi {

using timestamp_t = int64_t;

struct Timestamp {
    /// Get date from timestamp
    static inline date_t GetDate(timestamp_t timestamp) { return (date_t)(((int64_t)timestamp) >> 32); }
    /// Get time from timestamp
    static inline dtime_t GetTime(timestamp_t timestamp) { return (dtime_t)(timestamp & 0xFFFFFFFF); }
    /// Convert date and time to timestamp
    static inline timestamp_t FromDateTime(date_t date, dtime_t time) { return ((int64_t)date << 32 | (int64_t)time); }
    /// Convert timestamp to date and time
    static inline std::pair<date_t, dtime_t> GetDateTime(timestamp_t dateTime) {
        return {GetDate(dateTime), GetTime(dateTime)};
    }
};

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_TIMESTAMP_H_
