#pragma once

#include <type_traits>
#include <utility>

#include "dashql/analyzer/analysis_state.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/formatter/formatting_target.h"
#include "dashql/script.h"
#include "dashql/text/rope.h"

namespace dashql {

/// In DashQL, we format the AST directly, not a derived Algebra representation.
/// Our AST is stored in a single vector of `buffers::parser::Node`'s.
/// Children are stored in this vector before parents, so scanning from left to right means visiting the AST
/// bottom-to-top and vice versa.
///
/// Formatting is done in 3 phases:
/// 1) We first propagate indentation levels for the different formatting modes from parents to children.
/// 2) We then scan from children to parents and compute the width when formatted inline.
/// 3) We then select a formatting strategy and scan from children to parents to build the output text

struct Formatter {
   public:
    /// Formatting phases
    enum class FormattingPhase { Prepare, Measure, Write };
    /// Formatting modes
    enum class FormattingMode { Inline, Compact, Pretty };
    /// The associativity
    enum class Associativity { Left, Right, NonAssoc };

    /// A formatting state
    struct NodeState {
        /// The current identation if we would break
        Indent indentation;
        /// The precedence level
        size_t precendence_level = 0;
        /// The associativity
        Associativity associativity = Associativity::NonAssoc;
        /// The inline formatting target
        SimulatedFormattingBuffer simulated;
        /// The actual output formatting target
        FormattingBuffer output;

        /// Get the formatting target by type (SimulatedFormattingTarget or SerializingFormattingTarget)
        template <typename T>
            requires FormattingTarget<T>
        T& Get() {
            if constexpr (std::is_same_v<T, SimulatedFormattingBuffer>) {
                return simulated;
            } else if constexpr (std::is_same_v<T, FormattingBuffer>) {
                return output;
            }
        }
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

    /// Format a node
    template <FormattingTarget Target> void formatNode(size_t node_id, FormattingMode mode);

   public:
    /// Constructor
    Formatter(std::shared_ptr<ParsedScript> parsed);

    /// Format the text
    rope::Rope Format(const FormattingConfig& config);
};

}  // namespace dashql
