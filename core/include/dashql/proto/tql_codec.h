//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PROTO_TQL_CODEC_H_
#define INCLUDE_TIGON_PROTO_TQL_CODEC_H_

#include "dashql/parser/tql/tql_syntax.h"
#include "dashql/proto/tql.pb.h"
#include "google/protobuf/arena.h"

namespace dashql {

    /// Write the tql program
    proto::tql::Module* encodeTQLModule(google::protobuf::Arena& arena, tql::Module& module);

} // namespace dashql

#endif // INCLUDE_TIGON_PROTO_TQL_CODEC_H_
