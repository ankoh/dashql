// Copyright (c) 2020 The DashQL Authors

#include <string_view>
#include <optional>
#include <iostream>

#include "dashql/parser/common/variant.h"
#include "dashql/parser/module_builder.h"

using namespace std;
namespace fb = flatbuffers;

namespace dashql {
namespace parser {

/// Syntactic sugar to set the key of a node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node) {
    return sx::Node(node.location(), node.node_type(), key, node.children_begin_or_value(), node.children_count());
}

/// Syntactic sugar concatenate vectors
NodeVector& operator<<(NodeVector& attrs, const sx::Node& node) {
    attrs.push_back(node);
    return attrs;
}

/// Syntactic sugar concatenate vectors
NodeVector& operator<<(NodeVector& attrs, NodeVector&& other) {
    for (auto& node: other) {
        attrs.push_back(node);
    }
    return attrs;
}

/// Constructor
ModuleBuilder::ModuleBuilder()
    : _statements(), _errors() {}

/// Add an array
sx::Node ModuleBuilder::Add(sx::Location loc, NodeVector&& values, bool null_if_empty) {
    auto begin = _nodes.size();
    _nodes.reserve(_nodes.size() + values.size());
    for (auto& v: values) {
        if (v.node_type() != sx::NodeType::NONE) {
            _nodes.push_back(v);
        }
    }
    auto n = _nodes.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    return sx::Node(loc, sx::NodeType::ARRAY, sx::AttributeKey::NONE, begin, n);
}

/// Add an object
sx::Node ModuleBuilder::Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty) {
    auto begin = _nodes.size();
    _nodes.reserve(_nodes.size() + attrs.size());
    for (auto& v: attrs) {
        if (v.node_type() != sx::NodeType::NONE) {
            _nodes.push_back(v);
        }
    }
    auto n = _nodes.size() - begin;
    if ((n == 0) && null_if_empty) {
        return Null();
    }
    return sx::Node(loc, type, sx::AttributeKey::NONE, begin, n);
}

/// Add an object
NodeVector ModuleBuilder::CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attrs) {
    auto type_val = RefEnum(viz_loc, viz_type);
    auto type_attr = sx::AttributeKey::DASHQL_VIZ_TYPE << type_val;
    NodeVector result{type_attr};
    for (auto& as: attrs) {
        for (auto& a: as.get()) {
            result.push_back(a);
        }
    }
    return result;
}

/// Write the module
fb::Offset<sx::Module> ModuleBuilder::Write(fb::FlatBufferBuilder& builder) {
    std::vector<fb::Offset<sx::Error>> errs;
    for (auto [loc, msg]: _errors) {
        auto s = builder.CreateString(msg.data(), msg.length());
        sx::ErrorBuilder eb{builder};
        eb.add_location(&loc);
        eb.add_message(s);
        errs.push_back(eb.Finish());
    }
    auto nodes_vec = builder.CreateVectorOfStructs(_nodes);
    auto statements_vec = builder.CreateVector(_statements);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_line_breaks);
    auto comments_vec = builder.CreateVectorOfStructs(_comments);
    sx::ModuleBuilder b{builder};
    b.add_nodes(nodes_vec);
    b.add_statements(statements_vec);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_comments(comments_vec);
    return b.Finish();
}

}  // namespace parser
}  // namespace dashql
