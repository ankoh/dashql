#include "dashql/script_signature.h"

namespace dashql {

template <bool SkipNamesAndLiterals>
static size_t ScriptsAreEqualImpl(std::string_view left_text, std::span<const buffers::parser::Node> left_ast,
                                  NameResolver& left_names, std::string_view right_text,
                                  std::span<const buffers::parser::Node> right_ast, NameResolver& right_names) {
    if (left_ast.size() != right_ast.size()) {
        return false;
    }
    bool equal = true;
    for (size_t i = 0; i < left_ast.size() && equal; ++i) {
        auto& node_left = left_ast[i];
        auto& node_right = right_ast[i];

        equal &= node_left.node_type() == node_right.node_type();
        equal &= node_left.attribute_key() == node_right.attribute_key();

        switch (node_left.node_type()) {
            case buffers::parser::NodeType::NAME:
                if constexpr (!SkipNamesAndLiterals) {
                    std::string_view name_left = left_names(node_left.children_begin_or_value());
                    std::string_view name_right = right_names(node_right.children_begin_or_value());
                    equal &= name_left == name_right;
                }
                break;
            case buffers::parser::NodeType::LITERAL_NULL:
            case buffers::parser::NodeType::LITERAL_FLOAT:
            case buffers::parser::NodeType::LITERAL_INTEGER:
            case buffers::parser::NodeType::LITERAL_INTERVAL:
            case buffers::parser::NodeType::LITERAL_STRING: {
                if constexpr (!SkipNamesAndLiterals) {
                    // Note that this is strictly speaking a little too lax.
                    // We ignore the rabbit hole of value interpretation here.
                    auto value_left = left_text.substr(node_left.location().offset(), node_left.location().length());
                    auto value_right =
                        right_text.substr(node_right.location().offset(), node_right.location().length());
                    equal &= value_left == value_right;
                }
                break;
            }
            default:
                equal &= node_left.children_begin_or_value() == node_right.children_begin_or_value();
                equal &= node_left.children_count() == node_right.children_count();
                break;
        }
    }
    return equal;
}

size_t ScriptsAreEqual(std::string_view left_text, std::span<const buffers::parser::Node> left_ast,
                       NameResolver& left_names, std::string_view right_text,
                       std::span<const buffers::parser::Node> right_ast, NameResolver& right_names,
                       bool skip_names_and_literals) {
    if (skip_names_and_literals) {
        return ScriptsAreEqualImpl<true>(left_text, left_ast, left_names, right_text, right_ast, right_names);
    } else {
        return ScriptsAreEqualImpl<false>(left_text, left_ast, left_names, right_text, right_ast, right_names);
    }
}

}  // namespace dashql
