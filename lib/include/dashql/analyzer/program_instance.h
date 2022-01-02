// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_

#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <sstream>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "arrow/scalar.h"
#include "arrow/type_fwd.h"
#include "dashql/analyzer/input_value.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/stmt/fetch_stmt.h"
#include "dashql/analyzer/stmt/input_stmt.h"
#include "dashql/analyzer/stmt/load_stmt.h"
#include "dashql/analyzer/stmt/set_stmt.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/common/enum.h"
#include "dashql/common/union_find.h"
#include "dashql/parser/grammar/dson.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

namespace sx = proto::syntax;

using NodeID = uint32_t;
constexpr NodeID INVALID_NODE_ID = std::numeric_limits<NodeID>::max();

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
        std::shared_ptr<arrow::Scalar> value;

        /// Move constructor
        NodeValue(NodeValue&& other) = default;
        /// Move assignment
        NodeValue& operator=(NodeValue&& other) = default;
    };

    /// An error associated with a node
    struct NodeError {
        /// The node id
        size_t node_id;
        /// The status
        arrow::Status status;
    };

    /// A qualified table name
    struct QualifiedName {
        /// The schema
        std::string_view schema;
        /// The name
        std::string_view name;
        /// The indirection
        std::string_view indirection;
    };

   protected:
    /// The program text
    const std::shared_ptr<std::string> program_text_;
    /// The program
    const std::shared_ptr<sx::ProgramT> program_;
    /// The dson dictionary
    const parser::DSONDictionary dson_dictionary_;
    /// The script options
    const parser::ScriptOptions script_options_ = {};
    /// The parameter values
    const std::vector<InputValue> input_values_;
    /// The evaluated nodes (if any)
    /// Note that we deliberately store the root node id within the value as well since
    /// UNION FIND might just pick a different representative.
    SparseUnionFind<NodeValue> evaluated_nodes_;
    /// The node errors
    std::vector<NodeError> node_errors_ = {};
    /// The linter messages
    std::vector<LinterMessage> linter_messages_ = {};
    /// The dead statements
    std::vector<bool> statements_liveness_ = {};
    /// The set statements
    std::vector<std::unique_ptr<SetStatement>> set_statements_ = {};
    /// The input statements
    std::vector<std::unique_ptr<InputStatement>> input_statements_ = {};
    /// The fetch statements
    std::vector<std::unique_ptr<FetchStatement>> fetch_statements_ = {};
    /// The load statements
    std::vector<std::unique_ptr<LoadStatement>> load_statements_ = {};
    /// The viz statements
    std::vector<std::unique_ptr<VizStatement>> viz_statements_ = {};

   public:
    /// Constructor
    ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program, std::vector<InputValue> params = {})
        : ProgramInstance(std::make_shared<std::string>(text), move(program), move(params)) {}
    /// Constructor
    ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program,
                    std::vector<InputValue> params = {});

    /// Move constructor
    ProgramInstance(ProgramInstance&& other) = default;

    /// Get the program text
    auto& program_text() const { return *program_text_; }
    /// Get the program
    auto& program() const { return *program_; }
    /// Get the program
    auto& program() { return *program_; }
    /// Get the dson dictionary
    auto& dson_dictionary() const { return dson_dictionary_; }
    /// Get the program
    auto& script_options() const { return script_options_; }
    /// Get the parameter values
    auto& input_values() const { return input_values_; }
    /// Get the evaluate nodes
    auto& evaluated_nodes() const { return evaluated_nodes_; }
    /// Get the statements liveness
    auto& statements_liveness() const { return statements_liveness_; }
    /// Get the input statements
    auto& input_statements() const { return input_statements_; }
    /// Get the viz statements
    auto& viz_statements() const { return viz_statements_; }

    /// Get the viz statements
    auto& linter_messages() { return linter_messages_; }

    /// Add a node error
    void AddNodeError(NodeError&& error);
    /// Add a linter message
    LinterMessage& AddLinterMessage(LinterMessageCode code, size_t node_id);
    /// Find the input value value
    const InputValue* FindInputValue(size_t stmt_id) const;
    /// Find an evaluated node
    const NodeValue* FindEvaluatedNode(size_t node_id) { return evaluated_nodes_.Find(node_id); }
    /// Get the text at a location
    std::string_view TextAt(sx::Location loc) const {
        return std::string_view{*program_text_}.substr(loc.offset(), loc.length());
    }
    /// Read a node value.
    /// Note: This is deliberately NOT const since we do lazy path compression the union-find of evaluated nodes.
    std::shared_ptr<arrow::Scalar> ReadNodeValue(size_t node_id);
    /// Read a node value if it is valid
    inline std::shared_ptr<arrow::Scalar> ReadNodeValueOrNull(size_t node_id) {
        if (node_id == INVALID_NODE_ID) return arrow::MakeNullScalar(arrow::null());
        return ReadNodeValue(node_id);
    }
    /// Read a qualified name
    QualifiedName ReadQualifiedName(size_t node_id, bool lift_global = false);

    /// Render the statement text
    arrow::Result<std::string> RenderStatementText(size_t stmt_id) const;
    /// Pack the program annotations
    arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramAnnotations>> PackAnnotations(
        flatbuffers::FlatBufferBuilder& builder) const;

    /// Find an attribute
    std::optional<size_t> FindAttribute(const sx::Node& origin, sx::AttributeKey key) const;
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
