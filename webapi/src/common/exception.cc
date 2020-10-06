// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/proto/value_generated.h"

namespace duckdb_webapi {

/// Constructor
Exception::Exception(std::string m) : std::exception(), type(ExceptionType::INVALID), message(move(m)) {}
/// Constructor
Exception::Exception(ExceptionType t, std::string m) : std::exception(), type(t) {
    auto prefix = [](ExceptionType t) {
        switch (t) {
        case ExceptionType::INVALID:
            return "Invalid";
        case ExceptionType::CONVERSION:
            return "Conversion";
        case ExceptionType::NOT_IMPLEMENTED:
            return "Not implemented";
        default:
            return "Unknown";
        }
    }(t);
    message = std::string{prefix} + ": " + m;
}
/// Get exception message
const char *Exception::what() const noexcept { return message.c_str(); }

/// Conversion exception
ConversionException::ConversionException(std::string m) : Exception(ExceptionType::CONVERSION, move(m)) {}
/// Not implemented exception
NotImplementedException::NotImplementedException(std::string m) : Exception(ExceptionType::NOT_IMPLEMENTED, move(m)) {}

} // namespace duckdb_webapi
