//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_TQL_CODEC_H_
#define INCLUDE_TIGON_PROTO_TQL_CODEC_H_

#include "duckdb.hpp"

#include "flatbuffers/flatbuffers.h"
#include "tigon/parser/tql/tql_syntax.h"
#include "tigon/proto/tql_generated.h"

namespace tigon {
namespace proto {

/// Write the tql program
flatbuffers::Offset<proto::TQLModule> writeTQLModule(flatbuffers::FlatBufferBuilder& builder, tql::Module& module);

} // namespace proto
} // namespace tigon

#endif // INCLUDE_TIGON_PROTO_TQL_CODEC_H_
