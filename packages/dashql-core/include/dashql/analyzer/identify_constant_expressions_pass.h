#pragma once

#include "dashql/analyzer/pass_manager.h"

namespace dashql {

/// This pass identifies constant expressions.
///
/// The node visiting logic is as follows:
///   - We check if the node type can be a constant expression
///   - If yes, we check if all input expressions are constant expressions
///   - If yes, we remember a new constant expression root
///   - During finish, we then collect all constant expression roots that don't have a similar parent
///
/// We want to identify:
///   - Constant literals: 'foo'
///   - Constant casts: date 'foo'
///   - Constant function calls
///
class IdentifyConstantExpressionsPass : public PassManager::LTRPass {
   public:
    /// Constructor
    IdentifyConstantExpressionsPass(AnalyzerState& state);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
