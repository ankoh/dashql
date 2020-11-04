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

/// Constructor
ModuleBuilder::ModuleBuilder()
    : _statements(), _errors() {}

/// Add an array
sx::Node ModuleBuilder::Add(sx::Location loc, NodeVector&& values) {
    auto begin = _nodes.size();
    std::copy(values.begin(), values.end(), std::back_inserter(_nodes));
    return sx::Node(loc, sx::NodeType::ARRAY, sx::AttributeKey::NONE, begin, _nodes.size() - begin);
}

/// Add an object
sx::Node ModuleBuilder::Add(sx::Location loc, sx::NodeType type, std::initializer_list<OptionalAttribute> attrs) {
    NodeVector attributes;
    for (auto& [key, node]: attrs) {
        if (node) {
            attributes.push_back(sx::Node(node->location(), node->node_type(), key, node->children_begin_or_value(), node->children_count()));
        }
    }
    return Add(loc, type, move(attributes));
}

/// Add an object
sx::Node ModuleBuilder::Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs) {
    auto begin = _nodes.size();
    std::copy(attrs.begin(), attrs.end(), std::back_inserter(_nodes));
    return sx::Node(loc, type, sx::AttributeKey::NONE, begin, _nodes.size() - begin);
}

/// Add an object
NodeVector ModuleBuilder::CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attrs) {
    auto type_val = RefEnum(viz_loc, viz_type);
    auto type_attr = Label(sx::AttributeKey::DASHQL_VIZ_TYPE, type_val);
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
