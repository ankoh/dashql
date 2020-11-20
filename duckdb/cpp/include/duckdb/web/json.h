// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DUCKDB_WEB_JSON_H_
#define INCLUDE_DUCKDB_WEB_JSON_H_

#include "duckdb.hpp"
#include "flatbuffers/flatbuffers.h"

namespace duckdb {
namespace web {

/// Write the tql program
std::string writeJSON(void* buffer, const flatbuffers::TypeTable& type_table);

}  // namespace web
}  // namespace duckdb

#endif  // INCLUDE_DUCKDB_WEB_PROTO_JSON_H_
