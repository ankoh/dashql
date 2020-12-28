#include "dashql/analyzer/syntax_schema.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/common/span.h"

namespace dashql {

NodeSchema NodeSchema::Object(sx::NodeType node, std::vector<NodeSchema> children, NodeSchema** ref) {
    std::sort(children.begin(), children.end(), [&](auto& l, auto& r) {
        return l.attribute_key < r.attribute_key;
    });
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::OBJECT,
        .node_type = node,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = move(children),
    };
}

NodeSchema NodeSchema::Object(sx::AttributeKey key, sx::NodeType node, std::vector<NodeSchema> children, NodeSchema** ref) {
    std::sort(children.begin(), children.end(), [&](auto& l, auto& r) {
        return l.attribute_key < r.attribute_key;
    });
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::OBJECT,
        .node_type = node,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = move(children),
    };
}

NodeSchema NodeSchema::Array(sx::AttributeKey key, std::vector<NodeSchema> children, NodeSchema** ref) {
    std::sort(children.begin(), children.end(), [&](auto& l, auto& r) {
        return l.attribute_key < r.attribute_key;
    });
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::ARRAY,
        .node_type = sx::NodeType::ARRAY,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = move(children),
    };
}

NodeSchema NodeSchema::String(sx::AttributeKey key, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::STRING,
        .node_type = sx::NodeType::NONE,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::String(NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::STRING,
        .node_type = sx::NodeType::NONE,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::Bool(sx::AttributeKey key, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::BOOL,
        .node_type = sx::NodeType::BOOL,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::Enum(sx::AttributeKey key, sx::NodeType type, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::ENUM,
        .node_type = type,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::UI32(sx::AttributeKey key, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::UI32,
        .node_type = sx::NodeType::UI32,
        .attribute_key = key,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}


}
