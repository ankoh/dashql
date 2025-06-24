#include "dashql/analyzer/identify_column_transforms_pass.h"

#include "dashql/analyzer/analyzer.h"

namespace dashql {

IdentifyColumnTransformsPass::IdentifyColumnTransformsPass(AnalysisState& state) : PassManager::LTRPass(state) {}

void IdentifyColumnTransformsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>>
IdentifyColumnTransformsPass::readTransformArgs(std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    size_t arg_count_const = 0;
    size_t arg_count_transform = 0;
    size_t transform_target_idx = 0;
    for (size_t i = 0; i < nodes.size(); ++i) {
        auto* arg_expr = state.GetAnalyzed<AnalyzedScript::Expression>(nodes[i]);
        if (!arg_expr) continue;
        if (arg_expr->IsColumnTransform()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_transform;
            transform_target_idx = i;
        } else if (arg_expr->IsConstantExpression()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_const;
        }
    }
    // Is a transform?
    // There must be at most 1 child transform, the rest must be const
    bool is_transform = arg_count_transform == 1 && ((arg_count_transform + arg_count_const) == nodes.size());
    auto args = std::span{tmp_expressions}.subspan(0, nodes.size());
    std::pair<std::span<AnalyzedScript::Expression*>, size_t> result{args, transform_target_idx};
    return (!is_transform) ? std::nullopt : std::optional{result};
}

void IdentifyColumnTransformsPass::Visit(std::span<const buffers::parser::Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> const_child_exprs;
    std::vector<const AnalyzedScript::Expression*> child_projections;

    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        size_t node_id = state.GetNodeId(node);

        switch (node.node_type()) {
            case buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto [op_node, args_node] =
                    state.GetAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
                if (!op_node) continue;
                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                // Read transforms arguments
                auto arg_nodes = state.ReadArgNodes(args_node);
                auto maybe_arg_exprs = readTransformArgs(arg_nodes);
                if (!maybe_arg_exprs) continue;
                auto [arg_exprs, transform_target_id] = maybe_arg_exprs.value();

                ExpressionOperator op_type = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
                switch (static_cast<buffers::parser::ExpressionOperator>(op_node->children_begin_or_value())) {
                    case buffers::parser::ExpressionOperator::PLUS:
                    case buffers::parser::ExpressionOperator::MINUS:
                    case buffers::parser::ExpressionOperator::MULTIPLY:
                    case buffers::parser::ExpressionOperator::DIVIDE:
                    case buffers::parser::ExpressionOperator::MODULUS:
                    case buffers::parser::ExpressionOperator::XOR: {
                        assert(arg_exprs.size() == 2);
                        AnalyzedScript::Expression::BinaryExpression inner{
                            .func = AnalysisState::ReadBinaryExpressionFunction(op_type),
                            .left_expression_id = arg_exprs[0]->expression_id,
                            .right_expression_id = arg_exprs[1]->expression_id,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_column_transform = true;
                        n.transform_target_id = arg_exprs[transform_target_id]->expression_id;
                        state.SetAnalyzed(node, n);
                        transforms.PushBack(n);
                        break;
                    }
                    case buffers::parser::ExpressionOperator::NEGATE:
                    case buffers::parser::ExpressionOperator::NOT:
                        break;
                    case buffers::parser::ExpressionOperator::LIKE:
                    case buffers::parser::ExpressionOperator::ILIKE:
                    case buffers::parser::ExpressionOperator::NOT_LIKE:
                    case buffers::parser::ExpressionOperator::NOT_ILIKE:
                    default:
                        break;
                }
                break;
            }

            case NodeType::OBJECT_SQL_FUNCTION_EXPRESSION: {
                // Did name resolution create a function expression?
                // Skip the node, if not
                auto* expr = state.GetAnalyzed<AnalyzedScript::Expression>(node);
                if (!expr) continue;
                assert(std::holds_alternative<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner));
                auto& func_expr = std::get<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner);

                // Skip functions with any modifier
                if (func_expr.function_call_modifiers != 0) continue;

                switch (func_expr.arguments.index()) {
                    case 1: {
                        auto func_args =
                            std::get<std::span<AnalyzedScript::Expression::FunctionArgument>>(func_expr.arguments);

                        // Are all function call arguments constant or a single transform?
                        size_t arg_count_const = 0;
                        size_t arg_count_transform = 0;
                        uint32_t transform_target_id = 0;
                        for (size_t i = 0; i < func_args.size(); ++i) {
                            auto& arg = func_args[i];
                            auto* arg_expr = state.GetAnalyzed<AnalyzedScript::Expression>(arg.value_ast_node_id);
                            if (!arg_expr) break;

                            arg.expression_id = arg_expr->expression_id;
                            arg_count_const += arg_expr->is_constant_expression;
                            if (arg_expr->is_column_transform) {
                                arg_count_transform += 1;
                                transform_target_id = arg_expr->expression_id;
                            }
                        }

                        // Is a column transform?
                        expr->is_column_transform =
                            arg_count_transform == 1 && ((arg_count_transform + arg_count_const) == func_args.size());
                        if (expr->is_column_transform) {
                            expr->transform_target_id = transform_target_id;
                        }
                        transforms.PushBack(*expr);
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

void IdentifyColumnTransformsPass::Finish() {
    // Filter all nodes that don't have a transform parent
    transforms.Filter([&](AnalyzedScript::Expression& expr) {
        const buffers::parser::Node& node = state.ast[expr.ast_node_id];
        auto* parent_expr = state.GetAnalyzed<AnalyzedScript::Expression>(node.parent());
        return !parent_expr || !parent_expr->is_column_transform;
    });

    // Add the transforms
    state.analyzed->column_transforms.Append(std::move(transforms));
}

}  // namespace dashql
