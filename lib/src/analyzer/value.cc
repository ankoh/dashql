// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/value.h"

#include <iomanip>
#include <regex>
#include <sstream>

#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/decimal.hpp"
#include "duckdb/common/types/interval.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"

namespace dashql {

namespace {

proto::webdb::SQLType NOTYPE() { return proto::webdb::SQLType(proto::webdb::SQLTypeID::INVALID, 0, 0); }

}  // namespace

// Constructor
Value::Value() : logical_type_(NOTYPE()), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {}

// Constructor
Value::Value(proto::webdb::SQLTypeID type)
    : logical_type_(proto::webdb::SQLType(type, 0, 0)),
      physical_type_(PhysicalType::NULL_),
      data_str_buffer_(),
      data_str_() {}

// Constructor
Value::Value(proto::webdb::SQLType type)
    : logical_type_(type), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {}

// Move construction
Value::Value(Value&& other) noexcept
    : logical_type_(other.logical_type_), physical_type_(other.physical_type_), data_str_buffer_(), data_str_() {
    *this = std::move(other);
}

// Move assignment
Value& Value::operator=(Value&& other) noexcept {
    logical_type_ = other.logical_type_;
    physical_type_ = other.physical_type_;
    data_str_buffer_ = {};
    data_str_ = {};
    switch (physical_type_) {
        case PhysicalType::NULL_:
            break;
        case PhysicalType::I64:
            data_.i64 = other.data_.i64;
            break;
        case PhysicalType::F64:
            data_.f64 = other.data_.f64;
            break;
        case PhysicalType::STRING:
            data_str_buffer_ = move(other.data_str_buffer_);
            data_str_ = data_str_buffer_;
            break;
        case PhysicalType::STRING_VIEW:
            data_str_ = other.data_str_;
            break;
    }
    return *this;
}

// Set integer value
void Value::SetData(int64_t value) {
    physical_type_ = PhysicalType::I64;
    data_.i64 = value;
}

// Set double value
void Value::SetData(double value) {
    physical_type_ = PhysicalType::F64;
    data_.f64 = value;
}

// Set string value
void Value::SetData(std::string value) {
    physical_type_ = PhysicalType::STRING;
    data_str_buffer_ = move(value);
    data_str_ = std::string_view{data_str_buffer_};
}

// Set string view value
void Value::SetData(std::string_view value) {
    physical_type_ = PhysicalType::STRING_VIEW;
    data_str_ = value;
}

void Value::PrintType(std::ostream& out) const {
    using T = proto::webdb::SQLTypeID;
    out << proto::webdb::EnumNameSQLTypeID(logical_type_.type_id());
    if (logical_type_.type_id() == T::DECIMAL) {
        out << "(" << logical_type_.width() << "," << logical_type_.scale() << ")";
    }
}

void Value::PrintValue(std::ostream& out) const {
    using T = proto::webdb::SQLTypeID;
    switch (logical_type_.type_id()) {
        case T::BOOLEAN:
            out << ((data_.i64 != 0) ? "true" : "false");
            break;
        case T::BIGINT:
            out << data_.i64;
            break;
        case T::DOUBLE:
            out << data_.f64;
            break;
        case T::DATE:
            out << duckdb::Date::ToString(data_.i64);
            break;
        case T::TIME:
            out << duckdb::Time::ToString(data_.i64);
            break;
        case T::TIMESTAMP:
            out << duckdb::Timestamp::ToString(data_.i64);
            break;
        case T::DECIMAL:
            out << duckdb::Decimal::ToString(data_.i64, logical_type_.scale());
            break;
        case T::VARCHAR:
            out << data_str_;
            break;
        default:
            out << "NULL";
            break;
    }
}

void Value::PrintValueAsScript(std::ostream& out) const {
    using T = proto::webdb::SQLTypeID;
    switch (logical_type_.type_id()) {
        case T::BOOLEAN:
            out << ((data_.i64 != 0) ? "true" : "false");
            break;
        case T::BIGINT:
            out << data_.i64;
            break;
        case T::DOUBLE:
            out << data_.f64;
            break;
        case T::DATE:
            out << duckdb::Date::ToString(data_.i64);
            break;
        case T::TIME:
            out << duckdb::Time::ToString(data_.i64);
            break;
        case T::TIMESTAMP:
            out << duckdb::Timestamp::ToString(data_.i64);
            break;
        case T::DECIMAL:
            out << duckdb::Decimal::ToString(data_.i64, logical_type_.scale());
            break;
        case T::VARCHAR:
            out << std::quoted(data_str_, '\'');
            break;
        default:
            out << "NULL";
            break;
    }
}

std::string Value::PrintType() const {
    std::stringstream ss;
    PrintType(ss);
    return ss.str();
}

std::string Value::PrintValue() const {
    std::stringstream ss;
    PrintValue(ss);
    return ss.str();
}

std::string Value::PrintValueAsScript() const {
    std::stringstream ss;
    PrintValueAsScript(ss);
    return ss.str();
}

// Comparison
bool Value::operator==(const Value& other) const {
    bool cmp = true;
    cmp = cmp && (logical_type_ == other.logical_type_);
    cmp = cmp && (physical_type_ == other.physical_type_);
    switch (physical_type_) {
        case PhysicalType::NULL_:
            break;
        case PhysicalType::I64:
            cmp = cmp && (data_.i64 == other.data_.i64);
            break;
        case PhysicalType::F64:
            cmp = cmp && (data_.f64 == other.data_.f64);
            break;
        case PhysicalType::STRING:
            cmp = cmp && (data_str_buffer_ == other.data_str_buffer_);
            break;
        case PhysicalType::STRING_VIEW:
            cmp = cmp && (data_str_ == other.data_str_);
            break;
    }
    return cmp;
}

// Comparison
bool Value::operator!=(const Value& other) const { return !(*this == other); }

// Copy a value
Value Value::CopyShallow() const {
    Value v;
    v.logical_type_ = logical_type_;
    v.physical_type_ = physical_type_;
    switch (v.physical_type_) {
        case PhysicalType::NULL_:
            break;
        case PhysicalType::I64:
            v.data_.i64 = data_.i64;
            break;
        case PhysicalType::F64:
            v.data_.i64 = data_.f64;
            break;
        case PhysicalType::STRING:
        case PhysicalType::STRING_VIEW:
            v.physical_type_ = PhysicalType::STRING_VIEW;
            v.data_str_ = data_str_;
            break;
    }
    return v;
}

// Copy a value
Value Value::CopyDeep() const {
    Value v;
    v.logical_type_ = logical_type_;
    v.physical_type_ = physical_type_;
    switch (v.physical_type_) {
        case PhysicalType::NULL_:
            break;
        case PhysicalType::I64:
            v.data_.i64 = data_.i64;
            break;
        case PhysicalType::F64:
            v.data_.i64 = data_.f64;
            break;
        case PhysicalType::STRING:
            v.physical_type_ = PhysicalType::STRING;
            v.data_str_buffer_ = data_str_buffer_;
            v.data_str_ = v.data_str_buffer_;
            break;
        case PhysicalType::STRING_VIEW:
            v.physical_type_ = PhysicalType::STRING;
            v.data_str_buffer_ = data_str_;
            v.data_str_ = v.data_str_buffer_;
            break;
    }
    return v;
}

// Pack as flatbuffer
flatbuffers::Offset<proto::webdb::SQLValue> Value::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    std::optional<flatbuffers::Offset<flatbuffers::String>> str = std::nullopt;
    if (!data_str_.empty()) str = builder.CreateString(data_str_);
    proto::webdb::SQLValueBuilder v{builder};
    v.add_type(&logical_type_);
    v.add_is_null(is_null());
    if (str) {
        v.add_data_str(*str);
    } else {
        v.add_data_u32(data_.i64);
        v.add_data_i64(data_.i64);
        v.add_data_f64(data_.f64);
    }
    return v.Finish();
}

// Unpack from flatbuffer
Value Value::UnPack(const proto::webdb::SQLValue& val) {
    Value v{*val.type()};
    if (val.is_null()) {
        return v;
    }
    using T = proto::webdb::SQLTypeID;
    switch (val.type()->type_id()) {
        case T::BOOLEAN:
        case T::DATE:
        case T::TIME:
            v.SetData(static_cast<int64_t>(val.data_u32()));
            break;
        case T::BIGINT:
        case T::TIMESTAMP:
        case T::DECIMAL:
            v.SetData(val.data_i64());
            break;
        case T::DOUBLE:
            v.SetData(val.data_f64());
            break;
        case T::VARCHAR:
            v.SetData(val.data_str()->string_view());
            break;
        default:
            break;
    }
    return v;
}

template <typename T> T ParseNumber(std::string_view sv) {
    imemstream in{sv.data(), sv.size()};
    T v;
    in >> v;
    return v;
}

// Parse a type
proto::webdb::SQLType Value::ParseType(std::string_view type) {
    using T = proto::webdb::SQLTypeID;
    static const std::unordered_map<std::string_view, T> TYPE_NAMES{
        {"NOTYPE", T::INVALID}, {"BOOLEAN", T::BOOLEAN},     {"BIGINT", T::BIGINT}, {"DATE", T::DATE},
        {"TIME", T::TIME},      {"TIMESTAMP", T::TIMESTAMP}, {"DOUBLE", T::DOUBLE}, {"VARCHAR", T::VARCHAR},
    };
    if (auto iter = TYPE_NAMES.find(type); iter != TYPE_NAMES.end()) {
        return proto::webdb::SQLType(iter->second, 0, 0);
    }
    std::string regex_buffer{type};

    static const std::regex decimal_regex{R"RGX(DECIMAL(?:\((\d+)(?:,(\d+))?\))?)RGX"};
    using svmatch = std::match_results<std::string_view::const_iterator>;
    using svsub_match = std::sub_match<std::string_view::const_iterator>;
    auto get_sv = [](const svsub_match& m) { return std::string_view(m.first, m.length()); };

    svmatch match;
    if (std::regex_match(type.begin(), type.end(), match, decimal_regex)) {
        int64_t width = 0;
        int64_t scale = 0;
        if (match.size() >= 1) width = ParseNumber<int64_t>(get_sv(match[0]));
        if (match.size() >= 2) scale = ParseNumber<int64_t>(get_sv(match[1]));
        return proto::webdb::SQLType(T::DECIMAL, width, scale);
    }
    return NOTYPE();
}

Value Value::Parse(std::string_view type_str, std::string_view value_str, bool string_refs) {
    auto type = ParseType(type_str);
    if (value_str == "NULL") {
        return Value{type};
    }
    using T = proto::webdb::SQLTypeID;
    switch (type.type_id()) {
        case T::BIGINT:
            return Value::BIGINT(ParseNumber<int64_t>(value_str));
        case T::DOUBLE:
            return Value::DOUBLE(ParseNumber<double>(value_str));
        case T::VARCHAR:
            return string_refs ? Value::VARCHAR(Ref, value_str) : Value::VARCHAR(std::string{value_str});
        case T::BOOLEAN:
        case T::DATE:
        case T::TIME:
        case T::TIMESTAMP:
        case T::DECIMAL:
            // XXX
            return Value::BIGINT(ParseNumber<int64_t>(value_str));
        default:
            break;
    }
    return Value{type};
}

// Create a boolean value from a specified value
Value Value::BOOLEAN(int8_t value) {
    Value result{proto::webdb::SQLTypeID::BOOLEAN};
    result.SetData(static_cast<int64_t>(value));
    return result;
}

// Create an integer value from a specified value
Value Value::BIGINT(int64_t value) {
    Value result{proto::webdb::SQLTypeID::BIGINT};
    result.SetData(value);
    return result;
}

// Create a date value from a specified date
Value Value::DATE(date_t date) {
    Value result{proto::webdb::SQLTypeID::DATE};
    result.SetData(static_cast<int64_t>(date));
    return result;
}

// Create a date value from a specified date
Value Value::DATE(int32_t year, int32_t month, int32_t day) {
    return Value::DATE(duckdb::Date::FromDate(year, month, day));
}

// Create a time value from a specified time
Value Value::TIME(dtime_t time) {
    Value result{proto::webdb::SQLTypeID::TIME};
    result.SetData(static_cast<int64_t>(time));
    return result;
}

// Create a time value from a specified time
Value Value::TIME(int32_t hour, int32_t min, int32_t sec, int32_t micros) {
    return Value::TIME(duckdb::Time::FromTime(hour, min, sec, micros));
}

// Create a timestamp value from a specified date/time combination
Value Value::TIMESTAMP(date_t date, dtime_t time) {
    return Value::TIMESTAMP(duckdb::Timestamp::FromDatetime(date, time));
}

// Create a timestamp value from a specified timestamp
Value Value::TIMESTAMP(timestamp_t timestamp) {
    Value result{proto::webdb::SQLTypeID::TIMESTAMP};
    result.SetData(static_cast<int64_t>(timestamp));
    return result;
}

// Create a timestamp value from a specified timestamp in separate values
Value Value::TIMESTAMP(int32_t year, int32_t month, int32_t day, int32_t hour, int32_t min, int32_t sec,
                       int32_t micros) {
    return Value::TIMESTAMP(duckdb::Timestamp::FromDatetime(duckdb::Date::FromDate(year, month, day),
                                                            duckdb::Time::FromTime(hour, min, sec, micros)));
}

// Decimal values
Value Value::DECIMAL(int64_t value, uint8_t width, uint8_t scale) {
    Value result{proto::webdb::SQLTypeID::TIMESTAMP};
    result.SetData(value);
    return result;
}
// Create a double value from a specified value
Value Value::DOUBLE(double value) {
    Value result{proto::webdb::SQLTypeID::DOUBLE};
    result.SetData(value);
    return result;
}
// Create a varchar from a string value
Value Value::VARCHAR(std::string value) {
    Value result{proto::webdb::SQLTypeID::VARCHAR};
    result.SetData(move(value));
    return result;
}
// Create a varchar from a string view
Value Value::VARCHAR(RefTag, std::string_view value) {
    Value result{proto::webdb::SQLTypeID::VARCHAR};
    result.SetData(value);
    return result;
}

}  // namespace dashql
