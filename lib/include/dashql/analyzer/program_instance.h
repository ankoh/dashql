// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_

#include <iostream>
#include <optional>
#include <sstream>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "dashql/analyzer/parameter_value.h"
#include "dashql/analyzer/value.h"
#include "dashql/analyzer/viz_statement.h"
#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/common/union_find.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = proto::syntax;

/// A program instance.
///
/// A program instance represents the program configured by the user at a given point in time.
/// That includes the program text, the parsed program and the provided parameter values.
/// We primarily use shared references here in order to maintain a shallow undo log.
///
class ProgramInstance {
    friend class Analyzer;

   public:
    /// A value associated with a node.
    struct NodeValue {
        /// The root node id
        size_t root_node_id;
        /// The value
        Value value;
    };

    /// An error associated with a node
    struct NodeError {
        /// The node id
        size_t node_id;
        /// The error
        Error error;
    };

   protected:
    /// The program text
    std::shared_ptr<std::string> program_text_;
    /// The program
    std::shared_ptr<sx::ProgramT> program_;
    /// The parameter values
    std::vector<ParameterValue> parameter_values_;
    /// The evaluated nodes (if any)
    /// Note that we deliberately store the root node id within the value as well since
    /// UNION FIND might just pick a different representative.
    SparseUnionFind<NodeValue> evaluated_nodes_;
    /// The node errors
    std::vector<NodeError> node_errors_;
    /// The viz statements
    std::vector<std::unique_ptr<viz::VizStatement>> viz_statements_;

   public:
    /// Constructor
    ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program,
                    std::vector<ParameterValue> params = {})
        : ProgramInstance(std::make_shared<std::string>(text), move(program), move(params)) {}
    /// Constructor
    ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program,
                    std::vector<ParameterValue> params = {});

    /// Get the program text
    auto& program_text() const { return *program_text_; }
    /// Get the program
    auto& program() const { return *program_; }
    /// Get the program
    auto& program() { return *program_; }
    /// Get the parameter values
    auto& parameter_values() const { return parameter_values_; }
    /// Get the evaluate nodes
    auto& evaluated_nodes() const { return evaluated_nodes_; }

    /// Add a node error
    void AddNodeError(NodeError&& error);
    /// Find the parameter value
    const ParameterValue* FindParameterValue(size_t stmt_id) const;
    /// Get the text at a location
    std::string_view TextAt(sx::Location loc) const {
        return std::string_view{*program_text_}.substr(loc.offset(), loc.length());
    }
    /// Find an evaluated node value.
    /// Note: This is deliberately NOT const since we do lazy path compression for union-find.
    const NodeValue* FindNodeValue(size_t node_id);
    /// Find an evaluated node value
    const NodeValue* FindNodeValue(const sx::Node& node) {
        return FindNodeValue(&node - program_->nodes.data());
    }

    /// Render the statement text
    Expected<std::string> RenderStatementText(size_t stmt_id) const;
    /// Pack the program annotations
    flatbuffers::Offset<proto::analyzer::ProgramAnnotations> PackAnnotations(flatbuffers::FlatBufferBuilder& builder) const;

    /// Find an attribute
    const sx::Node* FindAttribute(const sx::Node& origin, sx::AttributeKey key) const;
    /// Iterate over children
    template <typename F> void IterateChildren(const sx::Node& origin, F fn) {
        auto children_begin = origin.children_begin_or_value();
        auto children_count = origin.children_count();
        auto nodes = program_->nodes;
        for (unsigned i = 0; i < children_count; ++i) {
            auto node_id = children_begin + i;
            fn(i, node_id, nodes[node_id]);
        }
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
