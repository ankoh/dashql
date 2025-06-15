#pragma once

#include "dashql/analyzer/identify_constants_pass.h"
#include "dashql/analyzer/name_resolution_pass.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/utils/attribute_index.h"
#include "dashql/utils/chunk_buffer.h"

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
class IdentifyProjectionsPass : public PassManager::LTRPass {
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

    /// Bitmap indicating that a node is const
    std::vector<bool> projection_bitmap;
    /// Sequence of projection root indices (contains children and parents)
    ChunkBuffer<size_t> projection_roots;

   public:
    /// Constructor
    IdentifyProjectionsPass(AnalyzedScript& script, Catalog& registry, AttributeIndex& attribute_index,
                            NameResolutionPass& name_resolution, IdentifyConstExprsPass& identify_constants);

    /// Helper to determine if an ast node is a column ref
    inline bool IsProjection(size_t ast_node_id) { return projection_bitmap[ast_node_id]; }

    /// Prepare the analysis pass
    void Prepare();
    /// Visit a chunk of nodes
    void Visit(std::span<buffers::parser::Node> morsel);
    /// Finish the analysis pass
    void Finish();
};

}  // namespace dashql
