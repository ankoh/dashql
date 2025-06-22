#pragma once

#include "dashql/analyzer/pass_manager.h"
#include "dashql/script.h"

namespace dashql {

/// This pass identifies function calls
class IdentifyFunctionCallsPass : public PassManager::LTRPass {
    /// Temporary buffer for expression pointers
    std::vector<AnalyzedScript::Expression*> tmp_expressions;

   public:
    /// Constructor
    IdentifyFunctionCallsPass(AnalysisState& state);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
