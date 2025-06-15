#pragma once

#include "dashql/analyzer/pass_manager.h"
#include "dashql/utils/attribute_index.h"
#include "dashql/utils/chunk_buffer.h"

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
class IdentifyConstExprsPass : public PassManager::LTRPass {
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

    /// Bitmap indicating that a node is const
    std::vector<bool> constexpr_bitmap;
    /// Sequence of constexpr root indices (contains children and parents)
    ChunkBuffer<size_t> constexpr_roots;

   public:
    /// Constructor
    IdentifyConstExprsPass(AnalyzedScript& script, Catalog& registry, AttributeIndex& attribute_index);

    /// Helper to determine if an ast node is a column ref
    inline bool IsConstExpr(size_t ast_node_id) { return constexpr_bitmap[ast_node_id]; }

    /// Prepare the analysis pass
    void Prepare();
    /// Visit a chunk of nodes
    void Visit(std::span<buffers::parser::Node> morsel);
    /// Finish the analysis pass
    void Finish();
};

}  // namespace dashql
