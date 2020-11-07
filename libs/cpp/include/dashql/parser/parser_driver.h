// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
#define INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <iostream>
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_sql_generated.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
namespace sxs = proto::syntax_sql;

class Scanner;

using Key = sx::AttributeKey;
using Location = sx::Location;
using NodeVector = std::vector<sx::Node>;

/// Return the location
std::ostream& operator<<(std::ostream& out, const sx::Location& loc);

/// Helper to configure an attribute node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node);
/// Helper to append a node to a node vector
NodeVector& operator<<(NodeVector& attrs, const sx::Node& node);
/// Helper to concatenate node vectors
NodeVector& operator<<(NodeVector& attrs, NodeVector&& other);

class ParserDriver {
    friend class Parser;

    protected:
    /// The scanner
    Scanner& _scanner;
    /// The nodes
    std::vector<sx::Node> _nodes;
    /// The statements
    std::vector<uint32_t> _statements;
    /// The errors
    std::vector<std::pair<sx::Location, std::string>> _errors;

    public:
    /// Constructor
    explicit ParserDriver(Scanner& scanner);
    /// Destructor
    ~ParserDriver();

    /// Return the scanner
    auto& scanner() { return _scanner; }

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

    /// Add a statement
    void AddStatement(sx::Node node);
    /// Add an error
    void AddError(sx::Location loc, const std::string& message);

    /// Create a constant inline
    sx::Node AddConst(sx::Location loc, sxs::AConstType type);
    /// Create indirection
    sx::Node AddIndirection(sx::Location loc, sx::Node index);
    /// Create indirection
    sx::Node AddIndirection(sx::Location loc, sx::Node lower_bound, sx::Node upper_bound);
    /// Create relation expression
    sx::Node AddAlias(sx::Location loc, sx::Node name, sx::Node columns);
    /// Create a temp table name
    sx::Node AddInto(sx::Location loc, sx::Node type, sx::Node name);
    /// Create a column ref
    sx::Node AddColumnRef(sx::Location loc, NodeVector&& path);
    /// Collect viz attributes
    NodeVector CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attributes);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);

    /// Parse a module
    static flatbuffers::Offset<sx::Module> Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning = false, bool trace_parsing = false);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
