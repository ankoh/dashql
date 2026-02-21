#pragma once

#include <type_traits>
#include <utility>

#include "dashql/analyzer/analysis_state.h"
#include "dashql/buffers/index_generated.h"
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
///

constexpr size_t FORMATTING_DEFAULT_PAGE_SIZE = 128;
constexpr size_t FORMATTING_DEFAULT_INDENTATION_WIDTH = 4;
constexpr size_t FORMATTING_DEFAULT_MAX_WIDTH = 128;

/// A formatting config
struct FormattingConfig {
    /// The rope page size
    size_t rope_page_size = FORMATTING_DEFAULT_PAGE_SIZE;
    /// How many characters are used for an indentation level?
    size_t indentation_width = FORMATTING_DEFAULT_INDENTATION_WIDTH;
    /// What's our max-width that we want to render
    size_t max_width = FORMATTING_DEFAULT_MAX_WIDTH;
};

/// A line break
enum LineBreakTag { LineBreak };
/// A indentation
struct Indent {
    /// The level
    size_t level = 0;
    /// Constructor
    explicit Indent() : level(0) {}
    /// Constructor
    explicit Indent(size_t level) : level(level) {}
};

template <typename T>
concept FormattingTarget =
    requires(T t, T&& tr, const T ct, Indent i, std::string_view s, LineBreakTag lb, FormattingConfig& config) {
        { t.Write(s, config) } -> std::same_as<T&>;
        { t.Write(lb, config) } -> std::same_as<T&>;
        { t.Write(i, config) } -> std::same_as<T&>;
        { t.Write(std::move(tr), config) } -> std::same_as<T&>;

        { ct.GetLineBreaks() } -> std::convertible_to<size_t>;
        { ct.GetCurrentLineWidth() } -> std::convertible_to<size_t>;
        { ct.GetFirstLineWidth() } -> std::convertible_to<size_t>;
    };

/// A simulating formatting target to compute the inline width
struct SimulatedFormattingTarget {
   protected:
    /// The current inline width
    size_t inline_width = 0;

   public:
    /// Get the number of line breaks
    size_t GetLineBreaks() const { return 0; }
    /// Get the current line width
    size_t GetCurrentLineWidth() const { return inline_width; }
    /// Get the line width of the first line
    size_t GetFirstLineWidth() const { return inline_width; }

    /// Write a text
    SimulatedFormattingTarget& Write(std::string_view s, const FormattingConfig&) {
        inline_width += s.size();
        return *this;
    }
    /// Write an indentation
    SimulatedFormattingTarget& Write(Indent i, const FormattingConfig& config) {
        inline_width += i.level * config.indentation_width;
        return *this;
    }
    /// Write a line break
    SimulatedFormattingTarget& Write(LineBreakTag, const FormattingConfig&) {
        assert(false);
        return *this;
    }
    /// Write a formatting target
    SimulatedFormattingTarget& Write(SimulatedFormattingTarget&& other, const FormattingConfig&) {
        inline_width += other.inline_width;
        return *this;
    }
};
static_assert(FormattingTarget<SimulatedFormattingTarget>);

/// A serializing formatting target that writes into a rope
struct SerializingFormattingTarget {
    /// The rope storing data
    std::optional<rope::Rope> rope;
    /// The current line width
    size_t current_line_width = 0;
    /// The maximum line width
    size_t first_line_width = 0;
    /// The number of line breaks
    size_t line_breaks = 0;

    /// Get the number of line breaks
    size_t GetLineBreaks() const { return line_breaks; }
    /// Get the current line width
    size_t GetCurrentLineWidth() const { return current_line_width; }
    /// Get the line width of the first line
    size_t GetFirstLineWidth() const { return first_line_width; }

    /// Write a text
    SerializingFormattingTarget& Write(std::string_view s, const FormattingConfig& config);
    /// Write an indentation
    SerializingFormattingTarget& Write(Indent i, const FormattingConfig& config);
    /// Write a line break
    SerializingFormattingTarget& Write(LineBreakTag, const FormattingConfig& config);
    /// Write a line break
    SerializingFormattingTarget& Write(SerializingFormattingTarget&& other, const FormattingConfig& config);
};

static_assert(FormattingTarget<SerializingFormattingTarget>);

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
        SimulatedFormattingTarget simulated;
        /// The actual output formatting target
        SerializingFormattingTarget output;

        /// Get the formatting target by type (SimulatedFormattingTarget or SerializingFormattingTarget)
        template <typename T>
            requires FormattingTarget<T>
        T& Get() {
            if constexpr (std::is_same_v<T, SimulatedFormattingTarget>) {
                return simulated;
            } else if constexpr (std::is_same_v<T, SerializingFormattingTarget>) {
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
