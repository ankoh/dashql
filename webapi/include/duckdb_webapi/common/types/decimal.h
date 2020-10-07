// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_DECIMAL_H_
#define INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_DECIMAL_H_

#include <cstdint>
#include <tuple>

namespace duckdb_webapi {

class Decimal {
   public:
    static constexpr uint8_t MAX_WIDTH_INT16 = 4;
    static constexpr uint8_t MAX_WIDTH_INT32 = 9;
    static constexpr uint8_t MAX_WIDTH_INT64 = 18;
    static constexpr uint8_t MAX_WIDTH_INT128 = 38;
    static constexpr uint8_t MAX_WIDTH_DECIMAL = MAX_WIDTH_INT128;

   public:
    static std::string ToString(int16_t value, uint8_t scale);
    static std::string ToString(int32_t value, uint8_t scale);
    static std::string ToString(int64_t value, uint8_t scale);
};

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_COMMON_TYPES_DECIMAL_H_
