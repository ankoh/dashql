// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/value.h"

#include <iomanip>
#include <regex>
#include <sstream>

#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"

#include "duckdb/common/types/decimal.hpp"
#include "duckdb/common/types/date.hpp"
#include "duckdb/common/types/time.hpp"
#include "duckdb/common/types/timestamp.hpp"
#include "duckdb/common/types/interval.hpp"

namespace dashql {

namespace {

proto::analyzer::ValueType NOTYPE() { return proto::analyzer::ValueType(proto::analyzer::ValueTypeID::NONE, 0, 0); }

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
    data_str_ = data_str_buffer_;
}

// Set string view value
void Value::SetData(std::string_view value) {
    physical_type_ = PhysicalType::STRING_VIEW;
    data_str_ = value;
}
Value::Value() : logical_type_(NOTYPE()), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {
}

Value::Value(proto::analyzer::ValueType type) : logical_type_(type), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {
}

Value::Value(const proto::analyzer::Value& val) : logical_type_(val.type() ? *val.type() : NOTYPE()), data_str_buffer_(), data_str_()  {
    if (val.is_null()) {
        return;
    }
    using T = proto::analyzer::ValueTypeID;
    switch (logical_type_.type_id()) {
        case T::NONE:
            break;
        case T::BOOLEAN:
        case T::DATE:
        case T::TIME:
            SetData(static_cast<int64_t>(val.data_u32()));
            break;
        case T::BIGINT:
        case T::TIMESTAMP:
        case T::INTERVAL:
        case T::DECIMAL:
            SetData(val.data_i64());
            break;
        case T::DOUBLE:
            SetData(val.data_f64());
            break;
        case T::VARCHAR:
            SetData(val.data_str()->string_view());
            break;
    }
}

/// Print as script text
void Value::PrintValue(std::ostream& out) const {
    using T = proto::analyzer::ValueTypeID;
    switch (logical_type_.type_id()) {
        case T::NONE:
            out << "NULL";
            break;
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
        case T::INTERVAL:
            out << "[]";
            // XXX
            break;
        case T::DECIMAL:
            out << duckdb::Decimal::ToString(data_.i64, logical_type_.scale());
            break;
        case T::VARCHAR:
            out << data_str_;
            break;
    }
}

/// Print the type
void Value::PrintType(std::ostream& out) const {
    using T = proto::analyzer::ValueTypeID;
    const char* type_name = [](T tid) {
        // clang-format off
        switch (tid) {
            case T::NONE: return "NONE";
            case T::BOOLEAN: return "BOOLEAN";
            case T::BIGINT: return "BIGINT";
            case T::DATE: return "DATE";
            case T::TIME: return "TIME";
            case T::TIMESTAMP: return "TIMESTAMP";
            case T::DECIMAL: return "DECIMAL";
            case T::DOUBLE: return "DOUBLE";
            case T::VARCHAR: return "VARCHAR";
            case T::INTERVAL: return "INTERVAL";
        }
        // clang-format on
    }(logical_type_.type_id());
    out << type_name;
    if (logical_type_.type_id() == T::DECIMAL) {
        out << "(" << logical_type_.width() << "," << logical_type_.scale() << ")";
    }
}

/// Print the type
std::string Value::PrintType() const {
    std::stringstream ss;
    PrintType(ss);
    return ss.str();
}

template<typename T>
T ParseNumber(std::string_view sv) {
    imemstream in{sv.data(), sv.size()};
    T v;
    in >> v;
    return v;
}

/// Parse a type
proto::analyzer::ValueType Value::ParseType(std::string_view type) {
    using T = proto::analyzer::ValueTypeID;
    static std::unordered_map<std::string_view, T> TYPE_NAMES{
        {"NOTYPE", T::NONE},
        {"BOOLEAN", T::BOOLEAN},     
        {"BIGINT", T::BIGINT},       {"DATE", T::DATE},       {"TIME", T::TIME},         {"TIMESTAMP", T::TIMESTAMP},
        {"DOUBLE", T::DOUBLE},   {"VARCHAR", T::VARCHAR},
        {"INTERVAL", T::INTERVAL},
    };
    if (auto iter = TYPE_NAMES.find(type); iter != TYPE_NAMES.end()) {
        return proto::analyzer::ValueType(iter->second, 0, 0);
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
        return proto::analyzer::ValueType(T::DECIMAL, width, scale);
    }
    return NOTYPE();
}

Value Value::Parse(std::string_view type_str, std::string_view value_str, bool string_refs) {
    auto type = ParseType(type_str);
    if (value_str == "NULL") {
        return Value{type};
    }
    using T = proto::analyzer::ValueTypeID;
    switch (type.type_id()) {
        case T::NONE:
            break;

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
        case T::INTERVAL:
        case T::DECIMAL:
            // XXX
            return Value::BIGINT(ParseNumber<int64_t>(value_str));
    }
    return Value{type};
}

}  // namespace dashql
