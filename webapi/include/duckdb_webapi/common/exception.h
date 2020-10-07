// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_COMMON_EXCEPTION_H_
#define INCLUDE_DUCKDB_WEBAPI_COMMON_EXCEPTION_H_

#include <exception>
#include <string>
#include <vector>
#include <sstream>

namespace duckdb_webapi {

/// An exception type
enum class ExceptionType {
    UNSPECIFIED = 0,
    CONVERSION = 1,
    NOT_IMPLEMENTED = 2,
};

/// End-of-exception tag
enum EOETag {
    EOE
};

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

/// An exception message builder
struct ExceptionBuilder {
    /// The exception type
    ExceptionType type;
    /// The stringstream
    std::stringstream message;
    /// Constructor
    ExceptionBuilder(ExceptionType t = ExceptionType::UNSPECIFIED) : type(t), message() {}
    /// Constructor
    ExceptionBuilder(const ExceptionBuilder& other) : type(other.type), message(other.message.str()) {}
    /// Stream operator
    template <typename V> 
    ExceptionBuilder& operator<<(const V& v) { message << v; return *this; }
    /// Stream operator
    Exception operator<<(EOETag) { return Exception{type, message.str()}; }
    /// Get the string
    std::string str() { return message.str(); }
};

} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_EXCEPTION_H_

