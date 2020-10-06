// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_COMMON_EXPECTED_H_
#define INCLUDE_DUCKDB_WEBAPI_COMMON_EXPECTED_H_

#include <exception>
#include <string>
#include <vector>
#include <sstream>

namespace duckdb_webapi {

/// An exception type
enum class ExceptionType {
    INVALID = 0,
    CONVERSION = 1,
    NOT_IMPLEMENTED = 2,
};

/// An exception format value type
enum class ExceptionFormatValueType : uint8_t {
    FORMAT_VALUE_TYPE_DOUBLE,
    FORMAT_VALUE_TYPE_INTEGER,
    FORMAT_VALUE_TYPE_STRING
};

/// An exception format value
struct ExceptionFormatValue {
    ExceptionFormatValue(double dbl_val) : type(ExceptionFormatValueType::FORMAT_VALUE_TYPE_DOUBLE), dbl_val(dbl_val) {}
    ExceptionFormatValue(int64_t int_val)
        : type(ExceptionFormatValueType::FORMAT_VALUE_TYPE_INTEGER), int_val(int_val) {}
    ExceptionFormatValue(std::string str_val)
        : type(ExceptionFormatValueType::FORMAT_VALUE_TYPE_STRING), str_val(str_val) {}

    ExceptionFormatValueType type;

    double dbl_val;
    int64_t int_val;
    std::string str_val;

    template <class T> static ExceptionFormatValue CreateFormatValue(T value) { return int64_t(value); }
};

template <> ExceptionFormatValue ExceptionFormatValue::CreateFormatValue(float value);
template <> ExceptionFormatValue ExceptionFormatValue::CreateFormatValue(double value);
template <> ExceptionFormatValue ExceptionFormatValue::CreateFormatValue(std::string value);
template <> ExceptionFormatValue ExceptionFormatValue::CreateFormatValue(const char *value);
template <> ExceptionFormatValue ExceptionFormatValue::CreateFormatValue(char *value);

/// Inline exception message
static inline auto emsg() { return std::stringstream{}; }

/// An exception
class Exception : public std::exception {
  private:
    /// The exception type
    ExceptionType type;
    // The exception message
    std::string message;

  public:
    /// Constructor
    Exception(std::string message);
    /// Constructor
    Exception(ExceptionType exceptionType, std::string message);
    /// Get message
    const char *what() const noexcept override;
};

/// A conversion exception
struct ConversionException : public Exception {
    /// Constructor
    ConversionException(std::string message);
    /// Constructor
    ConversionException(std::stringstream message)
        : ConversionException(message.str()) {}
};

/// A not-implemented exception
struct NotImplementedException : public Exception {
    /// Constructor
    NotImplementedException(std::string message);
    /// Constructor
    NotImplementedException(std::stringstream message)
        : NotImplementedException(message.str()) {}
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_EXPECTED_H_

