#include "dashql/analyzer/identify_constants_pass.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/string_trimming.h"

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
      constexpr_bitmap(),
      constexpr_roots() {}

void IdentifyConstExprsPass::Prepare() {}

using NodeType = buffers::parser::NodeType;
using LiteralType = buffers::algebra::LiteralType;
constexpr LiteralType getLiteralType(NodeType nodeType) {
    return static_cast<LiteralType>(static_cast<size_t>(nodeType) - 5);
}

static_assert(getLiteralType(NodeType::LITERAL_NULL) == LiteralType::NULL_);
static_assert(getLiteralType(NodeType::LITERAL_FLOAT) == LiteralType::FLOAT);
static_assert(getLiteralType(NodeType::LITERAL_STRING) == LiteralType::STRING);
static_assert(getLiteralType(NodeType::LITERAL_INTEGER) == LiteralType::INTEGER);
static_assert(getLiteralType(NodeType::LITERAL_INTERVAL) == LiteralType::INTERVAL);

void IdentifyConstExprsPass::Visit(std::span<buffers::parser::Node> morsel) {
    size_t morsel_offset = morsel.data() - ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        buffers::parser::Node& node = morsel[i];
        NodeID node_id = morsel_offset + i;

        switch (node.node_type()) {
            case buffers::parser::NodeType::LITERAL_FLOAT:
            case buffers::parser::NodeType::LITERAL_INTEGER:
            case buffers::parser::NodeType::LITERAL_INTERVAL:
            case buffers::parser::NodeType::LITERAL_NULL:
            case buffers::parser::NodeType::LITERAL_STRING: {
                auto& n = analyzed.expressions.Append(AnalyzedScript::Expression());
                n.buffer_index = analyzed.expressions.GetSize() - 1;
                n.expression_id =
                    ContextObjectID{catalog_entry_id, static_cast<uint32_t>(analyzed.expressions.GetSize() - 1)};
                n.ast_node_id = node_id;
                n.location = node.location();
                n.inner = AnalyzedScript::Expression::Literal{.literal_type = getLiteralType(node.node_type())};
                analyzed.expressions.Append(AnalyzedScript::Expression{

                });
                break;
            }
            default:
                break;
        }
    }
}

void IdentifyConstExprsPass::Finish() {}

}  // namespace dashql
