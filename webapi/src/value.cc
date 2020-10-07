// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/value.h"

#include "duckdb_webapi/codec.h"
#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/common/types/date.h"
#include "duckdb_webapi/common/types/hugeint.h"
#include "duckdb_webapi/common/types/timestamp.h"

namespace duckdb_webapi {

Value Value::BOOLEAN(int8_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::BOOLEAN)};
    result.value.booleanValue = value ? true : false;
    result.null = false;
    return result;
}

Value Value::TINYINT(int8_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::TINYINT)};
    result.value.tinyintValue = value;
    result.null = false;
    return result;
}

Value Value::SMALLINT(int16_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::SMALLINT)};
    result.value.smallintValue = value;
    result.null = false;
    return result;
}

Value Value::INTEGER(int32_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::INTEGER)};
    result.value.integerValue = value;
    result.null = false;
    return result;
}

Value Value::BIGINT(int64_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::BIGINT)};
    result.value.bigintValue = value;
    result.null = false;
    return result;
}

Value Value::DATE(date_t value) {
    Value result{LogicalType::create(proto::LogicalTypeID::DATE)};
    result.value.integerValue = value;
    result.null = false;
    return result;
}

Value Value::DATE(int32_t year, int32_t month, int32_t day) {
    Value result{LogicalType::create(proto::LogicalTypeID::DATE)};
    result.value.integerValue = Date::FromDate(year, month, day);
    result.null = false;
    return result;
}

Value Value::TIME(dtime_t time) {
    Value result{LogicalType::create(proto::LogicalTypeID::TIME)};
    result.value.integerValue = time;
    result.null = false;
    return result;
}

Value Value::TIME(int32_t hour, int32_t min, int32_t sec, int32_t msec) {
    return Value::TIME(Time::FromTime(hour, min, sec, msec));
}

Value Value::TIMESTAMP(date_t date, dtime_t time) {
    auto val = Value::BIGINT(Timestamp::FromDateTime(date, time));
    val.logicalType = LogicalType::create(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::TIMESTAMP(timestamp_t timestamp) {
    auto val = Value::BIGINT(timestamp);
    val.logicalType = LogicalType::create(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec, int32_t msec) {
    auto val = Value::TIMESTAMP(Date::FromDate(year, month, day), Time::FromTime(hour, min, sec, msec));
    val.logicalType = LogicalType::create(proto::LogicalTypeID::TIMESTAMP);
    return val;
}

Value Value::FLOAT(float value) {
    Value result{LogicalType::create(proto::LogicalTypeID::FLOAT)};
    result.value.floatValue = value;
    result.null = false;
    return result;
}

Value Value::DOUBLE(double value) {
    Value result{LogicalType::create(proto::LogicalTypeID::DOUBLE)};
    result.value.doubleValue = value;
    result.null = false;
    return result;
}

template <> Value Value::createValue(bool value) { return Value::BOOLEAN(value); }
template <> Value Value::createValue(int8_t value) { return Value::TINYINT(value); }
template <> Value Value::createValue(int16_t value) { return Value::SMALLINT(value); }
template <> Value Value::createValue(int32_t value) { return Value::INTEGER(value); }
template <> Value Value::createValue(int64_t value) { return Value::BIGINT(value); }
template <> Value Value::createValue(const char *value) { return Value(string(value)); }
template <> Value Value::createValue(std::string value) { return Value(value); }
template <> Value Value::createValue(float value) { return Value::FLOAT(value); }
template <> Value Value::createValue(double value) { return Value::DOUBLE(value); }
template <> Value Value::createValue(Value value) { return value; }

namespace {

template <class OP> static Value templated_binary_operation(const Value &left, const Value &right) {
    auto leftType = left.getLogicalType();
    auto rightType = right.getLogicalType();
    auto resultType = leftType;
    if (leftType != rightType) {
        resultType = LogicalType::maxType(left.getLogicalType(), right.getLogicalType());
        Value left_cast = left.castAs(resultType);
        Value right_cast = right.castAs(resultType);
        return templated_binary_operation<OP>(left_cast, right_cast);
    }
    if (left.isNull() || right.isNull()) {
        return Value().castAs(resultType);
    }
    if (LogicalType::isIntegral(LogicalType::getPhysicalType(resultType))) {
        // integer addition
        return Value::NUMERIC(resultType, OP::template Operation<hugeint_t, hugeint_t, hugeint_t>(
                                              left.getValue<hugeint_t>(), right.getValue<hugeint_t>()));
    } else if (LogicalType::getPhysicalType(resultType) == proto::PhysicalTypeID::FLOAT) {
        return Value::FLOAT(
            OP::template Operation<float, float, float>(left.getValue<float>(), right.getValue<float>()));
    } else if (LogicalType::getPhysicalType(resultType) == proto::PhysicalTypeID::DOUBLE) {
        return Value::DOUBLE(
            OP::template Operation<double, double, double>(left.getValue<double>(), right.getValue<double>()));
    } else {
        throw Exception{ExceptionType::NOT_IMPLEMENTED, "Unimplemented type for value binary op"};
    }
}

}  // namespace

}  // namespace duckdb_webapi
