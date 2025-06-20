#include "dashql/analyzer/identify_constant_expressions_pass.h"

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

std::optional<std::span<const AnalyzedScript::Expression*>> IdentifyConstantExpressionsPass::readConstExprs(
    std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    bool all_args_const = true;
    for (size_t i = 0; i < nodes.size(); ++i) {
        size_t arg_node_id = (nodes.data() - state.ast.data()) + i;
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
        NodeID node_id = morsel_offset + i;

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
                state.analyzed->constant_expressions.PushBack(n);
                break;
            }

            // N-ary expressions
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = state.attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (!op_node) continue;

                assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                // Are all children const?
                auto arg_nodes = state.ReadArgExpressions(child_attrs[AttributeKey::SQL_EXPRESSION_ARGS]);
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
                            .left_expression_id = const_args[0]->expression_id.GetObject(),
                            .right_expression_id = const_args[1]->expression_id.GetObject(),
                            .projection_target_left = false,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant_expression = true;
                        state.expression_index[node_id] = &n;
                        state.analyzed->constant_expressions.PushBack(n);
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
                            .left_expression_id = const_args[0]->expression_id.GetObject(),
                            .right_expression_id = const_args[1]->expression_id.GetObject(),
                            .restriction_target_left = false,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant_expression = true;
                        state.expression_index[node_id] = &n;
                        state.analyzed->constant_expressions.PushBack(n);
                        break;
                    }

                    // Unary expressions
                    case ExpressionOperator::NEGATE:
                    case ExpressionOperator::NOT:
                        break;
                    default:
                        break;
                }
            }
            // Function call expression
            case NodeType::OBJECT_SQL_FUNCTION_EXPRESSION: {
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = state.attribute_index.Load(children);

                // Get name and argument attributes
                auto name_attr = child_attrs[AttributeKey::SQL_FUNCTION_NAME];
                auto args_attr = child_attrs[AttributeKey::SQL_FUNCTION_ARGUMENTS];
                if (node.children_count() != 2 || !name_attr || !args_attr) {
                    continue;
                }

                // Are all children const?
                auto arg_nodes = state.ReadArgExpressions(args_attr);
                auto maybe_const_args = readConstExprs(arg_nodes);
                if (!maybe_const_args.has_value()) continue;
                auto& const_args = maybe_const_args.value();

                // XXX Read a function name
                // XXX Check function arguments
                break;
            }

            default:
                break;
        }
    }
}

void IdentifyConstantExpressionsPass::Finish() {}

}  // namespace dashql
