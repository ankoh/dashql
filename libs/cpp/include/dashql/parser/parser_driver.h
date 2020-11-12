// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
#define INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

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

/// Helper to print the location
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
    /// The dependencies
    std::vector<sx::Dependency> _dependencies;

   public:
    /// Constructor
    explicit ParserDriver(Scanner& scanner);
    /// Destructor
    ~ParserDriver();

    /// Return the scanner
    auto& scanner() { return _scanner; }

    /// Add a an array
    sx::Node Add(sx::Location loc, NodeVector&& values, bool null_if_empty = true);
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty = true);
    /// Add a statement
    void AddStatement(sx::Node node);
    /// Add an error
    void AddError(sx::Location loc, const std::string& message);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);

    /// Parse a module
    static flatbuffers::Offset<sx::Module> Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in,
                                                 bool trace_scanning = false, bool trace_parsing = false);
};

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
