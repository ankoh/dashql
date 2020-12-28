// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SYNTAX_SCHEMA_H_
#define INCLUDE_DASHQL_ANALYZER_SYNTAX_SCHEMA_H_

#include "dashql/common/enum.h"
#include "dashql/proto_generated.h"
#include <iostream>
#include <variant>
#include <sstream>
#include <unordered_map>

namespace dashql {

namespace sx = proto::syntax;

/// A node spec type
enum NodeMatcherType {
    ARRAY,
    BOOL,
    ENUM,
    OBJECT,
    STRING,
    UI32,
};

/// A schema matching status
enum NodeSchemaMatching {
    MISSING,
    TYPE_MISMATCH,
    MATCHED,
};

/// A node schema
struct NodeSchema {
    /// The matching
    NodeSchemaMatching matching = NodeSchemaMatching::MISSING;
    /// The spec type
    NodeMatcherType node_spec = NodeMatcherType::OBJECT;
    /// The required node type
    sx::NodeType node_type = sx::NodeType::NONE;
    /// The attribute key
    sx::AttributeKey attribute_key = sx::AttributeKey::NONE;
    /// The node pointer
    NodeSchema** ref = nullptr;
    /// The node pointer
    const sx::Node* node = nullptr;
    /// The value (if any)
    std::variant<std::monostate, bool, uint32_t, std::string_view> value = std::monostate();
    /// The children (if any)
    std::vector<NodeSchema> children = {};

    /// Create an object
    static NodeSchema Object(sx::NodeType node, std::initializer_list<std::pair<sx::AttributeKey, NodeSchema>> children = {}, NodeSchema** ref = nullptr);
    /// Create an array
    static NodeSchema Array(std::initializer_list<NodeSchema> children = {}, NodeSchema** ref = nullptr);
    /// Create a string
    static NodeSchema String(NodeSchema** ref = nullptr);
    /// Create a boolean
    static NodeSchema Bool(NodeSchema** ref = nullptr);
    /// Create an enum
    static NodeSchema Enum(sx::NodeType type, NodeSchema** ref = nullptr);
    /// Create an integer
    static NodeSchema UI32(NodeSchema** ref = nullptr);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_SYNTAX_SCHEMA_H_
