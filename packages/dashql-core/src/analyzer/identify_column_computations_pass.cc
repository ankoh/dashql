#include "dashql/analyzer/identify_column_computations_pass.h"

#include "dashql/analyzer/analyzer.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

IdentifyColumnTransformsPass::IdentifyColumnTransformsPass(AnalysisState& state) : PassManager::LTRPass(state) {}

void IdentifyColumnTransformsPass::Prepare() {}

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;
using SemanticNodeMarkerType = buffers::analyzer::SemanticNodeMarkerType;

std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>>
IdentifyColumnTransformsPass::readTransformArgs(std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    size_t arg_count_const = 0;
    size_t arg_count_computation = 0;
    std::optional<size_t> computation_target_idx = std::nullopt;
    for (size_t i = 0; i < nodes.size(); ++i) {
        auto* arg_expr = state.GetDerivedForNode<AnalyzedScript::Expression>(nodes[i]);
        if (!arg_expr) continue;
        if (arg_expr->IsColumnTransform()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_computation;
            computation_target_idx = i;
        } else if (arg_expr->IsConstantExpression()) {
            tmp_expressions[i] = arg_expr;
            ++arg_count_const;
        }
    }
    // Is a computation?
    // There must be at most 1 child computation, the rest must be const
    bool is_computation = arg_count_computation == 1 && ((arg_count_computation + arg_count_const) == nodes.size());
    if (!is_computation) {
        return std::nullopt;
    } else {
        assert(computation_target_idx.has_value());
        auto args = std::span{tmp_expressions}.subspan(0, nodes.size());
        return std::pair<std::span<AnalyzedScript::Expression*>, size_t>{args, *computation_target_idx};
    }
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

                // Read computations arguments
                auto arg_nodes = state.ReadArgNodes(args_node);
                auto maybe_arg_exprs = readTransformArgs(arg_nodes);
                if (!maybe_arg_exprs) continue;
                auto [arg_exprs, computation_target_idx] = maybe_arg_exprs.value();

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
                        n.is_column_computation = true;
                        n.target_expression_id = arg_exprs[computation_target_idx]->expression_id;
                        state.SetDerivedForNode(node, n);
                        state.MarkNode(node, SemanticNodeMarkerType::COLUMN_TRANSFORM);
                        computations.PushBack(n);
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
                auto* expr = state.GetDerivedForNode<AnalyzedScript::Expression>(node);
                if (!expr) continue;
                assert(std::holds_alternative<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner));
                auto& func_expr = std::get<AnalyzedScript::Expression::FunctionCallExpression>(expr->inner);

                // Skip functions with any modifier
                if (func_expr.function_call_modifiers != 0) continue;

                switch (func_expr.arguments.index()) {
                    case 1: {
                        auto func_args =
                            std::get<std::span<AnalyzedScript::Expression::FunctionArgument>>(func_expr.arguments);

                        // Are all function call arguments constant or a single computation?
                        size_t arg_count_const = 0;
                        size_t arg_count_computation = 0;
                        std::optional<uint32_t> computation_target_id = std::nullopt;
                        for (size_t i = 0; i < func_args.size(); ++i) {
                            auto& arg = func_args[i];
                            auto* arg_expr = state.GetDerivedForNode<AnalyzedScript::Expression>(arg.value_ast_node_id);
                            if (!arg_expr) break;

                            arg.expression_id = arg_expr->expression_id;
                            arg_count_const += arg_expr->is_constant_expression;
                            if (arg_expr->is_column_computation) {
                                arg_count_computation += 1;
                                computation_target_id = arg_expr->expression_id;
                            }
                        }

                        // Is a column computation?
                        if (arg_count_computation == 1 &&
                            ((arg_count_computation + arg_count_const) == func_args.size())) {
                            assert(computation_target_id.has_value());
                            expr->is_column_computation = true;
                            expr->target_expression_id = computation_target_id.value();
                            state.SetDerivedForNode(node, *expr);
                            state.MarkNode(node, SemanticNodeMarkerType::COLUMN_TRANSFORM);
                            computations.PushBack(*expr);
                        }
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
    // Store computations in the analyzed script
    for (auto& expr : computations) {
        const buffers::parser::Node& node = state.ast[expr.ast_node_id];
        auto* parent_expr = state.GetDerivedForNode<AnalyzedScript::Expression>(node.parent());

        // Only store the roots of computations
        if (parent_expr && parent_expr->is_column_computation) {
            continue;
        }
        assert(!expr.IsColumnRef());
        assert(expr.target_expression_id.has_value());

        // If object, mark as constant expression root
        if (node.node_type() >= NodeType::OBJECT_KEYS_) {
            state.MarkNode(node, SemanticNodeMarkerType::COLUMN_TRANSFORM_ROOT);
        }

        // Follor computation target ids until we find a column ref
        AnalyzedScript::Expression* iter = &expr;
        do {
            if (!iter->target_expression_id.has_value()) {
                break;
            }
            iter = state.GetExpression(*iter->target_expression_id);
            assert(iter != nullptr);

        } while (!iter->IsColumnRef());

        // There must be one, otherwise our pass has an error
        assert(iter->IsColumnRef());
        auto& computation = state.analyzed->column_computations.PushBack(AnalyzedScript::ColumnTransform{
            .root = expr,
            .column_ref = *iter,
        });

        // Register column computation
        auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(iter->inner);
        if (auto resolved = column_ref.resolved_column) {
            state.analyzed->column_computations_by_catalog_entry.insert(
                {resolved->catalog_table_column_id, computation});
        }
    }
}

}  // namespace dashql
