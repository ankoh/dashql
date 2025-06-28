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
using SemanticNodeMarkerType = buffers::analyzer::SemanticNodeMarkerType;

std::optional<std::pair<std::span<AnalyzedScript::Expression*>, size_t>>
IdentifyColumnRestrictionsPass::readRestrictionArgs(std::span<const buffers::parser::Node> nodes) {
    if (tmp_expressions.size() < nodes.size()) {
        tmp_expressions.resize(nodes.size(), nullptr);
    }
    size_t arg_count_const = 0;
    size_t arg_count_projection = 0;
    std::optional<size_t> restriction_target_idx = std::nullopt;
    for (size_t i = 0; i < nodes.size(); ++i) {
        auto* arg_expr = state.GetDerivedForNode<AnalyzedScript::Expression>(nodes[i]);
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
    bool is_restriction = arg_count_projection == 1 && ((arg_count_projection + arg_count_const) == nodes.size());
    if (!is_restriction) {
        return std::nullopt;
    } else {
        assert(restriction_target_idx.has_value());
        auto args = std::span{tmp_expressions}.subspan(0, nodes.size());
        return std::pair<std::span<AnalyzedScript::Expression*>, size_t>{args, *restriction_target_idx};
    }
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
                        n.target_expression_id = arg_exprs[restriction_target_idx]->expression_id;
                        state.SetDerivedForNode(node, n);
                        state.MarkNode(node, SemanticNodeMarkerType::COLUMN_RESTRICTION);
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

void IdentifyColumnRestrictionsPass::Finish() {
    // Store restrictions in the analyzed script
    for (auto& expr : restrictions) {
        const buffers::parser::Node& node = state.ast[expr.ast_node_id];
        auto* parent_expr = state.GetDerivedForNode<AnalyzedScript::Expression>(node.parent());

        // Only store the roots of restrictions.
        // This is actually unexpected for column restrictions...
        if (parent_expr && parent_expr->is_column_restriction) {
            assert(false && "column restrictions should not be recursive");
            continue;
        }
        assert(!expr.IsColumnRef());
        assert(expr.target_expression_id.has_value());

        // Follor transform target ids until we find a column ref
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
        auto& restriction = state.analyzed->column_restrictions.PushBack(AnalyzedScript::ColumnRestriction{
            .root = expr,
            .column_ref = *iter,
        });

        // Register column restriction
        auto& column_ref = std::get<AnalyzedScript::Expression::ColumnRef>(iter->inner);
        if (auto resolved = column_ref.resolved_column) {
            std::tuple<ContextObjectID, ColumnID> key{resolved->catalog_table_id, resolved->table_column_id};
            state.analyzed->column_restrictions_by_catalog_entry.insert({key, restriction});
        }
    }
}

}  // namespace dashql
