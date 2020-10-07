// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/proto/value_generated.h"

namespace duckdb_webapi {

/// Constructor
Exception::Exception(std::string m) : std::exception(), type_(ExceptionType::UNSPECIFIED), message_(move(m)) {}
/// Constructor
Exception::Exception(ExceptionType t, std::string m) : std::exception(), type_(t) {
    auto prefix = [](ExceptionType t) {
        switch (t) {
        case ExceptionType::UNSPECIFIED:
            return "Unspecified";
        case ExceptionType::CONVERSION:
            return "Conversion";
        case ExceptionType::NOT_IMPLEMENTED:
            return "Not implemented";
        default:
            return "Unknown";
        }
    }(t);
    message_ = std::string{prefix} + ": " + m;
}
/// Get exception message
const char *Exception::what() const noexcept { return message_.c_str(); }

} // namespace duckdb_webapi
