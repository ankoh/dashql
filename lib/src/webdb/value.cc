// Copyright (c) 2020 The DashQL Authors

#include "dashql/webdb/value.h"
#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"
#include <iomanip>

namespace dashql {
namespace webdb {

/// Get the value as integer
int64_t Value::DataAsI64() const {
    auto parse = [](std::string_view s) {
        int64_t v;
        imemstream ss{s.data(), s.size()};
        ss >> v;
        return v;
    };
    return std::visit(overload {
        [](int64_t v) { return v; },
        [](double v) { return static_cast<int64_t>(v); },
        [parse](std::string_view v) { return parse(v); },
        [parse](std::string& v) { return parse(v); },
        [](std::monostate v) { return static_cast<int64_t>(0); }
    }, data_);
}

/// Get the value as double
double Value::DataAsF64() const {
    auto parse = [](std::string_view s) {
        double v;
        imemstream ss{s.data(), s.size()};
        ss >> v;
        return v;
    };
    return std::visit(overload {
        [](int64_t v) { return static_cast<double>(v); },
        [](double v) { return v; },
        [parse](std::string_view v) { return parse(v); },
        [parse](std::string& v) { return parse(v); },
        [](std::monostate v) { return static_cast<double>(0); }
    }, data_);
}

/// Get the value as string ref
std::string_view Value::DataAsStringView() const {
    return std::visit(overload {
        [](int64_t v) { return std::string_view{""}; },
        [](double v) { return std::string_view{""}; },
        [](std::string_view v) { return v; },
        [](std::string& v) { return std::string_view{v}; },
        [](std::monostate v) { return std::string_view{""}; }
    }, data_);
}


/// Get the value as string
std::string Value::DataAsString() const {
    return std::visit(overload {
        [](int64_t v) { return std::to_string(v); },
        [](double v) { return std::to_string(v); },
        [](std::string_view v) { return std::string{v}; },
        [](std::string& v) { return v; },
        [](std::monostate v) { return std::string{""}; }
    }, data_);
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
            std::visit(overload {
                [&](int64_t v) { out << '\'' << v << '\''; },
                [&](double v) { out << '\'' << v << '\''; },
                [&](std::string_view v) { out << std::quoted(v, '\''); },
                [&](std::string& v) { out << std::quoted(v, '\''); },
                [](std::monostate v) {}
            }, data_);
            break;
    }
}


}}
