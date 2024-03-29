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

#include "dashql/parser/qualified_name.h"
#include "dashql/parser/script_options.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

class Scanner;

using Key = sx::AttributeKey;
using Location = sx::Location;
using NodeVector = std::vector<sx::Node>;

/// Helper to print the location
std::ostream& operator<<(std::ostream& out, const sx::Location& loc);
/// Helper to configure an attribute node
sx::Node operator<<(sx::AttributeKey key, const sx::Node& node);
/// Helper to configure an attribute node
sx::Node operator<<(uint16_t key, const sx::Node& node);
/// Helper to append a node to a node vector
NodeVector& operator<<(NodeVector& attrs, const sx::Node& node);
/// Helper to concatenate node vectors
NodeVector concat(NodeVector&& l, NodeVector&& r);
/// Helper to concatenate node vectors
NodeVector concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2);
/// Helper to concatenate node vectors
NodeVector concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2, NodeVector&& v3);

using NodeID = uint32_t;

struct Statement {
    /// The statement type
    sx::StatementType type;
    /// The root node
    NodeID root;
    /// The name
    QualifiedNameView name;
    /// The table refs
    std::vector<std::pair<NodeID, QualifiedNameView>> table_refs;
    /// The global column refs
    std::vector<NodeID> column_refs;

    /// Constructor
    Statement();

    /// Reset
    void reset();
    /// Get as flatbuffer object
    std::unique_ptr<sx::StatementT> Finish();
};

class ParserDriver {
   protected:
    /// The scanner
    Scanner& scanner_;
    /// The script options
    ScriptOptions options_;
    /// The nodes
    std::vector<sx::Node> nodes_;
    /// The current statement
    Statement current_statement_;
    /// The statements
    std::vector<Statement> statements_;
    /// The errors
    std::vector<std::pair<sx::Location, std::string>> errors_;
    /// The dependencies
    std::vector<sx::Dependency> dependencies_;
    /// The dson keys
    std::vector<sx::Location> dson_keys_;
    /// The dson key mapping
    std::unordered_map<std::string_view, uint16_t> dson_key_map_;

    /// Find an attribute
    std::optional<size_t> FindAttribute(const sx::Node& node, Key attribute) const;

    /// Add a node
    NodeID AddNode(sx::Node node);
    /// Compute the dependencies
    void ComputeDependencies();
    /// Get as flatbuffer object
    std::shared_ptr<sx::ProgramT> Finish();

   public:
    /// Constructor
    explicit ParserDriver(Scanner& scanner);
    /// Destructor
    ~ParserDriver();

    /// Return the scanner
    auto& scanner() { return scanner_; }

    /// Add a an array
    sx::Node AddArray(sx::Location loc, nonstd::span<sx::Node> values, bool null_if_empty = true,
                      bool shrink_location = false);
    /// Add an object
    sx::Node AddObject(sx::Location loc, sx::NodeType type, nonstd::span<sx::Node> attrs, bool null_if_empty = true,
                       bool shrink_location = false);
    /// Add a dson field
    sx::Node AddDSONField(sx::Location loc, std::vector<sx::Location>&& key_path, sx::Node value);
    /// Add a statement
    void AddStatement(sx::Node node);
    /// Add an error
    void AddError(sx::Location loc, const std::string& message);

    /// Add a an array
    inline sx::Node Add(sx::Location loc, NodeVector&& values, bool null_if_empty = true,
                        bool shrink_location = false) {
        return AddArray(loc, nonstd::span<sx::Node>{values}, null_if_empty, shrink_location);
    }
    /// Add a an object
    inline sx::Node Add(sx::Location loc, sx::NodeType type, NodeVector&& values, bool null_if_empty = true,
                        bool shrink_location = false) {
        return AddObject(loc, type, nonstd::span<sx::Node>{values}, null_if_empty, shrink_location);
    }

    /// Parse a module
    static std::shared_ptr<sx::ProgramT> Parse(std::string_view in, bool trace_scanning = false,
                                               bool trace_parsing = false);
};

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
