#pragma once

#include "dashql/analyzer/identify_column_transforms_pass.h"
#include "dashql/analyzer/identify_constant_expressions_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"

namespace dashql {

/// This pass identifies restrictions of single columns that are optionally projected.
/// It depends on name resolution, constexpr identification and projection identification.
///
/// The node visiting logic is as follows:
///   - We filter nodes of type OBJECT_SQL_NARY_EXPRESSION
///   - We then check if the SQL_EXPRESSION_OPERATOR is a comparison
///   - We then check if the children are projections and constexprs
///   - If the comparison compares a single (projected) column with a constexpr, we emit a restriction
///
/// We want to identify:
///   - Simple restrictions like: "column" = <constant>
///   - Restrictions with projections like: json_value() = <constant>
///
class IdentifyColumnRestrictionsPass : public PassManager::LTRPass {
    /// The name resolution pass
    NameResolutionPass& name_resolution;
    /// The constexprs pass
    IdentifyConstantExpressionsPass& identify_constexprs;
    /// The projection pass
    IdentifyColumnTransformsPass& identify_projections;

   public:
    /// Constructor
    IdentifyColumnRestrictionsPass(AnalyzerState& state, NameResolutionPass& name_resolution,
                                   IdentifyConstantExpressionsPass& identify_constants,
                                   IdentifyColumnTransformsPass& identify_projections);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
