// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEBAPI_JSON_H_
#define INCLUDE_DUCKDB_WEBAPI_JSON_H_

#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"

namespace duckdb_webapi {

/// Write the tql program
std::string writeJSON(void* buffer, const flatbuffers::TypeTable& type_table);

}  // namespace duckdb_webapi

#endif  // INCLUDE_DUCKDB_WEBAPI_PROTO_JSON_H_
