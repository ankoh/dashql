#include "dashql/analyzer/identify_column_restrictions_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/identify_column_transforms_pass.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyColumnRestrictionsPass::IdentifyColumnRestrictionsPass(AnalysisState& state,
                                                               NameResolutionPass& name_resolution,
                                                               IdentifyConstantExpressionsPass& identify_constants,
                                                               IdentifyColumnTransformsPass& identify_projections)
    : PassManager::LTRPass(state),
      name_resolution(name_resolution),
      identify_constexprs(identify_constants),
      identify_projections(identify_projections) {}

void IdentifyColumnRestrictionsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyColumnRestrictionsPass::Visit(std::span<const Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> child_buffer;

    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = state.attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (!op_node) continue;
                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                // Are all children const?
                auto arg_nodes = state.ReadArgExpressions(child_attrs[AttributeKey::SQL_EXPRESSION_ARGS]);
                size_t arg_count_const = 0;
                size_t arg_count_projection = 0;
                size_t restriction_target_idx = 0;
                if (child_buffer.size() < arg_nodes.size()) {
                    child_buffer.resize(arg_nodes.size());
                }
                for (size_t i = 0; i < arg_nodes.size(); ++i) {
                    size_t arg_node_id = (arg_nodes.data() - state.ast.data()) + i;
                    auto* arg_expr = state.expression_index[arg_node_id];
                    if (!arg_expr) continue;
                    if (arg_expr->IsColumnTransform()) {
                        child_buffer[i] = arg_expr;
                        ++arg_count_projection;
                        restriction_target_idx = i;
                    } else if (arg_expr->IsConstantExpression()) {
                        child_buffer[i] = arg_expr;
                        ++arg_count_const;
                    }
                }
                auto child_exprs = std::span{child_buffer}.subspan(0, arg_nodes.size());

                // Is restriction?
                bool is_restriction =
                    arg_count_projection == 1 && ((arg_count_projection + arg_count_const) == arg_nodes.size());
                if (!is_restriction) continue;

                ExpressionOperator op_type = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
                switch (op_type) {
                    // Comparisons
                    case ExpressionOperator::EQUAL:
                    case ExpressionOperator::NOT_EQUAL:
                    case ExpressionOperator::LESS_THAN:
                    case ExpressionOperator::LESS_EQUAL:
                    case ExpressionOperator::GREATER_THAN:
                    case ExpressionOperator::GREATER_EQUAL: {
                        assert(child_exprs.size() == 2);
                        AnalyzedScript::Expression::Comparison inner{
                            .func = AnalysisState::ReadComparisonFunction(op_type),
                            .left_expression_id = child_exprs[0]->expression_id.GetObject(),
                            .right_expression_id = child_exprs[1]->expression_id.GetObject(),
                            .restriction_target_left = restriction_target_idx == 0,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_column_restriction = true;
                        state.expression_index[node_id] = &n;
                        state.analyzed->column_restrictions.PushBack(n);
                        break;
                    }
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

void IdentifyColumnRestrictionsPass::Finish() {}

}  // namespace dashql
