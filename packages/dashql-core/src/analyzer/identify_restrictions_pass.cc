#include "dashql/analyzer/identify_restrictions_pass.h"

#include "dashql/analyzer/identify_projections_pass.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyRestrictionsPass::IdentifyRestrictionsPass(AnalyzedScript& analyzed, Catalog& catalog,
                                                   AttributeIndex& attribute_index, NameResolutionPass& name_resolution,
                                                   IdentifyConstExprsPass& identify_constants,
                                                   IdentifyProjectionsPass& identify_projections)
    : scanned(*analyzed.parsed_script->scanned_script),
      parsed(*analyzed.parsed_script),
      analyzed(analyzed),
      catalog_entry_id(parsed.external_id),
      catalog(catalog),
      attribute_index(attribute_index),
      ast(parsed.nodes),
      name_resolution(name_resolution),
      identify_constexprs(identify_constants),
      identify_projections(identify_projections) {}

void IdentifyRestrictionsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyRestrictionsPass::Visit(std::span<Node> morsel) {
    size_t morsel_offset = morsel.data() - ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (op_node) {
                    assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);
                    switch (static_cast<ExpressionOperator>(op_node->children_begin_or_value())) {
                        case ExpressionOperator::EQUAL:
                        case ExpressionOperator::NOT_EQUAL:
                        case ExpressionOperator::GREATER_EQUAL:
                        case ExpressionOperator::GREATER_THAN:
                        case ExpressionOperator::LESS_EQUAL:
                        case ExpressionOperator::LESS_THAN:
                            break;
                        default:
                            break;
                    }
                }
                break;
            }
            default:
                break;
        }
    }
}

void IdentifyRestrictionsPass::Finish() {}

}  // namespace dashql
