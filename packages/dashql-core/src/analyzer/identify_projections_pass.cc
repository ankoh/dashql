#include "dashql/analyzer/identify_projections_pass.h"

namespace dashql {

IdentifyProjectionsPass::IdentifyProjectionsPass(AnalyzedScript& analyzed, Catalog& catalog,
                                                 AttributeIndex& attribute_index, NameResolutionPass& name_resolution,
                                                 IdentifyConstExprsPass& identify_constants)
    : scanned(*analyzed.parsed_script->scanned_script),
      parsed(*analyzed.parsed_script),
      analyzed(analyzed),
      catalog_entry_id(parsed.external_id),
      catalog(catalog),
      attribute_index(attribute_index),
      ast(parsed.nodes),
      name_resolution(name_resolution),
      identify_constexprs(identify_constants),
      projection_bitmap(),
      projection_roots() {}

void IdentifyProjectionsPass::Prepare() {}

void IdentifyProjectionsPass::Visit(std::span<buffers::parser::Node> morsel) {
    size_t morsel_offset = morsel.data() - ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION: {
                auto children = ast.subspan(node.children_begin_or_value(), node.children_count());
                auto child_attrs = attribute_index.Load(children);
                auto op_node = child_attrs[buffers::parser::AttributeKey::SQL_EXPRESSION_OPERATOR];
                if (op_node) {
                    assert(op_node->node_type() == buffers::parser::NodeType::ENUM_SQL_EXPRESSION_OPERATOR);
                    switch (static_cast<buffers::parser::ExpressionOperator>(op_node->children_begin_or_value())) {
                        case buffers::parser::ExpressionOperator::PLUS:
                        case buffers::parser::ExpressionOperator::MULTIPLY:
                        case buffers::parser::ExpressionOperator::MINUS:
                        case buffers::parser::ExpressionOperator::DIVIDE:
                        case buffers::parser::ExpressionOperator::MODULUS:
                        case buffers::parser::ExpressionOperator::XOR:
                        case buffers::parser::ExpressionOperator::NEGATE:
                        case buffers::parser::ExpressionOperator::NOT:
                            break;
                        case buffers::parser::ExpressionOperator::LIKE:
                            break;
                        case buffers::parser::ExpressionOperator::ILIKE:
                            break;
                        case buffers::parser::ExpressionOperator::NOT_LIKE:
                            break;
                        case buffers::parser::ExpressionOperator::NOT_ILIKE:
                            break;
                        default:
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

void IdentifyProjectionsPass::Finish() {}

}  // namespace dashql
