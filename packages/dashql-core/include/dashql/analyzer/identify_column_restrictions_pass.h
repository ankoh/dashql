#pragma once

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
    /// The identified computations.
    /// Are appended to the analyzed script during Finish.
    IntrusiveList<AnalyzedScript::Expression> restrictions;
    /// Temporary buffer for expression pointers
    std::vector<AnalyzedScript::Expression*> tmp_expressions;

    /// Helper to read restriction arguments.
    /// Returns mapped expressions and the index of the restriction target (the column computation / column ref)
    /// Returns a nullopt if more than one column is referenced.
    std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>> readRestrictionArgs(
        std::span<const buffers::parser::Node> nodes);

   public:
    /// Constructor
    IdentifyColumnRestrictionsPass(AnalysisState& state);

    /// Prepare the analysis pass
    void Prepare() override;
    /// Visit a chunk of nodes
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    /// Finish the analysis pass
    void Finish() override;
};

}  // namespace dashql
