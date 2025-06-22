#include "dashql/analyzer/identify_constant_expressions_pass.h"

#include <variant>

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyConstantExpressionsPass::IdentifyConstantExpressionsPass(AnalysisState& state) : PassManager::LTRPass(state) {}

void IdentifyConstantExpressionsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using BinaryExpressionFunction = buffers::algebra::BinaryExpressionFunction;
using ComparisonFunction = buffers::algebra::ComparisonFunction;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

std::optional<std::span<AnalyzedScript::Expression*>> IdentifyConstantExpressionsPass::readConstExprs(
    std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    bool all_args_const = true;
    for (size_t i = 0; i < nodes.size(); ++i) {
        size_t arg_node_id = state.GetNodeId(nodes[i]);
        auto* arg_expr = state.expression_index[arg_node_id];
        auto* const_expr = (arg_expr && arg_expr->IsConstantExpression()) ? arg_expr : nullptr;
        all_args_const &= const_expr != nullptr;
        tmp_expressions[i] = const_expr;
    }
    return !all_args_const ? std::nullopt : std::optional{std::span{tmp_expressions}.subspan(0, nodes.size())};
}

void IdentifyConstantExpressionsPass::Visit(std::span<const buffers::parser::Node> morsel) {
    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        size_t node_id = state.GetNodeId(node);

        switch (node.node_type()) {
            // Base case, literals
            case NodeType::LITERAL_FLOAT:
            case NodeType::LITERAL_INTEGER:
            case NodeType::LITERAL_INTERVAL:
            case NodeType::LITERAL_NULL:
            case NodeType::LITERAL_STRING: {
                AnalyzedScript::Expression::Literal inner{
                    .literal_type = AnalysisState::GetLiteralType(node.node_type()),
                    .raw_value = state.scanned.ReadTextAtLocation(node.location())};
                auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                n.is_constant_expression = true;
                state.expression_index[node_id] = &n;
                constants.PushBack(n);
                break;
            }

            // interval '30 days'
            case NodeType::OBJECT_SQL_CONST_INTERVAL_CAST: {
                auto [value_node, interval_node] =
                    state.GetAttributes<AttributeKey::SQL_CONST_CAST_VALUE, AttributeKey::SQL_CONST_CAST_INTERVAL>(
                        node);

                // Check if the value is constant
                if (!value_node) continue;
                auto value_node_id = state.GetNodeId(*value_node);
                auto* value_expr = state.expression_index[value_node_id];
                if (!value_expr || !value_expr->IsConstantExpression()) continue;

                AnalyzedScript::Expression::ConstIntervalCast inner{
                    .value_expression_id = value_expr->expression_id,
                    .interval = std::nullopt,
                };

                // Has an interval specified?
                if (interval_node) {
                    assert(interval_node->node_type() == NodeType::OBJECT_SQL_INTERVAL_TYPE);
                    auto [type_attr, precision_attr] =
                        state.GetAttributes<AttributeKey::SQL_INTERVAL_TYPE, AttributeKey::SQL_INTERVAL_PRECISION>(
                            *interval_node);
                    assert(type_attr != nullptr);
                    auto interval_type =
                        static_cast<buffers::parser::IntervalType>(type_attr->children_begin_or_value());
                    std::optional<size_t> precision_expression = std::nullopt;
                    if (precision_attr) {
                        if (auto expr = state.expression_index[state.GetNodeId(*precision_attr)]) {
                            precision_expression = inner.interval->precision_expression;
                        }
                    }
                    inner.interval = AnalyzedScript::Expression::IntervalType{
                        .interval_type = interval_type,
                        .precision_expression = precision_expression,
                    };
                }

                auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                n.is_constant_expression = true;
                state.expression_index[node_id] = &n;
                constants.PushBack(n);
                break;
            }

            // N-ary expressions
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto [op_node, args_node] =
                    state.GetAttributes<AttributeKey::SQL_EXPRESSION_OPERATOR, AttributeKey::SQL_EXPRESSION_ARGS>(node);
                if (!op_node) continue;
                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                // Are all children const?
                auto arg_nodes = state.ReadArgNodes(args_node);
                auto maybe_const_args = readConstExprs(arg_nodes);
                if (!maybe_const_args.has_value()) continue;
                auto& const_args = maybe_const_args.value();

                // Translate the expression type
                ExpressionOperator op_type = static_cast<ExpressionOperator>(op_node->children_begin_or_value());
                switch (op_type) {
                    // Binary expressions
                    case ExpressionOperator::PLUS:
                    case ExpressionOperator::MINUS:
                    case ExpressionOperator::MULTIPLY:
                    case ExpressionOperator::DIVIDE:
                    case ExpressionOperator::MODULUS:
                    case ExpressionOperator::XOR:
                    case ExpressionOperator::AND:
                    case ExpressionOperator::OR: {
                        assert(const_args.size() == 2);
                        AnalyzedScript::Expression::BinaryExpression inner{
                            .func = AnalysisState::ReadBinaryExpressionFunction(op_type),
                            .left_expression_id = const_args[0]->expression_id,
                            .right_expression_id = const_args[1]->expression_id,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant_expression = true;
                        state.expression_index[node_id] = &n;
                        constants.PushBack(n);
                        break;
                    }

                    // Comparisons
                    case ExpressionOperator::EQUAL:
                    case ExpressionOperator::NOT_EQUAL:
                    case ExpressionOperator::LESS_THAN:
                    case ExpressionOperator::LESS_EQUAL:
                    case ExpressionOperator::GREATER_THAN:
                    case ExpressionOperator::GREATER_EQUAL: {
                        assert(const_args.size() == 2);
                        AnalyzedScript::Expression::Comparison inner{
                            .func = AnalysisState::ReadComparisonFunction(op_type),
                            .left_expression_id = const_args[0]->expression_id,
                            .right_expression_id = const_args[1]->expression_id,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant_expression = true;
                        state.expression_index[node_id] = &n;
                        constants.PushBack(n);
                        break;
                    }

                    // Unary expressions
                    case ExpressionOperator::NEGATE:
                    case ExpressionOperator::NOT:
                        break;
                    default:
                        break;
                }
                break;
            }
            // Function call expression
            case NodeType::OBJECT_SQL_FUNCTION_EXPRESSION: {
                // Did name resolution create a function expression?
                // Skip the node, if not
                auto& expr = state.expression_index[node_id];
                if (!expr) continue;
                assert(std::holds_alternative<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner));
                auto& func_expr = std::get<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner);

                // Skip functions with any modifiers
                if (func_expr.function_call_modifiers != 0) continue;

                // Are all function call arguments constant?
                switch (func_expr.arguments.index()) {
                    case 1: {
                        for (auto& arg :
                             std::get<std::span<AnalyzedScript::Expression::FunctionArgument>>(func_expr.arguments)) {
                            auto* arg_expr = state.expression_index[arg.value_ast_node_id];
                            if (!arg_expr) {
                                expr->is_constant_expression = false;
                                break;
                            } else {
                                arg.expression_id = arg_expr->expression_id;
                                expr->is_constant_expression &= arg_expr->is_constant_expression;
                            }
                        }
                        if (expr->is_constant_expression) {
                            constants.PushBack(*expr);
                        }
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

void IdentifyConstantExpressionsPass::Finish() {
    // Filter all nodes that don't have a constant parent
    constants.Filter([&](AnalyzedScript::Expression& expr) {
        const buffers::parser::Node& node = state.ast[expr.ast_node_id];
        auto* parent_expr = state.expression_index[node.parent()];
        return !parent_expr || !parent_expr->is_constant_expression;
    });

    // Add the constants
    state.analyzed->constant_expressions.Append(std::move(constants));
}

}  // namespace dashql
