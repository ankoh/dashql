// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/value.h"
#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/common/date.h"

namespace duckdb_webapi {

Value Value::NUMERIC(proto::LogicalTypeID id, int64_t value) {
    Value result{{proto::LogicalTypeID::BOOLEAN, 0, 0}};
    result.value.booleanValue = value ? true : false;
    result.isNull = false;
    return result;
}

Value Value::BOOLEAN(int8_t value) {
    Value result{{proto::LogicalTypeID::BOOLEAN, 0, 0}};
    result.value.booleanValue = value ? true : false;
    result.isNull = false;
    return result;
}

Value Value::TINYINT(int8_t value) {
    Value result{{proto::LogicalTypeID::TINYINT, 0, 0}};
    result.value.tinyintValue = value;
    result.isNull = false;
    return result;
}

Value Value::SMALLINT(int16_t value) {
    Value result{{proto::LogicalTypeID::SMALLINT, 0, 0}};
    result.value.smallintValue = value;
    result.isNull = false;
    return result;
}

Value Value::INTEGER(int32_t value) {
    Value result{{proto::LogicalTypeID::INTEGER, 0, 0}};
    result.value.integerValue = value;
    result.isNull = false;
    return result;
}

Value Value::BIGINT(int64_t value) {
    Value result{{proto::LogicalTypeID::BIGINT, 0, 0}};
    result.value.bigintValue = value;
    result.isNull = false;
    return result;
}

Value Value::DATE(date_t value) {
    Value result{{proto::LogicalTypeID::DATE, 0, 0}};
    result.value.integerValue = value;
    result.isNull = false;
    return result;
}

Value Value::DATE(int32_t year, int32_t month, int32_t day) {
    Value result{{proto::LogicalTypeID::DATE, 0, 0}};
    result.value.integerValue = dateToNumber(year, month, day);
    result.isNull = false;
    return result;
}

} // namespace duckdb_webapi
