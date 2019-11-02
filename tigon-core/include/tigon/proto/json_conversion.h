//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_JSON_CONVERSION_H_
#define INCLUDE_TIGON_PROTO_JSON_CONVERSION_H_

#include "duckdb.hpp"

#include "flatbuffers/flatbuffers.h"
#include "tigon/parser/tql/tql_syntax.h"
#include "tigon/proto/tql_generated.h"

namespace tigon {
namespace proto {

/// Write the tql program
std::string writeJSON(void* buffer, const flatbuffers::TypeTable& type_table);

} // namespace proto
} // namespace tigon

#endif // INCLUDE_TIGON_PROTO_JSON_CONVERSION_H_
