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
using Key = sx::AttributeKey;

/// Get an attribute node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node);

/// A module builder
class ModuleBuilder {
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

    /// Create a null node
    inline sx::Node Null() const {
        return sx::Node(sx::Location(), sx::NodeType::NONE, Key::NONE, 0, 0);
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
    sx::Node Add(sx::Location loc, NodeVector&& values, bool null_if_empty = true);
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty = true);

    /// Collect viz attributes
    NodeVector CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attributes);

    /// Add a statement
    inline void AddStatement(sx::Node node) {
        if (node.node_type() != sx::NodeType::NONE) {
            _nodes.push_back(node);
            _statements.push_back(_nodes.size() - 1);
        }
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
