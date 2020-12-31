// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/value.h"

#include <iomanip>
#include <regex>
#include <sstream>

#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"

namespace dashql {
namespace webdb {

static proto::webdb::SQLType SQLNULL() { return proto::webdb::SQLType(proto::webdb::SQLTypeID::SQLNULL, 0, 0); }

Value::Value() : type_(SQLNULL()), data_(std::monostate{}) {}

Value::Value(proto::webdb::SQLType type) : type_(type), data_(std::monostate{}) {}

Value::Value(const proto::webdb::Value& val) : type_(val.type() ? *val.type() : SQLNULL()) {
    if (val.is_null()) {
        data_ = std::monostate{};
    } else {
        using T = proto::webdb::SQLTypeID;
        switch (type_.type_id()) {
            case T::INVALID:
            case T::UNKNOWN:
            case T::SQLNULL:
                data_ = std::monostate{};
                break;

            case T::BOOLEAN:
            case T::DATE:
            case T::TIME:
                data_ = val.data_u32();
                break;

            case T::TINYINT:
            case T::SMALLINT:
            case T::INTEGER:
            case T::BIGINT:
            case T::TIMESTAMP:
            case T::INTERVAL:
            case T::DECIMAL:
                data_ = val.data_i64();
                break;

            case T::FLOAT:
            case T::DOUBLE:
                data_ = val.data_f64();
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
                data_ = val.data_str()->string_view();
                break;
        }
    }
}

/// Get the value as integer
int64_t Value::DataAsI64() const {
    auto parse = [](std::string_view s) {
        int64_t v;
        imemstream ss{s.data(), s.size()};
        ss >> v;
        return v;
    };
    // clang-format off
    return std::visit(overload {
        [](int64_t v) { return v; },
        [](double v) { return static_cast<int64_t>(v); },
        [parse](std::string_view v) { return parse(v); },
        [parse](std::string& v) { return parse(v); },
        [](std::monostate v) { return static_cast<int64_t>(0); }
    }, data_);
    // clang-format on
}

/// Get the value as double
double Value::DataAsF64() const {
    auto parse = [](std::string_view s) {
        double v;
        imemstream ss{s.data(), s.size()};
        ss >> v;
        return v;
    };
    // clang-format off
    return std::visit(overload {
        [](int64_t v) { return static_cast<double>(v); },
        [](double v) { return v; },
        [parse](std::string_view v) { return parse(v); },
        [parse](std::string& v) { return parse(v); },
        [](std::monostate v) { return static_cast<double>(0); }
    }, data_);
    // clang-format on
}

/// Get the value as string ref
std::string_view Value::DataAsStringView() const {
    // clang-format off
    return std::visit(overload {
        [](int64_t v) { return std::string_view{""}; },
        [](double v) { return std::string_view{""}; },
        [](std::string_view v) { return v; },
        [](std::string& v) { return std::string_view{v}; },
        [](std::monostate v) { return std::string_view{""}; }
    }, data_);
    // clang-format on
}

/// Get the value as string
std::string Value::DataAsString() const {
    // clang-format off
    return std::visit(overload {
        [](int64_t v) { return std::to_string(v); },
        [](double v) { return std::to_string(v); },
        [](std::string_view v) { return std::string{v}; },
        [](std::string& v) { return v; },
        [](std::monostate v) { return std::string{""}; }
    }, data_);
    // clang-format off
}

/// Print as script text
void Value::PrintValue(std::ostream& out) const {
    switch (type_.type_id()) {
        case proto::webdb::SQLTypeID::INTEGER:
            out << DataAsI64();
            break;
        case proto::webdb::SQLTypeID::FLOAT:
        case proto::webdb::SQLTypeID::DOUBLE:
            out << DataAsF64();
            break;
        default:
            // clang-format off
            std::visit(overload {
                [&](int64_t v) { out << '\'' << v << '\''; },
                [&](double v) { out << '\'' << v << '\''; },
                [&](std::string_view v) { out << std::quoted(v, '\''); },
                [&](std::string& v) { out << std::quoted(v, '\''); },
                [](std::monostate v) {}
            }, data_);
            // clang-format on
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
    }(type().type_id());
    out << type_name;
    if (type().type_id() == T::DECIMAL) {
        out << "(" << type().width() << "," << type().scale() << ")";
    }
}

/// Print the type
std::string Value::PrintType() const {
    std::stringstream ss;
    PrintType(ss);
    return ss.str();
}

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
