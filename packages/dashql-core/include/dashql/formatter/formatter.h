#pragma once

#include <string>

#include "dashql/analyzer/analysis_state.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_target.h"
#include "dashql/script.h"

namespace dashql {

/// In DashQL, we format the AST directly, not a derived Algebra representation.
/// Our AST is stored in a single vector of `buffers::parser::Node`'s.
/// Children are stored in this vector before parents, so scanning from left to right means visiting the AST
/// bottom-to-top and vice versa.
///
/// Formatting is done in multiple phases:
/// 1) We then scan bottom-up and compute the width when formatted inline.
/// 2) We then scan top-down and do the following:
///     A) We first check if the current node can be formatted inline
///     B) If yes, we do
///     C) If not, we start formating in a line-broken variant
///     D) For each child, we then check if the inline-width of that child fits
///     E) If so, we go with inline
///     F) If not, we check if we want to create opening and closing brackets, add newlines and increase the indentation
///     level for the child
///     G) Note that children are not rendered yet, but we already added a reference to the NodeState
///
/// Example:
///     Let's assume we want to format `SELECT * FROM foo WHERE 1 + 2 + ..... N`, with a very long expression chain
///     exceeding the line width Root is too long, we instruct to render in a broken variant.
///
///     Select node renders as
///         SELECT *
///         FROM foo
///         WHERE <exp>
///
///     For <exp>, we see that the expression itself does not fit in a line.
///         XXX Compact vs Vertical

struct Formatter {
   public:
    /// A aormatting phase
    enum class FormattingPhase { Prepare, Measure, Write };
    /// An associativity
    enum class Associativity { Left, Right, NonAssoc };

    /// A formatting state
    struct NodeState {
        /// The precedence level
        size_t precedence = 0;
        /// The associativity
        Associativity associativity = Associativity::NonAssoc;
        /// When true, the node will be wrapped in parentheses
        bool needs_parentheses = false;
        /// The inline layout buffer
        FormattingBuffer inline_out;
        /// The runtime-selected output formatting target
        FormattingBuffer breaking_out;
        /// Write the formatted text from this node's output buffer
        void FormatText(buffers::formatting::FormattingMode mode, std::string& buffer, size_t max_width,
                        size_t& current_line_width, bool debug_mode) const {
            const auto& source = (mode == buffers::formatting::FormattingMode::INLINE) ? inline_out : breaking_out;
            source.WriteText(buffer, max_width, current_line_width, debug_mode);
        }
    };

   protected:
    /// The scanned program (input)
    const ScannedScript& scanned;
    /// The parsed program (input)
    const ParsedScript& parsed;
    /// The parsed ast
    const std::span<const buffers::parser::Node> ast;
    /// The formatting config
    buffers::formatting::FormattingConfigT config;

    /// The formatting state.
    /// Stores a formatting state for every node in the ast.
    std::vector<NodeState> node_states;

    /// Get the node state of a node
    NodeState& GetNodeState(const buffers::parser::Node& node) { return node_states[&node - ast.data()]; }
    /// Get the states of a node children
    std::span<NodeState> GetArrayStates(const buffers::parser::Node& node) {
        assert(node.node_type() == buffers::parser::NodeType::ARRAY);
        return std::span{node_states}.subspan(node.children_begin_or_value(), node.children_count());
    }
    /// Get the attributes of an object
    template <buffers::parser::AttributeKey... keys>
    AttributeLookupResult<keys...> GetNodeAttributes(const buffers::parser::Node& node) {
        assert(node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_);
        return LookupAttributes<keys...>(ast.subspan(node.children_begin_or_value(), node.children_count()));
    }
    /// Get the inline node width
    size_t GetInlineNodeWidth(const buffers::parser::Node& node) { return GetNodeState(node).inline_out.GetWidth(); }

    /// Scan the AST left-to-right and derive precedence/associativity for expression nodes (e.g.
    /// OBJECT_SQL_NARY_EXPRESSION). Must be called before PrepareParens and formatting.
    void PreparePrecedence();
    /// Scan the AST right-to-left (parents before children) and set render_with_parens on n-ary expression nodes that
    /// need parentheses. Must be called after PreparePrecedence, before formatting.
    void IdentifyParentheses();

    /// Format a node into the provided buffer using the selected mode.
    template <buffers::formatting::FormattingMode mode> void formatNodeInto(size_t node_id, FormattingBuffer& out);
    /// Format a node into its inline layout buffer
    void formatInlineNode(size_t node_id);
    /// Format a node into its runtime-selected output buffer
    void formatOutputNode(size_t node_id);

   public:
    /// Constructor
    Formatter(ParsedScript& parsed);

    /// Estimate how many characters the output buffer will need
    size_t EstimateFormattedSize() const;
    /// Format the text
    std::string Format(const buffers::formatting::FormattingConfigT& config);
};

}  // namespace dashql
