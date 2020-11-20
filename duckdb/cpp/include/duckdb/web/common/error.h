// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_ERROR_H_
#define INCLUDE_DUCKDB_WEB_ERROR_H_

#include <stdexcept>
#include <string>

namespace duckdb {
namespace web {

struct ParseError : std::exception {
    // Constructor
    explicit ParseError(const char* what): message_(what) {}
    // Constructor
    explicit ParseError(const std::string& what): message_(what) {}
    // Destructor
    virtual ~ParseError() throw() {}
    // Get error message
    virtual const char* what() const throw() {
        return message_.c_str();
    }

    protected:
    // Error message
    std::string message_;
};

} // namespace web
} // namespace duckdb

#endif // INCLUDE_DUCKDB_WEB_ERROR_H_
