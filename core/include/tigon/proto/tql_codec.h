//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_TQL_CODEC_H_
#define INCLUDE_TIGON_PROTO_TQL_CODEC_H_

#include "google/protobuf/arena.h"
#include "tigon/parser/tql/tql_syntax.h"
#include "tigon/proto/tql.pb.h"

namespace tigon {

/// Write the tql program
proto::tql::Module* encodeTQLModule(google::protobuf::Arena& arena, tql::Module& module);

} // namespace tigon

#endif // INCLUDE_TIGON_PROTO_TQL_CODEC_H_
