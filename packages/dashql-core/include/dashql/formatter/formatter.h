#pragma once

#include <string>
#include <type_traits>
#include <utility>

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
        size_t precendence = 0;
        /// The associativity
        Associativity associativity = Associativity::NonAssoc;
        /// The inline formatting target
        SimulatedInlineFormatter simulated_inline;
        /// The actual output formatting target
        FormattingBuffer out;

        /// Get the formatting target by type (SimulatedFormattingTarget or SerializingFormattingTarget)
        template <typename T>
            requires FormattingTarget<T>
        T& Get() {
            if constexpr (std::is_same_v<T, SimulatedInlineFormatter>) {
                return simulated_inline;
            } else if constexpr (std::is_same_v<T, FormattingBuffer>) {
                return out;
            }
        }
        /// Write the formatted text from this node's output buffer
        void FormatText(std::string& buffer) const { out.WriteText(buffer); }
    };

   protected:
    /// The scanned program (input)
    ScannedScript& scanned;
    /// The parsed program (input)
    ParsedScript& parsed;
    /// The parsed ast
    std::span<const buffers::parser::Node> ast;
    /// The formatting config
    FormattingConfig config;

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
    size_t GetInlineNodeWidth(const buffers::parser::Node& node) {
        return *GetNodeState(node).simulated_inline.GetLineWidth();
    }

    /// Format a node
    template <FormattingMode mode, FormattingTarget Target> void formatNode(size_t node_id);

   public:
    /// Constructor
    Formatter(std::shared_ptr<ParsedScript> parsed);

    /// Estimate how many characters the output buffer will need
    size_t EstimateFormattedSize() const;
    /// Format the text
    std::string Format(const FormattingConfig& config);
};

}  // namespace dashql
