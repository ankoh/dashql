// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_VIZ_SPEC_H_
#define INCLUDE_DASHQL_ANALYZER_VIZ_SPEC_H_

#include "dashql/proto_generated.h"

namespace dashql {
namespace viz {

namespace sx = proto::syntax;

struct Position {
    size_t row;
    size_t column;
    size_t width;
    size_t height;
};

struct VizSpec {
    /// The statement id
    size_t statement_id_;
    /// The position
    Position position;

    /// Pack the viz spec
    flatbuffers::Offset<proto::viz::VizSpec> Pack(flatbuffers::FlatBufferBuilder& builder) const;
};

}  // namespace viz
}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
