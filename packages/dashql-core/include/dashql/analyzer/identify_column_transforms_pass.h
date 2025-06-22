#pragma once

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
    /// The identified transforms.
    /// Are appended to the analyzed script during Finish.
    IntrusiveList<AnalyzedScript::Expression> transforms;
    /// Temporary buffer for expression pointers
    std::vector<AnalyzedScript::Expression*> tmp_expressions;

    /// Helper to read restriction arguments.
    /// Returns mapped expressions and the index of the transform target (the column transform / column ref)
    /// Returns a nullopt if more than one column is referenced.
    std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>> readTransformArgs(
        std::span<const buffers::parser::Node> nodes);

   public:
    /// Constructor
    IdentifyColumnTransformsPass(AnalysisState& state);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
