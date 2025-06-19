#include "dashql/analyzer/identify_constexprs_pass.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/ast_reader.h"

namespace dashql {

IdentifyConstExprsPass::IdentifyConstExprsPass(AnalyzedScript& analyzed, Catalog& catalog,
                                               AttributeIndex& attribute_index)
    : scanned(*analyzed.parsed_script->scanned_script),
      parsed(*analyzed.parsed_script),
      analyzed(analyzed),
      catalog_entry_id(parsed.external_id),
      catalog(catalog),
      attribute_index(attribute_index),
      ast(parsed.nodes),
      constexpr_map(),
      constexpr_list() {}

void IdentifyConstExprsPass::Prepare() { constexpr_map.resize(ast.size(), nullptr); }

using AttributeKey = buffers::parser::AttributeKey;
using ExpressionOperator = buffers::parser::ExpressionOperator;
using LiteralType = buffers::algebra::LiteralType;
using Node = buffers::parser::Node;
using NodeType = buffers::parser::NodeType;

// Helper to map a node type to a literal type
constexpr LiteralType getLiteralType(NodeType nodeType) {
    assert(nodeType >= NodeType::LITERAL_NULL);
    assert(nodeType <= NodeType::LITERAL_INTERVAL);
    return static_cast<LiteralType>(static_cast<size_t>(nodeType) - 5);
}
static_assert(getLiteralType(NodeType::LITERAL_NULL) == LiteralType::NULL_);
static_assert(getLiteralType(NodeType::LITERAL_FLOAT) == LiteralType::FLOAT);
static_assert(getLiteralType(NodeType::LITERAL_STRING) == LiteralType::STRING);
static_assert(getLiteralType(NodeType::LITERAL_INTEGER) == LiteralType::INTEGER);
static_assert(getLiteralType(NodeType::LITERAL_INTERVAL) == LiteralType::INTERVAL);

using BinaryExpressionFunction = buffers::algebra::BinaryExpressionFunction;

constexpr BinaryExpressionFunction getBinaryExpressionFunction(ExpressionOperator op) {
    switch (op) {
#define X(OP)                    \
    case ExpressionOperator::OP: \
        return BinaryExpressionFunction::OP;

        X(PLUS)
        X(MINUS)
        X(MULTIPLY)
        X(DIVIDE)
        X(MODULUS)
        X(XOR)
        X(LESS_THAN)
        X(LESS_EQUAL)
        X(GREATER_THAN)
        X(GREATER_EQUAL)
        X(NOT_EQUAL)
        X(AND)
        X(OR)
#undef X
        default:
            return BinaryExpressionFunction::UNKNOWN;
    }
}

void IdentifyConstExprsPass::Visit(std::span<buffers::parser::Node> morsel) {
    std::vector<const AnalyzedScript::Expression*> child_expressions_buffer;

    size_t morsel_offset = morsel.data() - ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            // Base case, literals
            case NodeType::LITERAL_FLOAT:
            case NodeType::LITERAL_INTEGER:
            case NodeType::LITERAL_INTERVAL:
            case NodeType::LITERAL_NULL:
            case NodeType::LITERAL_STRING: {
                AnalyzedScript::Expression::Literal inner{.literal_type = getLiteralType(node.node_type()),
                                                          .raw_value = scanned.ReadTextAtLocation(node.location())};
                auto& n = analyzed.AddExpression(node_id, node.location(), std::move(inner));
                constexpr_map[node_id] = &n;
                constexpr_list.PushBack(n);
                break;
            }

            // N-ary expressions
            case NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = attribute_index.Load(children);
                auto op_node = child_attrs[AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (op_node) {
                    assert(op_node->node_type() == NodeType::ENUM_SQL_EXPRESSION_OPERATOR);

                    // Are all children const?
                    auto arg_nodes = readExpressionArgs(child_attrs[AttributeKey::SQL_EXPRESSION_ARGS], ast);
                    bool all_args_const = true;
                    if (child_expressions_buffer.size() < arg_nodes.size()) {
                        child_expressions_buffer.resize(arg_nodes.size());
                    }
                    for (size_t i = 0; i < arg_nodes.size(); ++i) {
                        child_expressions_buffer[i] = GetConstExpr(arg_nodes[i]);
                        all_args_const &= child_expressions_buffer[i] != nullptr;
                    }
                    auto child_expressions = std::span{child_expressions_buffer}.subspan(0, arg_nodes.size());
                    if (all_args_const) {
                        // Translate the expression type
                        ExpressionOperator op_type =
                            static_cast<ExpressionOperator>(op_node->children_begin_or_value());
                        switch (op_type) {
                            // Binary expressions
                            case ExpressionOperator::PLUS:
                            case ExpressionOperator::MINUS:
                            case ExpressionOperator::MULTIPLY:
                            case ExpressionOperator::DIVIDE:
                            case ExpressionOperator::MODULUS:
                            case ExpressionOperator::XOR:
                            case ExpressionOperator::LESS_THAN:
                            case ExpressionOperator::LESS_EQUAL:
                            case ExpressionOperator::GREATER_THAN:
                            case ExpressionOperator::GREATER_EQUAL:
                            case ExpressionOperator::NOT_EQUAL:
                            case ExpressionOperator::AND:
                            case ExpressionOperator::OR: {
                                assert(child_expressions.size() == 2);
                                AnalyzedScript::Expression::BinaryExpression inner{
                                    .func = getBinaryExpressionFunction(op_type),
                                    .left_expression_id = child_expressions[0]->expression_id.GetObject(),
                                    .right_expression_id = child_expressions[1]->expression_id.GetObject(),
                                };
                                auto& n = analyzed.AddExpression(node_id, node.location(), std::move(inner));
                                constexpr_map[node_id] = &n;
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
                }
                break;
            }

            default:
                break;
        }
    }
}

void IdentifyConstExprsPass::Finish() {}

}  // namespace dashql
