#pragma once

#include <span>

#include "dashql/buffers/index_generated.h"

namespace dashql {

struct AnalysisState;

class PassManager {
   public:
    /// Analysis pass that visits node in a DFS left-to-right post-order traversal.
    /// Scans the AST node buffer from left to right.
    struct LTRPass {
        /// The state
        AnalysisState& state;
        /// Constructor
        LTRPass(AnalysisState& state);

        /// Destructor
        virtual ~LTRPass();
        /// Prepare the analysis pass
        virtual void Prepare() = 0;
        /// Visit a chunk of nodes
        virtual void Visit(std::span<const buffers::parser::Node> morsel) = 0;
        /// Finish the analysis pass
        virtual void Finish() = 0;
    };
    /// Analysis pass that visits nodes in a DFS right-to-left pre-order traversal
    /// Scans the AST node buffer from right to left.
    struct RTLPass {
        /// The state
        AnalysisState& state;
        /// Constructor
        RTLPass(AnalysisState& state);

        /// Destructor
        virtual ~RTLPass();
        /// Prepare the analysis pass
        virtual void Prepare() = 0;
        /// Visit a chunk of nodes
        virtual void Visit(std::span<const buffers::parser::Node> morsel) = 0;
        /// Finish the analysis pass
        virtual void Finish() = 0;
    };

   public:
    /// Constructor
    PassManager();
    /// Execute a pass
    void Execute(AnalysisState& state, std::initializer_list<std::reference_wrapper<LTRPass>> passes);
};

}  // namespace dashql
