#include "dashql/analyzer/identify_constexprs_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/utils/ast_reader.h"

namespace dashql {

IdentifyConstExprsPass::IdentifyConstExprsPass(AnalyzerState& state) : PassManager::LTRPass(state) {}

void IdentifyConstExprsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using BinaryExpressionFunction = buffers::algebra::BinaryExpressionFunction;
using ComparisonFunction = buffers::algebra::ComparisonFunction;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

void IdentifyConstExprsPass::Visit(std::span<const buffers::parser::Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> child_buffer;

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
                    .literal_type = getLiteralType(node.node_type()),
                    .raw_value = state.scanned.ReadTextAtLocation(node.location())};
                auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                n.is_constant = true;
                state.expression_index[node_id] = &n;
                constexpr_list.PushBack(n);
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
                auto arg_nodes = readExpressionArgs(child_attrs[AttributeKey::SQL_EXPRESSION_ARGS], state.ast);
                bool all_args_const = true;
                if (child_buffer.size() < arg_nodes.size()) {
                    child_buffer.resize(arg_nodes.size());
                }
                for (size_t i = 0; i < arg_nodes.size(); ++i) {
                    size_t arg_node_id = (arg_nodes.data() - state.ast.data()) + i;
                    auto* arg_expr = state.expression_index[arg_node_id];
                    if (arg_expr && arg_expr->IsConstant()) {
                        child_buffer[i] = arg_expr;
                    } else {
                        all_args_const = false;
                    }
                }
                auto child_expressions = std::span{child_buffer}.subspan(0, arg_nodes.size());
                if (!all_args_const) continue;

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
                        assert(child_expressions.size() == 2);
                        AnalyzedScript::Expression::BinaryExpression inner{
                            .func = readBinaryExpressionFunction(op_type),
                            .left_expression_id = child_expressions[0]->expression_id.GetObject(),
                            .right_expression_id = child_expressions[1]->expression_id.GetObject(),
                            .projection_target_left = false,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant = true;
                        state.expression_index[node_id] = &n;
                        constexpr_list.PushBack(n);
                        break;
                    }

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
                            .restriction_target_left = false,
                        };
                        auto& n = state.analyzed->AddExpression(node_id, node.location(), std::move(inner));
                        n.is_constant = true;
                        state.expression_index[node_id] = &n;
                        constexpr_list.PushBack(n);
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
            default:
                break;
        }
    }
}

void IdentifyConstExprsPass::Finish() {}

}  // namespace dashql
