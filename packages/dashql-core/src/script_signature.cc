#include "dashql/script_signature.h"

#include "dashql/utils/hash.h"

namespace dashql {

template <bool SkipNamesAndLiterals>
static size_t ComputeScriptSignatureImpl(std::string_view text, std::span<const buffers::parser::Node> ast,
                                         NameResolver& name_resolver) {
    size_t v = 0;
    for (auto& node : ast) {
        hash_combine(v, static_cast<uint16_t>(node.node_type()));
        hash_combine(v, static_cast<uint16_t>(node.attribute_key()));
        switch (node.node_type()) {
            case buffers::parser::NodeType::NAME:
                if constexpr (!SkipNamesAndLiterals) {
                    std::string_view text = name_resolver(node.children_begin_or_value());
                    hash_combine(v, text);
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
                    auto value = text.substr(node.location().offset(), node.location().length());
                    hash_combine(v, value);
                }
                break;
            }
            default:
                if (node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_) {
                    // Don't hash the children offset to stay compatible with stripped constants
                    hash_combine(v, static_cast<uint32_t>(node.children_count()));
                } else {
                    hash_combine(v, static_cast<uint16_t>(node.children_begin_or_value()));
                    hash_combine(v, static_cast<uint32_t>(node.children_count()));
                }
                break;
        }
    }
    return v;
}

size_t ComputeScriptSignature(std::string_view text, std::span<const buffers::parser::Node> ast,
                              NameResolver& name_resolver, bool skip_names_and_literals) {
    if (skip_names_and_literals) {
        return ComputeScriptSignatureImpl<true>(text, ast, name_resolver);
    } else {
        return ComputeScriptSignatureImpl<false>(text, ast, name_resolver);
    }
}

}  // namespace dashql
