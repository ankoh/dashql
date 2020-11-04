// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
#define INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_

#include <string_view>
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "dashql/parser/proto/syntax_sql_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
namespace sxs = proto::syntax_sql;

using NodeVector = std::vector<sx::Node>;
using OptNode = std::optional<sx::Node>;
using OptNodeVector = std::vector<std::optional<sx::Node>>;
using Attribute = std::pair<sx::AttributeKey, sx::Node>;
using Key = sx::AttributeKey;

/// Get an attribute node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node);
/// Get an attribute node
std::optional<sx::Node> operator<<(sx::AttributeKey key, const std::optional<sx::Node>& node);

/// A module builder
class ModuleBuilder {
    public:
    /// An object builder
    class NodeBuilder {
        protected:
        /// The context
        ModuleBuilder& builder;
        /// The object type
        sx::NodeType type;
        /// The attributes
        NodeVector attributes;

        public:
        /// Constructor
        NodeBuilder(ModuleBuilder& builder, sx::NodeType type, std::initializer_list<Attribute> attrs);
        /// Constructor
        NodeBuilder(ModuleBuilder& builder, sx::NodeType type, NodeVector&& attrs);

        /// Add a single attribute 
        NodeBuilder& AddAttribute(sx::NodeType type, sx::Node value);
        /// Add attributes
        NodeBuilder& AddAttributes(std::initializer_list<Attribute> attrs);
        /// Add attributes
        NodeBuilder& AddAttributes(NodeVector&& attrs);

        /// Finish the object
        sx::Node Finish(sx::Location loc);
    };

    protected:
    /// The nodes
    std::vector<sx::Node> _nodes;
    /// The statements
    std::vector<uint32_t> _statements;
    /// The errors
    std::vector<std::pair<sx::Location, std::string>> _errors;
    /// The line breaks
    std::vector<sx::Location> _line_breaks;
    /// The comments
    std::vector<sx::Location> _comments;

    public:
    /// Constructor
    ModuleBuilder();

    /// Get the sections
    auto& statements() { return _statements; }
    /// Get the errors
    auto& errors() { return _errors; }

    /// Create an attribute
    inline sx::Node Label(sx::AttributeKey key, sx::Node node) const {
        return sx::Node(node.location(), node.node_type(), key, node.children_begin_or_value(), node.children_count());
    }
    /// Create an attribute
    inline std::optional<sx::Node> Label(sx::AttributeKey key, std::optional<sx::Node> node) const {
        return node ? std::optional<sx::Node>{*node} : std::nullopt;
    }
    /// Create a string
    inline sx::Node Ref(sx::Location loc) const {
        return sx::Node(loc, sx::NodeType::STRING, Key::NONE, 0, 0);
    }
    /// Create an unsigned value
    inline sx::Node Ref(sx::Location loc, uint32_t value) const {
        return sx::Node(loc, sx::NodeType::UI32, Key::NONE, value, 0);
    }
    /// Create an enum
    template <typename E>
    inline sx::Node RefEnum(sx::Location loc, E e) const {
        return Ref(loc, static_cast<uint32_t>(e));
    }
    /// Create a bool
    inline sx::Node Ref(sx::Location loc, bool v) const {
        return Ref(loc, static_cast<uint32_t>(v));
    }
    /// Add a an array
    sx::Node Add(sx::Location loc, NodeVector&& values);
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, std::initializer_list<OptNode> attrs = {});
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, OptNodeVector&& attrs);
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs);
    /// Start an object
    NodeBuilder StartNode(sx::NodeType type, std::initializer_list<OptNode> attrs);
    /// Start an object
    NodeBuilder StartNode(sx::NodeType type, NodeVector&& attrs);

    /// Collect viz attributes
    NodeVector CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attributes);

    /// Add a statement
    inline void AddStatement(sx::Node node) {
        _nodes.push_back(node);
        _statements.push_back(_nodes.size() - 1);
    }
    /// Add a statement
    inline void AddStatement(std::optional<sx::Node> node) {
        if (node)
            AddStatement(*node);
    }
    /// Add a line break
    inline void AddLineBreak(sx::Location loc) { _line_breaks.push_back(loc); }
    /// Add a comment
    inline void AddComment(sx::Location loc) { _comments.push_back(loc); }
    /// Add an error
    inline void AddError(sx::Location loc, const std::string& message) { _errors.push_back({loc, message}); }

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
