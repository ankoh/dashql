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

}  // namespace dashql
