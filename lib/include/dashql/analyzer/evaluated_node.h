// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_EVALUATED_NODE_H_
#define INCLUDE_DASHQL_ANALYZER_EVALUATED_NODE_H_

#include <iostream>
#include <sstream>
#include <unordered_map>
#include <vector>
#include <optional>
#include <tuple>

#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/common/union_find.h"
#include "dashql/analyzer/value.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// An evaluated node
struct EvaluatedNode {
    /// The node id
    size_t node_id;
    /// The value
    std::optional<Value> value;

    /// Pack the evaluated node
    flatbuffers::Offset<proto::analyzer::EvaluatedNode> Pack(flatbuffers::FlatBufferBuilder& builder) const;
};

}

#endif
