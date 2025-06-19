#pragma once

#include "dashql/analyzer/identify_constant_expressions_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"

namespace dashql {

/// This pass identifies simple projections.
/// It depends on name resolution and constexpr identification.
///
/// The node visiting logic is as follows:
///   - We check if the node type can be a projection
///   - We then check if the children are projections and constexprs
///   - If yes, we remember a new projection root
///   - During finish, we then collect all constant expression roots that don't have a similar parent
///
/// We want to identify column projections such as json_value() or regexp_extract().
///
class IdentifyColumnTransformsPass : public PassManager::LTRPass {
    /// The name resolution pass
    NameResolutionPass& name_resolution;
    /// The constexprs pass
    IdentifyConstantExpressionsPass& identify_constexprs;

   public:
    /// Constructor
    IdentifyColumnTransformsPass(AnalyzerState& state, NameResolutionPass& name_resolution,
                                 IdentifyConstantExpressionsPass& identify_constants);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
