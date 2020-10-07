// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_VALUE_OPS_H_
#define INCLUDE_DUCKDB_WEBAPI_VALUE_OPS_H_

#include "duckdb_webapi/value.h"

namespace duckdb_webapi {

struct ValueOperations {
    // A + B
    static Value Add(const Value &left, const Value &right);
    // A - B
    static Value Subtract(const Value &left, const Value &right);
    // A * B
    static Value Multiply(const Value &left, const Value &right);
    // A / B
    static Value Divide(const Value &left, const Value &right);
    // A % B
    static Value Modulo(const Value &left, const Value &right);

    // A == B
    static bool Equals(const Value &left, const Value &right);
    // A != B
    static bool NotEquals(const Value &left, const Value &right);
    // A > B
    static bool GreaterThan(const Value &left, const Value &right);
    // A >= B
    static bool GreaterThanEquals(const Value &left, const Value &right);
    // A < B
    static bool LessThan(const Value &left, const Value &right);
    // A <= B
    static bool LessThanEquals(const Value &left, const Value &right);

    // result = HASH(A)
    static hash_t Hash(const Value &left);
};

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_VALUE_OPS_H_
