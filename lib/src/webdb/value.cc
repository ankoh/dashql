// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/value.h"

#include <iomanip>
#include <regex>
#include <sstream>

#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"

namespace dashql {
namespace webdb {

namespace {

proto::webdb::SQLType SQLNULL() { return proto::webdb::SQLType(proto::webdb::SQLTypeID::SQLNULL, 0, 0); }

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
Value::Value() : sql_type_(SQLNULL()), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {
    data_.i64 = 0;
}

Value::Value(proto::webdb::SQLType type) : sql_type_(type), physical_type_(PhysicalType::NULL_), data_str_buffer_(), data_str_() {
    data_.i64 = 0;
}

Value::Value(const proto::webdb::Value& val) : sql_type_(val.type() ? *val.type() : SQLNULL()), data_str_buffer_(), data_str_()  {
    if (!val.is_null()) {
        using T = proto::webdb::SQLTypeID;
        switch (sql_type_.type_id()) {
            case T::INVALID:
            case T::UNKNOWN:
            case T::SQLNULL:
                break;

            case T::BOOLEAN:
            case T::DATE:
            case T::TIME:
                SetData(static_cast<int64_t>(val.data_u32()));
                break;

            case T::TINYINT:
            case T::SMALLINT:
            case T::INTEGER:
            case T::BIGINT:
            case T::TIMESTAMP:
            case T::INTERVAL:
            case T::DECIMAL:
                SetData(val.data_i64());
                break;

            case T::FLOAT:
            case T::DOUBLE:
                SetData(val.data_f64());
                break;

            case T::ANY:
            case T::CHAR:
            case T::VARCHAR:
            case T::VARBINARY:
            case T::BLOB:
            case T::HUGEINT:
            case T::POINTER:
            case T::HASH:
            case T::STRUCT:
            case T::LIST:
                SetData(val.data_str()->string_view());
                break;
        }
    }
}

/// Print as script text
void Value::PrintValue(std::ostream& out) const {
    switch (sql_type_.type_id()) {
        case proto::webdb::SQLTypeID::INTEGER:
            out << data_.i64;
            break;
        case proto::webdb::SQLTypeID::FLOAT:
        case proto::webdb::SQLTypeID::DOUBLE:
            out << data_.f64;
            break;
        default:
            out << '\'' << data_str_ << '\'';
            break;
    }
}

/// Print the type
void Value::PrintType(std::ostream& out) const {
    using T = proto::webdb::SQLTypeID;
    const char* type_name = [](T tid) {
        // clang-format off
        switch (tid) {
            case T::INVALID: return "INVALID";
            case T::SQLNULL: return "SQLNULL";
            case T::UNKNOWN: return "UNKNOWN";
            case T::ANY: return "ANY";
            case T::BOOLEAN: return "BOOLEAN";
            case T::TINYINT: return "TINYINT";
            case T::SMALLINT: return "SMALLINT";
            case T::INTEGER: return "INTEGER";
            case T::BIGINT: return "BIGINT";
            case T::DATE: return "DATE";
            case T::TIME: return "TIME";
            case T::TIMESTAMP: return "TIMESTAMP";
            case T::DECIMAL: return "DECIMAL";
            case T::FLOAT: return "FLOAT";
            case T::DOUBLE: return "DOUBLE";
            case T::CHAR: return "CHAR";
            case T::VARCHAR: return "VARCHAR";
            case T::VARBINARY: return "VARBINARY";
            case T::BLOB: return "BLOB";
            case T::INTERVAL: return "INTERVAL";
            case T::HUGEINT: return "HUGEINT";
            case T::POINTER: return "POINTER";
            case T::HASH: return "HASH";
            case T::STRUCT: return "STRUCT";
            case T::LIST: return "LIST";
                // clang-format on
        }
    }(sql_type_.type_id());
    out << type_name;
    if (sql_type_.type_id() == T::DECIMAL) {
        out << "(" << sql_type_.width() << "," << sql_type_.scale() << ")";
    }
}

/// Print the type
std::string Value::PrintType() const {
    std::stringstream ss;
    PrintType(ss);
    return ss.str();
}

/// Parse a type
proto::webdb::SQLType Value::ParseType(std::string_view type) {
    using T = proto::webdb::SQLTypeID;
    static std::unordered_map<std::string_view, T> TYPE_NAMES{
        {"INVALID", T::INVALID},     {"SQLNULL", T::SQLNULL}, {"UNKNOWN", T::UNKNOWN},   {"ANY", T::ANY},
        {"BOOLEAN", T::BOOLEAN},     {"TINYINT", T::TINYINT}, {"SMALLINT", T::SMALLINT}, {"INTEGER", T::INTEGER},
        {"BIGINT", T::BIGINT},       {"DATE", T::DATE},       {"TIME", T::TIME},         {"TIMESTAMP", T::TIMESTAMP},
        {"FLOAT", T::FLOAT},         {"DOUBLE", T::DOUBLE},   {"CHAR", T::CHAR},         {"VARCHAR", T::VARCHAR},
        {"VARBINARY", T::VARBINARY}, {"BLOB", T::BLOB},       {"INTERVAL", T::INTERVAL}, {"HUGEINT", T::HUGEINT},
        {"POINTER", T::POINTER},     {"HASH", T::HASH},       {"STRUCT", T::STRUCT},     {"LIST", T::LIST},
    };
    if (auto iter = TYPE_NAMES.find(type); iter != TYPE_NAMES.end()) {
        return proto::webdb::SQLType(iter->second, 0, 0);
    }
    std::string regex_buffer{type};

    static const std::regex decimal_regex{R"RGX(DECIMAL(?:\((\d+)(?:,(\d+))?\))?)RGX"};
    using svmatch = std::match_results<std::string_view::const_iterator>;
    using svsub_match = std::sub_match<std::string_view::const_iterator>;
    auto get_sv = [](const svsub_match& m) { return std::string_view(m.first, m.length()); };

    auto parse_int = [](std::string_view sv) {
        imemstream in{sv.data(), sv.size()};
        int64_t v;
        in >> v;
        return v;
    };
    svmatch match;
    if (std::regex_match(type.begin(), type.end(), match, decimal_regex)) {
        int64_t width = 0;
        int64_t scale = 0;
        if (match.size() >= 1) width = parse_int(get_sv(match[0]));
        if (match.size() >= 2) scale = parse_int(get_sv(match[1]));
        return proto::webdb::SQLType(T::DECIMAL, width, scale);
    }
    return SQLNULL();
}

}  // namespace webdb
}  // namespace dashql
