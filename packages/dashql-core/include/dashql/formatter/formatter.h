#pragma once

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
/// 1) We first scan from right to left and propagate indentation levels for the different nodes
/// 2) We then scan from left to right and compute the width when formatted unbroken & compact & pretty.
/// 3) We then select a formatting strategy and scan from left to right to build the output text
struct Formatter {
   public:
    /// A formatting config
    struct FormattingConfig {
        /// The rope page size
        std::optional<size_t> rope_page_size;
        /// How many characters are used for an indentation level?
        std::optional<size_t> indentation_width;
    };

   protected:
    /// A formatting strategy
    enum FormattingStrategy { Unbroken, Compact, Pretty };
    /// Estimated formatting dimensions
    struct NodeEstimate {
        /// The horizontal width of the text
        size_t horizontal_width = 0;
        /// The current identation to which we would break
        size_t identation_level = 0;
    };
    /// A formatting state
    struct NodeState {
        /// The node text (if any)
        std::optional<rope::Rope> node_text;

        /// The estimate when formatting unbroken
        NodeEstimate estimate_unbroken;
        /// The estimate when formatting compact
        NodeEstimate estimate_compact;
        /// The estimate when formatting pretty
        NodeEstimate estimate_pretty;
        /// The selected formatting strategy for this node
        FormattingStrategy selected_strategy;
    };

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
    std::vector<NodeState> node_state;

    /// Run indentation pass
    void RunNodeIndentationPass();
    /// Run estimation pass
    void RunNodeEstimationPass();
    /// Run formatting pass
    void RunNodeFormattingPass();

   public:
    /// Constructor
    Formatter(std::shared_ptr<ParsedScript> parsed);

    /// Format the text
    rope::Rope Format(const FormattingConfig& config);
};

}  // namespace dashql
