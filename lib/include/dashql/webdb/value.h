// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_WEBDB_VALUE_H_
#define INCLUDE_DASHQL_WEBDB_VALUE_H_

#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"

namespace dashql {
namespace webdb {

/// Type used to represent dates (days since 1970-01-01)
using date_t = int32_t;
/// Type used to represent time (microseconds)
using dtime_t = int64_t;
/// Type used to represent timestamps (microseconds since 1970-01-01)
using timestamp_t = int64_t;
/// A ref tag
enum RefTag { Ref };

class Value {
   protected:
    /// The type
    proto::webdb::SQLType type_;
    /// The data
    std::variant<std::monostate, int64_t, double, std::string, std::string_view> data_;

   public:
    /// Create an empty NULL value
    Value();
    /// Create an empty NULL value of the specified type
    Value(proto::webdb::SQLType type);
    /// Create from flatbuffer object
    Value(const proto::webdb::Value& val);

    /// Get the type
    auto& type() const { return type_; }
    /// Get the type
    bool is_null() const { return std::holds_alternative<std::monostate>(data_); }
    /// Get the raw data
    auto& data() const { return data_; }

    /// Get as integer
    int64_t DataAsI64() const;
    /// Get as double
    double DataAsF64() const;
    /// Get as string
    std::string DataAsString() const;
    /// Get as string view
    std::string_view DataAsStringView() const;

    /// Print the type
    std::string PrintType() const;
    /// Print the type
    void PrintType(std::ostream& out) const;
    /// Print the value
    std::string PrintValue() const;
    /// Print the value
    void PrintValue(std::ostream& out) const;

    /// Parse a value from text
    static proto::webdb::SQLType ParseType(std::string_view type);
    /// Parse a value from text
    static Value Parse(std::string_view type, std::string_view data);
    /// Create a Numeric value of the specified type with the specified value
    static Value Numeric(proto::webdb::SQLType type, int64_t value);
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
    /// Create a time Value from a specified time
    static Value TIME(dtime_t time);
    /// Create a time Value from a specified time
    static Value TIME(int32_t hour, int32_t min, int32_t sec, int32_t micros);
    /// Create a timestamp Value from a specified date/time combination
    static Value TIMESTAMP(date_t date, dtime_t time);
    /// Create a timestamp Value from a specified timestamp
    static Value TIMESTAMP(timestamp_t timestamp);
    /// Create a timestamp Value from a specified timestamp in separate values
    static Value TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec,
                           int32_t micros);
    static Value INTERVAL(int32_t months, int32_t days, int64_t micros);

    // Decimal values
    static Value DECIMAL(int16_t value, uint8_t width, uint8_t scale);
    static Value DECIMAL(int32_t value, uint8_t width, uint8_t scale);
    static Value DECIMAL(int64_t value, uint8_t width, uint8_t scale);
    /// Create a float Value from a specified value
    static Value FLOAT(float value);
    /// Create a double Value from a specified value
    static Value DOUBLE(double value);
    /// Create a varchar from a string value
    static Value VARCHAR(std::string value);
    /// Create a varchar from a string view
    static Value VARCHAR(RefTag, std::string_view value);
};

}  // namespace webdb
}  // namespace dashql

#endif
