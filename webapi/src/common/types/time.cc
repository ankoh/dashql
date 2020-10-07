// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/common/types/time.h"

#include "duckdb_webapi/common/exception.h"

namespace duckdb_webapi {

#define DD_TIME(h, m, s, x) \
    ((h) >= 0 && (h) < 24 && (m) >= 0 && (m) < 60 && (s) >= 0 && (s) <= 60 && (x) >= 0 && (x) < 1000)

dtime_t Time::FromTime(int hour, int min, int sec, int msec) {
    if (!DD_TIME(hour, min, sec, msec)) throw Exception("Invalid time");
    return (dtime_t)(((((hour * 60) + min) * 60) + sec) * 1000 + msec);
}

std::tuple<int32_t, int32_t, int32_t, int32_t> Time::ToTime(dtime_t n) {
    int h, m, s, ms;

    h = n / 3600000;
    n -= h * 3600000;
    m = n / 60000;
    n -= m * 60000;
    s = n / 1000;
    n -= s * 1000;
    ms = n;

    return {h, m, s, ms};
}

}  // namespace duckdb_webapi
