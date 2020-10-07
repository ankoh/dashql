// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/value.h"

#include "duckdb/common/types.hpp"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb_webapi/codec.h"
#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/value_ops.h"

namespace duckdb_webapi {

Value Value::BOOLEAN(int8_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::BOOLEAN)};
    result.value.booleanValue = value ? true : false;
    result.null = false;
    return result;
}

Value Value::TINYINT(int8_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::TINYINT)};
    result.value.tinyintValue = value;
    result.null = false;
    return result;
}

Value Value::SMALLINT(int16_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::SMALLINT)};
    result.value.smallintValue = value;
    result.null = false;
    return result;
}

Value Value::INTEGER(int32_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::INTEGER)};
    result.value.integerValue = value;
    result.null = false;
    return result;
}

Value Value::BIGINT(int64_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::BIGINT)};
    result.value.bigintValue = value;
    result.null = false;
    return result;
}

Value Value::DATE(duckdb::date_t value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::DATE)};
    result.value.integerValue = value;
    result.null = false;
    return result;
}

Value Value::DATE(int32_t year, int32_t month, int32_t day) {
    Value result{LogicalType::Get(proto::LogicalTypeID::DATE)};
    result.value.integerValue = duckdb::Date::FromDate(year, month, day);
    result.null = false;
    return result;
}

Value Value::TIME(dtime_t time) {
    Value result{LogicalType::Get(proto::LogicalTypeID::TIME)};
    result.value.integerValue = time;
    result.null = false;
    return result;
}

Value Value::TIME(int32_t hour, int32_t min, int32_t sec, int32_t msec) {
    return Value::TIME(duckdb::Time::FromTime(hour, min, sec, msec));
}

Value Value::TIMESTAMP(date_t date, dtime_t time) {
    auto val = Value::BIGINT(duckdb::Timestamp::FromDatetime(date, time));
    val.logicalType = LogicalType::Get(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::TIMESTAMP(timestamp_t timestamp) {
    auto val = Value::BIGINT(timestamp);
    val.logicalType = LogicalType::Get(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec, int32_t msec) {
    auto val = Value::TIMESTAMP(duckdb::Date::FromDate(year, month, day), duckdb::Time::FromTime(hour, min, sec, msec));
    val.logicalType = LogicalType::Get(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::FLOAT(float value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::FLOAT)};
    result.value.floatValue = value;
    result.null = false;
    return result;
}

Value Value::DOUBLE(double value) {
    Value result{LogicalType::Get(proto::LogicalTypeID::DOUBLE)};
    result.value.doubleValue = value;
    result.null = false;
    return result;
}

template <> Value Value::CreateValue(bool value) { return Value::BOOLEAN(value); }
template <> Value Value::CreateValue(int8_t value) { return Value::TINYINT(value); }
template <> Value Value::CreateValue(int16_t value) { return Value::SMALLINT(value); }
template <> Value Value::CreateValue(int32_t value) { return Value::INTEGER(value); }
template <> Value Value::CreateValue(int64_t value) { return Value::BIGINT(value); }
template <> Value Value::CreateValue(const char *value) { return Value(string(value)); }
template <> Value Value::CreateValue(std::string value) { return Value(value); }
template <> Value Value::CreateValue(float value) { return Value::FLOAT(value); }
template <> Value Value::CreateValue(double value) { return Value::DOUBLE(value); }
template <> Value Value::CreateValue(Value value) { return value; }

Value Value::operator+(const Value &rhs) const { return ValueOperations::Add(*this, rhs); }
Value Value::operator-(const Value &rhs) const { return ValueOperations::Subtract(*this, rhs); }
Value Value::operator*(const Value &rhs) const { return ValueOperations::Multiply(*this, rhs); }
Value Value::operator/(const Value &rhs) const { return ValueOperations::Divide(*this, rhs); }
Value Value::operator%(const Value &rhs) const {
    throw Exception{ET::NOT_IMPLEMENTED, "value modulo"};
    // return ValueOperations::Modulo(*this, rhs);
}

}  // namespace duckdb_webapi
