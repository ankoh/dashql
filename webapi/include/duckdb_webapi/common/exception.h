// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_COMMON_EXCEPTION_H_
#define INCLUDE_DUCKDB_WEBAPI_COMMON_EXCEPTION_H_

#include <exception>
#include <sstream>
#include <string>
#include <vector>

namespace duckdb_webapi {

/// An exception type
enum class ExceptionType {
    UNSPECIFIED = 0,
    CONVERSION = 1,
    NOT_IMPLEMENTED = 2,
    OUT_OF_RANGE = 3,
};

/// End-of-exception tag
enum EOETag { EOE };

/// An exception
class Exception : public std::exception {
   private:
    /// The exception type
    ExceptionType type_;
    // The exception message
    std::string message_;

   public:
    /// Constructor
    Exception(std::string message);
    /// Constructor
    Exception(ExceptionType exceptionType, std::string message);
    /// Get message
    const char* what() const noexcept override;
};

/// An exception message builder
struct ExceptionBuilder {
    /// The exception type
    ExceptionType type_;
    /// The stringstream
    std::stringstream message_;
    /// Constructor
    ExceptionBuilder(ExceptionType t = ExceptionType::UNSPECIFIED) : type_(t), message_() {}
    /// Constructor
    ExceptionBuilder(const ExceptionBuilder& other) : type_(other.type_), message_(other.message_.str()) {}
    /// Stream operator
    template <typename V> ExceptionBuilder& operator<<(const V& v) {
        message_ << v;
        return *this;
    }
    /// Stream operator
    Exception operator<<(EOETag) { return Exception{type_, message_.str()}; }
    /// Get the string
    std::string str() { return message_.str(); }
};

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_EXCEPTION_H_

