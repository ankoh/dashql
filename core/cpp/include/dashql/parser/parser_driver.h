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

#include "dashql/proto/syntax_dashql_generated.h"
#include "dashql/proto/syntax_generated.h"
#include "dashql/proto/syntax_sql_generated.h"

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
NodeVector concat(NodeVector&& l, NodeVector&& r);
/// Helper to concatenate node vectors
NodeVector concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2);

struct ScriptOptions {
    /// The global namespace name
    std::string_view global_namespace;

    /// Constructor
    ScriptOptions();
};

using NodeID = uint32_t;
using QualifiedName = std::array<std::string_view, 2>;

struct Statement {
    /// The statement type
    sx::StatementType type;
    /// The root node
    NodeID root;
    /// The names
    QualifiedName name;
    /// The table refs
    std::vector<std::pair<NodeID, QualifiedName>> table_refs;
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

    /// Find an attribute
    std::pair<const sx::Node*, size_t> FindAttribute(const sx::Node& node, Key attribute) const;
    /// Get a qualified name
    QualifiedName AsQualifiedName(const sx::Node& node, bool lift_global = false);

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
    sx::Node Add(sx::Location loc, NodeVector&& values, bool null_if_empty = true);
    /// Add an object
    sx::Node Add(sx::Location loc, sx::NodeType type, NodeVector&& attrs, bool null_if_empty = true);
    /// Add a statement
    void AddStatement(sx::Node node);
    /// Add an error
    void AddError(sx::Location loc, const std::string& message);

    /// Parse a module
    static std::shared_ptr<sx::ProgramT> Parse(std::string_view in, bool trace_scanning = false, bool trace_parsing = false);
};

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
