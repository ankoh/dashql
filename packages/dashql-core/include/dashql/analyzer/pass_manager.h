#pragma once

#include "dashql/parser/parser.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {

class PassManager {
   public:
    /// Analysis pass that visits node in a DFS left-to-right post-order traversal.
    /// Scans the AST node buffer from left to right.
    struct LTRPass {
        /// Destructor
        virtual ~LTRPass();
        /// Prepare the analysis pass
        virtual void Prepare() = 0;
        /// Visit a chunk of nodes
        virtual void Visit(std::span<buffers::parser::Node> morsel) = 0;
        /// Finish the analysis pass
        virtual void Finish() = 0;
    };
    /// Analysis pass that visits nodes in a DFS right-to-left pre-order traversal
    /// Scans the AST node buffer from right to left.
    struct RTLPass {
        /// Destructor
        virtual ~RTLPass();
        /// Prepare the analysis pass
        virtual void Prepare() = 0;
        /// Visit a chunk of nodes
        virtual void Visit(std::span<buffers::parser::Node> morsel) = 0;
        /// Finish the analysis pass
        virtual void Finish() = 0;
    };

   protected:
    /// The output of the parser
    ParsedScript& parsedProgram;

   public:
    /// Constructor
    PassManager(ParsedScript& parser);
    /// Execute a pass
    void Execute(LTRPass& pass);
};

}  // namespace dashql
