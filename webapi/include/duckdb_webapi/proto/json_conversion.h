// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_PROTO_JSON_CONVERSION_H_
#define INCLUDE_DUCKDB_WEBAPI_PROTO_JSON_CONVERSION_H_

#include "duckdb.hpp"

#include "flatbuffers/flatbuffers.h"

namespace duckdb_webapi {
namespace proto {

/// Write the tql program
std::string writeJSON(void* buffer, const flatbuffers::TypeTable& type_table);

} // namespace proto
} // namespace duckdb_webapi

#endif // INCLUDE_DUCKDB_WEBAPI_PROTO_JSON_CONVERSION_H_
