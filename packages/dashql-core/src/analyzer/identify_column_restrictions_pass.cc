#include "dashql/analyzer/identify_column_restrictions_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyColumnRestrictionsPass::IdentifyColumnRestrictionsPass(AnalysisState& state) : PassManager::LTRPass(state) {}

void IdentifyColumnRestrictionsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>>
IdentifyColumnRestrictionsPass::readRestrictionArgs(std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    size_t arg_count_const = 0;
    size_t arg_count_projection = 0;
    size_t restriction_target_idx = 0;
    for (size_t i = 0; i < nodes.size(); ++i) {
        size_t arg_node_id = state.GetNodeId(nodes[i]);
        auto* arg_expr = state.expression_index[arg_node_id];
        if (!arg_expr) continue;
        if (arg_expr->IsColumnTransform()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_projection;
            restriction_target_idx = i;
        } else if (arg_expr->IsConstantExpression()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_const;
        }
    }
    auto args = std::span{tmp_expressions}.subspan(0, nodes.size());
    std::pair<std::span<AnalyzedScript::Expression*>, size_t> result{args, restriction_target_idx};

    // Is restriction?
    bool is_restriction = arg_count_projection == 1 && ((arg_count_projection + arg_count_const) == nodes.size());
    return (!is_restriction) ? std::nullopt : std::optional{result};
}

void IdentifyColumnRestrictionsPass::Visit(std::span<const Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> child_buffer;

    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        size_t node_id = state.GetNodeId(node);

        switch (node.node_type()) {
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto [op_node, args_node] =
                    state.GetAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
                if (!op_node) continue;
                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                // Read restriction arguments
                auto arg_nodes = state.ReadArgNodes(args_node);
                auto maybe_arg_exprs = readRestrictionArgs(arg_nodes);
                if (!maybe_arg_exprs) continue;
                auto [arg_exprs, restriction_target_idx] = maybe_arg_exprs.value();

                ExpressionOperator op_type = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
                switch (op_type) {
                    // Comparisons
                    case ExpressionOperator::EQUAL:
                    case ExpressionOperator::NOT_EQUAL:
                    case ExpressionOperator::LESS_THAN:
                    case ExpressionOperator::LESS_EQUAL:
                    case ExpressionOperator::GREATER_THAN:
                    case ExpressionOperator::GREATER_EQUAL: {
                        assert(arg_exprs.size() == 2);
                        AnalyzedScript::Expression::Comparison inner{
                            .func = AnalysisState::ReadComparisonFunction(op_type),
                            .left_expression_id = arg_exprs[0]->expression_id,
                            .right_expression_id = arg_exprs[1]->expression_id,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_column_restriction = true;
                        n.restriction_target_id = arg_exprs[restriction_target_idx]->expression_id;
                        state.expression_index[node_id] = &n;
                        restrictions.PushBack(n);
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

void IdentifyColumnRestrictionsPass::Finish() { state.analyzed->column_restrictions.Append(std::move(restrictions)); }

}  // namespace dashql
