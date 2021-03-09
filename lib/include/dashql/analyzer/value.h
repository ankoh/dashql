// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VALUE_H_
#define INCLUDE_DASHQL_ANALYZER_VALUE_H_

#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"

namespace dashql {

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
    /// The physical type
    enum class PhysicalType { NULL_, I64, F64, STRING, STRING_VIEW };

    /// The logical type
    proto::webdb::SQLType logical_type_;
    /// The physical type
    PhysicalType physical_type_;
    /// The data.
    ///
    /// We simplify the type logic a bit since we're not doing real database business here.
    /// Our analyzer can deviate a bit from the precise SQL semantics.
    ///
    /// For example, the DashQL integer parameters are always passed as signed 64-bit so we don't need
    /// to worry too much about SMALLINT, TINYINT etc here.
    union {
        int64_t i64;
        double f64;
    } data_;
    /// The string value buffer (if any)
    std::string data_str_buffer_;
    /// The string value
    std::string_view data_str_;

    /// Set integer value
    void SetData(int64_t value);
    /// Set double value
    void SetData(double value);
    /// Set string value
    void SetData(std::string value);
    /// Set string view value
    void SetData(std::string_view value);

   public:
    /// Create an empty NULL value
    Value();
    /// Create an empty NULL value of the specified type
    Value(proto::webdb::SQLTypeID type);
    /// Create an empty NULL value of the specified type
    Value(proto::webdb::SQLType type);
    /// Create from flatbuffer object
    Value(const proto::webdb::SQLValue& val);

    /// Explicit move constructor
    Value(Value&& other) noexcept;
    /// Explicit move assignment
    Value& operator=(Value&& other) noexcept;

    /// Get the type
    auto& logical_type() const { return logical_type_; }
    /// Get the type
    bool is_null() const { return physical_type_ == PhysicalType::NULL_; }

    /// Get as integer
    auto GetUnsafeI64() const { return data_.i64; }
    /// Get as double
    auto GetUnsafeF64() const { return data_.f64; }
    /// Get as string view
    auto GetUnsafeString() const { return data_str_; }

    /// Cast as boolean
    std::optional<bool> CastAsBool() const;
    /// Cast as unsigned 64 bit integer
    std::optional<int64_t> CastAsUI64() const;

    /// Print the type
    void PrintType(std::ostream& out) const;
    /// Print the value
    void PrintValue(std::ostream& out) const;
    /// Print the value
    void PrintValueAsScript(std::ostream& out) const;
    /// Print the type
    std::string PrintType() const;
    /// Print the value
    std::string PrintValue() const;
    /// Print the value
    std::string PrintValueAsScript() const;

    /// Comparison
    bool operator==(const Value& rhs) const;
    /// Comparison
    bool operator!=(const Value& rhs) const;

    /// Copy a value deep
    Value CopyDeep() const;
    /// Copy a value shallow
    Value CopyShallow() const;

    /// Pack as flatbuffer
    flatbuffers::Offset<proto::webdb::SQLValue> Pack(flatbuffers::FlatBufferBuilder& builder) const;
    /// Unpack from flatbuffer
    static Value UnPack(const proto::webdb::SQLValue& val);

    /// Parse a value from text
    static proto::webdb::SQLType ParseType(std::string_view type);
    /// Parse a value from text
    static Value Parse(std::string_view type, std::string_view data, bool string_refs = false);
    /// Create a Numeric value of the specified type with the specified value
    static Value Numeric(proto::webdb::SQLType type, int64_t value);

    /// Create a boolean value from a specified value
    static Value BOOLEAN(int8_t value);
    /// Create an integer value from a specified value
    static Value BIGINT(int64_t value);
    /// Create a date value from a specified date
    static Value DATE(date_t date);
    /// Create a date value from a specified date
    static Value DATE(int32_t year, int32_t month, int32_t day);
    /// Create a time value from a specified time
    static Value TIME(dtime_t time);
    /// Create a time value from a specified time
    static Value TIME(int32_t hour, int32_t min, int32_t sec, int32_t micros);
    /// Create a timestamp value from a specified date/time combination
    static Value TIMESTAMP(date_t date, dtime_t time);
    /// Create a timestamp value from a specified timestamp
    static Value TIMESTAMP(timestamp_t timestamp);
    /// Create a timestamp value from a specified timestamp in separate values
    static Value TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec,
                           int32_t micros);

    // Decimal values
    static Value DECIMAL(int64_t value, uint8_t width, uint8_t scale);
    /// Create a double value from a specified value
    static Value DOUBLE(double value);
    /// Create a varchar from a string value
    static Value VARCHAR(std::string value);
    /// Create a varchar from a string view
    static Value VARCHAR(RefTag, std::string_view value);
};

}  // namespace dashql

#endif
