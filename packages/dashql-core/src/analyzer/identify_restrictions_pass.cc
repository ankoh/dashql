#include "dashql/analyzer/identify_restrictions_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/identify_projections_pass.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/utils/ast_reader.h"

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
                auto arg_nodes = readExpressionArgs(child_attrs[AttributeKey::SQL_EXPRESSION_ARGS], state.ast);
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
                    if (arg_expr->IsProjection()) {
                        child_buffer[i] = arg_expr;
                        ++arg_count_projection;
                        restriction_target_idx = i;
                    } else if (arg_expr->IsConstant()) {
                        child_buffer[i] = arg_expr;
                        ++arg_count_const;
                    }
                }
                auto child_expressions = std::span{child_buffer}.subspan(0, arg_nodes.size());

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
                        assert(child_expressions.size() == 2);
                        AnalyzedScript::Expression::Comparison inner{
                            .func = readComparisonFunction(op_type),
                            .left_expression_id = child_expressions[0]->expression_id.GetObject(),
                            .right_expression_id = child_expressions[1]->expression_id.GetObject(),
                            .restriction_target_left = restriction_target_idx == 0,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_restriction = true;
                        state.expression_index[node_id] = &n;
                        restriction_list.PushBack(n);
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

void IdentifyRestrictionsPass::Finish() {}

}  // namespace dashql
