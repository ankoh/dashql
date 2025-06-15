#pragma once

#include "dashql/analyzer/identify_constants_pass.h"
#include "dashql/analyzer/identify_projections_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/utils/attribute_index.h"

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
class IdentifyRestrictionsPass : public PassManager::LTRPass {
    /// The scanned program
    ScannedScript& scanned;
    /// The parsed program
    ParsedScript& parsed;
    /// The analyzed program
    AnalyzedScript& analyzed;
    /// The external id of the current script
    const CatalogEntryID catalog_entry_id;
    /// The catalog
    Catalog& catalog;
    /// The attribute index
    AttributeIndex& attribute_index;
    /// The ast
    std::span<const buffers::parser::Node> ast;

    /// The name resolution pass
    NameResolutionPass& name_resolution;
    /// The constexprs pass
    IdentifyConstExprsPass& identify_constexprs;
    /// The projection pass
    IdentifyProjectionsPass& identify_projections;

   public:
    /// Constructor
    IdentifyRestrictionsPass(AnalyzedScript& script, Catalog& registry, AttributeIndex& attribute_index,
                             NameResolutionPass& name_resolution, IdentifyConstExprsPass& identify_constants,
                             IdentifyProjectionsPass& identify_projections);

    /// Prepare the analysis pass
    void Prepare();
    /// Visit a chunk of nodes
    void Visit(std::span<buffers::parser::Node> morsel);
    /// Finish the analysis pass
    void Finish();
};

}  // namespace dashql
