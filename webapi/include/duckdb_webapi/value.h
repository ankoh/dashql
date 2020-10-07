// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_VALUE_H_
#define INCLUDE_DUCKDB_WEBAPI_VALUE_H_

#include "duckdb_webapi/api.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/proto/value_generated.h"
#include "duckdb_webapi/types.h"

namespace duckdb_webapi {

/// SQL Value.
/// Implementation adopted from DuckDB and migrated to the flatbuffer schema.
/// We deliberately omitted the types: hash, pointer, struct.
class Value {
   protected:
    /// The logical type of the value
    proto::LogicalType logicalType = proto::LogicalType{proto::LogicalTypeID::INVALID, 0, 0};
    /// Whether or not the value is NULL
    bool null;
    /// The value of the object, if it is of a constant size type
    union Val {
        int8_t booleanValue;
        int8_t tinyintValue;
        int16_t smallintValue;
        int32_t integerValue;
        int64_t bigintValue;
        float floatValue;
        double doubleValue;
    } value;
    /// The value of the object, if it is of a variable size type
    string strValue;

   public:
    /// Create an empty NULL value of the specified type
    Value(proto::LogicalType type = {proto::LogicalTypeID::SQLNULL, 0, 0})
        : logicalType(type), null(true) {}  /// Create a BIGINT value
    /// Create an INTEGER value
    Value(int32_t val) : logicalType(proto::LogicalTypeID::INTEGER, 0, 0), null(false) { value.integerValue = val; }
    /// Create a BIGINT value
    Value(int64_t val) : logicalType(proto::LogicalTypeID::BIGINT, 0, 0), null(false) { value.bigintValue = val; }
    /// Create a FLOAT value
    Value(float val) : logicalType(proto::LogicalTypeID::FLOAT, 0, 0), null(false) { value.floatValue = val; }
    /// Create a DOUBLE value
    Value(double val) : logicalType(proto::LogicalTypeID::DOUBLE, 0, 0), null(false) { value.doubleValue = val; }
    /// Create a VARCHAR value
    Value(const char *val) : Value(val ? string(val) : string()) {}
    /// Create a VARCHAR value
    Value(string val);

    /// Get the logical type
    auto &GetLogicalType() const { return logicalType; }
    /// Is value null?
    auto IsNull() const { return null; }
    /// Get inner value
    template <class T> T GetValue() const { assert(false); }
    /// Create a value
    template <class T> static Value CreateValue(T value) { assert(false); }

    /// Return a copy of this value
    Value Copy() const { return Value(*this); }
    /// Convert this value to a string
    string ToString() const;
    /// Convert this value to a string, with the given display format
    string ToString(proto::LogicalType &type) const;
    /// Cast this value to another type
    Value CastAs(proto::LogicalType targetType, bool strict = false) const;
    /// Cast this value to another type
    Value CastAs(proto::LogicalType &sourceType, proto::LogicalType &targetType, bool strict = false);
    /// Tries to cast value to another type, throws exception if its not possible
    bool TryCastAs(proto::LogicalType &sourceType, proto::LogicalType &targetType, bool strict = false);

    /// Numeric Operators
    Value operator+(const Value &rhs) const;
    Value operator-(const Value &rhs) const;
    Value operator*(const Value &rhs) const;
    Value operator/(const Value &rhs) const;
    Value operator%(const Value &rhs) const;

    /// Comparison Operators
    bool operator==(const Value &rhs) const;
    bool operator!=(const Value &rhs) const;
    bool operator<(const Value &rhs) const;
    bool operator>(const Value &rhs) const;
    bool operator<=(const Value &rhs) const;
    bool operator>=(const Value &rhs) const;
    bool operator==(const int64_t &rhs) const;
    bool operator!=(const int64_t &rhs) const;
    bool operator<(const int64_t &rhs) const;
    bool operator>(const int64_t &rhs) const;
    bool operator<=(const int64_t &rhs) const;
    bool operator>=(const int64_t &rhs) const;

    /// Returns true if the values are (approximately) equivalent. Note this is NOT the SQL equivalence.
    /// For this function, NULL values are equivalent and floating point values that are close are equivalent.
    static bool valuesAreEqual(Value resultValue, Value value);
    /// Print a value
    friend std::ostream &operator<<(std::ostream &out, const Value &val) {
        out << val.ToString();
        return out;
    }

    /// Create the lowest possible value of a given type (numeric only)
    static Value MinimumValue(proto::LogicalTypeID type);
    /// Create the highest possible value of a given type (numeric only)
    static Value MaximumValue(proto::LogicalTypeID type);

    /// Create a Numeric value of the specified type with the specified value
    static Value NUMERIC(proto::LogicalTypeID id, int64_t value);
    /// Create a tinyint Value from a specified value
    static Value BOOLEAN(int8_t value);
    /// Create a tinyint Value from a specified value
    static Value TINYINT(int8_t value);
    /// Create a smallint Value from a specified value
    static Value SMALLINT(int16_t value);
    /// Create an integer Value from a specified value
    static Value INTEGER(int32_t value);
    /// Create a bigint Value from a specified value
    static Value BIGINT(int64_t value);
    /// Create a date Value from a specified date
    static Value DATE(date_t date);
    /// Create a date Value from a specified date
    static Value DATE(int32_t year, int32_t month, int32_t day);
    /// Create a time Value from a specified date
    static Value TIME(dtime_t time);
    /// Create a time Value from a specified date
    static Value TIME(int32_t hour, int32_t min, int32_t sec, int32_t msec);
    /// Create a timestamp Value from a specified date/time combination
    static Value TIMESTAMP(date_t date, dtime_t time);
    /// Create a timestamp Value from a specified timestamp
    static Value TIMESTAMP(timestamp_t timestamp);
    /// Create a timestamp Value from a specified timestamp in separate values
    static Value TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec,
                           int32_t msec);
    /// Create a float Value from a specified value
    static Value FLOAT(float value);
    /// Create a double Value from a specified value
    static Value DOUBLE(double value);
};

template <> Value Value::CreateValue(bool value);
template <> Value Value::CreateValue(int8_t value);
template <> Value Value::CreateValue(int16_t value);
template <> Value Value::CreateValue(int32_t value);
template <> Value Value::CreateValue(int64_t value);
template <> Value Value::CreateValue(const char *value);
template <> Value Value::CreateValue(std::string value);
template <> Value Value::CreateValue(float value);
template <> Value Value::CreateValue(double value);
template <> Value Value::CreateValue(Value value);

template <> bool Value::GetValue() const;
template <> int8_t Value::GetValue() const;
template <> int16_t Value::GetValue() const;
template <> int32_t Value::GetValue() const;
template <> int64_t Value::GetValue() const;
template <> std::string Value::GetValue() const;
template <> float Value::GetValue() const;
template <> double Value::GetValue() const;

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_VALUE_VALUE_H_
