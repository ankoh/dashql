#include "dashql/analyzer/syntax_schema.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/common/span.h"

namespace dashql {

NodeSchema NodeSchema::Object(sx::NodeType node, std::initializer_list<std::pair<sx::AttributeKey, NodeSchema>> attributes, NodeSchema** ref) {
    std::vector<NodeSchema> children;
    children.reserve(attributes.size());
    for (auto& [key, schema]: attributes) {
        children.push_back(std::move(schema));
        children.back().attribute_key = key;
    }
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

NodeSchema NodeSchema::Array(std::initializer_list<NodeSchema> children, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::ARRAY,
        .node_type = sx::NodeType::ARRAY,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = std::vector<NodeSchema>{children},
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

NodeSchema NodeSchema::Bool(NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::BOOL,
        .node_type = sx::NodeType::BOOL,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::Enum(sx::NodeType type, NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::ENUM,
        .node_type = type,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}

NodeSchema NodeSchema::UI32(NodeSchema** ref) {
    return {
        .matching = NodeSchemaMatching::MISSING,
        .node_spec = NodeMatcherType::UI32,
        .node_type = sx::NodeType::UI32,
        .attribute_key = sx::AttributeKey::NONE,
        .ref = ref,
        .node = nullptr,
        .value = std::monostate(),
        .children = {},
    };
}


}
