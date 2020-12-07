// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_EXPECTED_H_
#define INCLUDE_DASHQL_COMMON_EXPECTED_H_

#include <variant>

#include "duckdb/web/common/expected.h"

namespace dashql {

using ErrorCode = duckdb::web::ErrorCode;
using Error = duckdb::web::Error;
template <typename Fn>
using ErrorBuilder = duckdb::web::ErrorBuilder<Fn>;
template <typename V>
using Expected = duckdb::web::Expected<V>;
using Signal = duckdb::web::Signal;
template <typename V>
using ExpectedBuffer = duckdb::web::ExpectedBuffer<V>;

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_EXPECTED_H_

