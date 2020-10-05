// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_ERROR_H_
#define INCLUDE_DUCKDB_WEBAPI_ERROR_H_

#include "duckdb.hpp"
#include "duckdb/common/enums/logical_operator_type.hpp"

#include "flatbuffers/flatbuffers.h"
#include "duckdb_webapi/proto/query_result_generated.h"
#include "duckdb_webapi/common/span.h"

namespace duckdb_webapi {

enum class ErrorCode {
    TABLEGEN_INVALID_INPUT_INDEX,
    TABLEGEN_CIRCULAR_DEPENDENCY
};

struct Error {
    /// The error code
    ErrorCode code;
    /// Constructor
    Error(ErrorCode code)
        : code(code) {}
};


} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_ERROR_H_

