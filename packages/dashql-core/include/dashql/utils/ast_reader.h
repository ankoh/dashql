#include <span>

#include "dashql/buffers/index_generated.h"

namespace dashql {

inline std::span<const buffers::parser::Node> readExpressionArgs(const buffers::parser::Node& args_node,
                                                                 std::span<const buffers::parser::Node> ast) {
    // Ensured by caller
    assert(args_node.attribute_key() == buffers::parser::AttributeKey::SQL_EXPRESSION_ARGS);
    // Ensured by parser
    assert(args_node.node_type() == buffers::parser::NodeType::ARRAY);
    // Return the children
    return ast.subspan(args_node.children_begin_or_value(), args_node.children_count());
}

inline std::span<const buffers::parser::Node> readExpressionArgs(const buffers::parser::Node* args_node,
                                                                 std::span<const buffers::parser::Node> ast) {
    return !args_node ? std::span<const buffers::parser::Node>{} : readExpressionArgs(*args_node, ast);
}

// Helper to read a literal type
constexpr buffers::algebra::LiteralType getLiteralType(buffers::parser::NodeType nodeType) {
    assert(nodeType >= buffers::parser::NodeType::LITERAL_NULL);
    assert(nodeType <= buffers::parser::NodeType::LITERAL_INTERVAL);
    return static_cast<buffers::algebra::LiteralType>(static_cast<size_t>(nodeType) - 5);
}
static_assert(getLiteralType(buffers::parser::NodeType::LITERAL_NULL) == buffers::algebra::LiteralType::NULL_);
static_assert(getLiteralType(buffers::parser::NodeType::LITERAL_FLOAT) == buffers::algebra::LiteralType::FLOAT);
static_assert(getLiteralType(buffers::parser::NodeType::LITERAL_STRING) == buffers::algebra::LiteralType::STRING);
static_assert(getLiteralType(buffers::parser::NodeType::LITERAL_INTEGER) == buffers::algebra::LiteralType::INTEGER);
static_assert(getLiteralType(buffers::parser::NodeType::LITERAL_INTERVAL) == buffers::algebra::LiteralType::INTERVAL);

// Helper to read a binary expression function
constexpr buffers::algebra::BinaryExpressionFunction readBinaryExpressionFunction(
    buffers::parser::ExpressionOperator op) {
    switch (op) {
#define X(OP)                                     \
    case buffers::parser::ExpressionOperator::OP: \
        return buffers::algebra::BinaryExpressionFunction::OP;

        X(PLUS)
        X(MINUS)
        X(MULTIPLY)
        X(DIVIDE)
        X(MODULUS)
        X(XOR)
#undef X
        default:
            return buffers::algebra::BinaryExpressionFunction::UNKNOWN;
    }
}

// Helper to read a comparison function
constexpr buffers::algebra::ComparisonFunction readComparisonFunction(buffers::parser::ExpressionOperator op) {
    switch (op) {
#define X(OP)                                     \
    case buffers::parser::ExpressionOperator::OP: \
        return buffers::algebra::ComparisonFunction::OP;

        X(EQUAL)
        X(NOT_EQUAL)
        X(LESS_EQUAL)
        X(LESS_THAN)
        X(GREATER_EQUAL)
        X(GREATER_THAN)
#undef X
        default:
            return buffers::algebra::ComparisonFunction::UNKNOWN;
    }
}

}  // namespace dashql
