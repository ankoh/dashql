#include "dashql/analyzer/identify_restrictions_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/identify_projections_pass.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyRestrictionsPass::IdentifyRestrictionsPass(AnalyzerState& state, NameResolutionPass& name_resolution,
                                                   IdentifyConstExprsPass& identify_constants,
                                                   IdentifyProjectionsPass& identify_projections)
    : PassManager::LTRPass(state),
      name_resolution(name_resolution),
      identify_constexprs(identify_constants),
      identify_projections(identify_projections) {}

void IdentifyRestrictionsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyRestrictionsPass::Visit(std::span<const Node> morsel) {
    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = state.attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];

                break;
            }
            default:
                break;
        }
    }
}

void IdentifyRestrictionsPass::Finish() {}

}  // namespace dashql
