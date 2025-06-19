#include "dashql/analyzer/identify_column_transforms_pass.h"

#include "dashql/analyzer/analyzer.h"

namespace dashql {

IdentifyColumnTransformsPass::IdentifyColumnTransformsPass(AnalyzerState& state, NameResolutionPass& name_resolution,
                                                           IdentifyConstantExpressionsPass& identify_constants)
    : PassManager::LTRPass(state), name_resolution(name_resolution), identify_constexprs(identify_constants) {}

void IdentifyColumnTransformsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyColumnTransformsPass::Visit(std::span<const buffers::parser::Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> const_child_exprs;
    std::vector<const AnalyzedScript::Expression*> child_projections;

    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = state.attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (!op_node) continue;
                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                switch (static_cast<buffers::parser::ExpressionOperator>(op_node->children_begin_or_value())) {
                    case buffers::parser::ExpressionOperator::PLUS:
                    case buffers::parser::ExpressionOperator::MULTIPLY:
                    case buffers::parser::ExpressionOperator::MINUS:
                    case buffers::parser::ExpressionOperator::DIVIDE:
                    case buffers::parser::ExpressionOperator::MODULUS:
                    case buffers::parser::ExpressionOperator::XOR:
                    case buffers::parser::ExpressionOperator::NEGATE:
                    case buffers::parser::ExpressionOperator::NOT:

                        break;
                    case buffers::parser::ExpressionOperator::LIKE:
                        break;
                    case buffers::parser::ExpressionOperator::ILIKE:
                        break;
                    case buffers::parser::ExpressionOperator::NOT_LIKE:
                        break;
                    case buffers::parser::ExpressionOperator::NOT_ILIKE:
                        break;
                    default:
                        break;
                }
                break;
            }
            default:
                break;
        }
    }
}

void IdentifyColumnTransformsPass::Finish() {}

}  // namespace dashql
