#include "dashql/snippet.h"

namespace dashql {
namespace parser {

using Node = buffers::parser::Node;

static buffers::parser::Location patchLocation(buffers::parser::Location loc, size_t snippet_offset) {
    assert(loc.offset() >= snippet_offset);
    loc.mutate_offset(loc.offset() - snippet_offset);
    return loc;
}

ScriptSnippet ScriptSnippet::Extract(std::string_view text, std::span<const buffers::parser::Node> ast,
                                     size_t root_node_id, const NameRegistry& names) {
    // Return an empty snippet for invalid node ids
    if (root_node_id >= ast.size()) {
        return {};
    }

    // Prepare translating names
    std::unordered_map<size_t, size_t> translated_names_by_id;

    // Prepare patching locations
    auto& root_node = ast[root_node_id];
    size_t snippet_offset = root_node.location().offset();
    size_t snippet_size = root_node.location().length();

    // Write the root node
    ScriptSnippet out;
    out.text = text.substr(snippet_offset, snippet_size);
    {
        Node out_root{patchLocation(root_node.location(), snippet_offset),
                      root_node.node_type(),
                      root_node.attribute_key(),
                      0,
                      root_node.children_begin_or_value(),
                      root_node.children_count()};
        out.nodes.push_back(root_node);
    }

    // Perform the pre-order DFS
    std::vector<std::pair<size_t, size_t>> pending;
    pending.push_back({root_node_id, 0});
    while (!pending.empty()) {
        auto [source_node_id, output_node_id] = pending.back();
        pending.pop_back();

        // Output all the children of the node (if any)
        auto& source_node = ast[source_node_id];
        auto& output_node = out.nodes[output_node_id];
        if (source_node.node_type() == buffers::parser::NodeType::NAME) {
            // Translate the name (if not done already)
            RegisteredNameID name_id = source_node.children_begin_or_value();
            auto name_iter = translated_names_by_id.find(name_id);
            if (name_iter != translated_names_by_id.end()) {
                output_node.mutate_children_begin_or_value(name_iter->second);
            } else {
                // Copy the registered name
                auto& name = names.At(name_id);
                output_node.mutate_children_begin_or_value(out.names.size());
                translated_names_by_id.insert({name_id, out.names.size()});
                out.names.emplace_back(name.text);
            }

        } else if (source_node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_) {
            // Update the children index
            output_node.mutate_children_begin_or_value(out.nodes.size());
            for (size_t i = 0; i < source_node.children_count(); ++i) {
                // Translate child node
                auto& child_node = ast[source_node.children_begin_or_value() + i];
                uint32_t parent_id = static_cast<uint32_t>(output_node_id);
                Node out_child{patchLocation(child_node.location(), snippet_offset),
                               child_node.node_type(),
                               child_node.attribute_key(),
                               parent_id,
                               child_node.children_begin_or_value(),
                               child_node.children_count()};
                out.nodes.push_back(out_child);

                // Visit all children
                pending.push_back({
                    source_node.children_begin_or_value() + i,
                    out.nodes.size() - 1,
                });
            }
        }
    }

    // Now we translated all necessary nodes, but in forward order!
    // We want to stay compatible to the AST format of parsed scripts and therefore reverse the AST again.
    // That way, we can always assume (in snippet and script) that children are read before parents when scanning ltr.
    // (This assumption will later help with formatting)
    //
    // We scan from both sides and patch all offsets.

    // Reverse the output vector and update node indices in a single pass
    for (size_t left = 0, right = out.nodes.size() - 1; left < right; ++left, --right) {
        // Swap the elements
        std::swap(out.nodes[left], out.nodes[right]);

        // Update children indices for objects after swapping
        if (out.nodes[left].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_) {
            out.nodes[left].mutate_parent(out.nodes.size() - out.nodes[left].parent() - 1);
            out.nodes[left].mutate_children_begin_or_value(out.nodes.size() -
                                                           out.nodes[left].children_begin_or_value() - 1);
        }
        if (out.nodes[right].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_) {
            out.nodes[right].mutate_parent(out.nodes.size() - out.nodes[right].parent() - 1);
            out.nodes[right].mutate_children_begin_or_value(out.nodes.size() -
                                                            out.nodes[right].children_begin_or_value() - 1);
        }
    }
    // Handle the middle element in case of odd-sized array
    if (out.nodes.size() % 2 == 1) {
        size_t middle = out.nodes.size() / 2;
        if (out.nodes[middle].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_) {
            out.nodes[middle].mutate_parent(out.nodes.size() - out.nodes[middle].parent() - 1);
            out.nodes[middle].mutate_children_begin_or_value(out.nodes.size() -
                                                             out.nodes[middle].children_begin_or_value() - 1);
        }
    }
    // Invalidate parent of root node
    out.nodes.back().mutate_parent(std::numeric_limits<uint32_t>::max());
    out.root_node_id = out.nodes.size() - 1;
    return out;
}

}  // namespace parser
}  // namespace dashql
