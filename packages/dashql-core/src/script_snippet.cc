#include "dashql/script_snippet.h"

#include "dashql/buffers/index_generated.h"
#include "dashql/script_comparison.h"

namespace dashql {

using Node = buffers::parser::Node;

static buffers::parser::Location patchLocation(buffers::parser::Location loc, size_t snippet_offset,
                                               size_t snippet_size) {
    assert(loc.offset() >= snippet_offset);
    assert((loc.offset() - snippet_offset + loc.length()) <= snippet_size);
    loc.mutate_offset(loc.offset() - snippet_offset);
    return loc;
}

// Equals other snippet?
bool ScriptSnippet::Equals(const ScriptSnippet& other, bool skip_names_and_literals) const {
    NameResolver left_name_resolver = [&](size_t id) { return names[id]; };
    NameResolver right_name_resolver = [&](size_t id) { return other.names[id]; };
    return ScriptsAreEqual(text, nodes, left_name_resolver, other.text, other.nodes, right_name_resolver,
                           skip_names_and_literals);
}

// Compute the signature
size_t ScriptSnippet::ComputeSignature(bool skip_names_and_literals) const {
    NameResolver name_resolver = [&](size_t id) { return names[id]; };
    return ComputeScriptSignature(text, nodes, name_resolver, skip_names_and_literals);
}

flatbuffers::Offset<buffers::snippet::ScriptSnippet> ScriptSnippet::Copy(
    flatbuffers::FlatBufferBuilder& builder, const buffers::snippet::ScriptSnippet& snippet) {
    auto text = builder.CreateString(snippet.text()->string_view());

    // Copy names
    std::vector<flatbuffers::Offset<flatbuffers::String>> name_offsets;
    name_offsets.reserve(snippet.names()->size());
    for (size_t i = 0; i < snippet.names()->size(); ++i) {
        auto s = builder.CreateString(snippet.names()->Get(i));
        name_offsets.push_back(s);
    }
    auto names_ofs = builder.CreateVector(name_offsets);

    // Copy markers
    dashql::buffers::parser::Node* node_writer;
    auto nodes_ofs = builder.CreateUninitializedVectorOfStructs(snippet.nodes()->size(), &node_writer);
    for (size_t i = 0; i < snippet.nodes()->size(); ++i) {
        *(node_writer++) = *snippet.nodes()->Get(i);
    }

    auto markers_ofs = builder.CreateVector(snippet.node_markers()->data(), snippet.node_markers()->size());

    // Build snippet
    buffers::snippet::ScriptSnippetBuilder snippet_builder{builder};
    snippet_builder.add_text(text);
    snippet_builder.add_names(names_ofs);
    snippet_builder.add_nodes(nodes_ofs);
    snippet_builder.add_root_node_id(snippet.root_node_id());
    snippet_builder.add_node_markers(markers_ofs);

    return snippet_builder.Finish();
}

ScriptSnippet ScriptSnippet::Extract(std::string_view text, std::span<const buffers::parser::Node> ast,
                                     std::span<const buffers::analyzer::SemanticNodeMarkerType> ast_markers,
                                     size_t root_node_id, const NameRegistry& names) {
    // XXX This function is currently copying text text of the node-root as is.
    //     What we should do instead is assemble a cleaned-up text based on the scanner tokens.

    // Return an empty snippet for invalid node ids
    if (root_node_id >= ast.size()) {
        return {};
    }

    // Prepare translating names
    std::unordered_map<size_t, size_t> translated_names_by_id;
    std::vector<std::pair<size_t, buffers::analyzer::SemanticNodeMarkerType>> node_markers;

    // Prepare patching locations
    const buffers::parser::Node& root_node = ast[root_node_id];
    size_t snippet_offset = root_node.location().offset();
    size_t snippet_size = root_node.location().length();

    // Write the root node
    ScriptSnippet out;
    out.text = text.substr(snippet_offset, snippet_size);
    {
        Node out_root{patchLocation(root_node.location(), snippet_offset, snippet_size),
                      root_node.node_type(),
                      buffers::parser::AttributeKey::NONE,
                      0,
                      root_node.children_begin_or_value(),
                      root_node.children_count()};
        out.nodes.push_back(out_root);
    }

    // Perform the pre-order DFS
    std::vector<std::pair<size_t, size_t>> pending;
    pending.reserve(16);
    pending.push_back({root_node_id, 0});
    while (!pending.empty()) {
        auto [source_node_id, output_node_id] = pending.back();
        pending.pop_back();

        // Copy node marker (if any)
        if (ast_markers[source_node_id] != buffers::analyzer::SemanticNodeMarkerType::NONE) {
            node_markers.emplace_back(output_node_id, ast_markers[source_node_id]);
        }

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
        } else if (source_node.node_type() >= buffers::parser::NodeType::OBJECT_KEYS_ ||
                   source_node.node_type() == buffers::parser::NodeType::ARRAY) {
            // Update the children index
            output_node.mutate_children_begin_or_value(out.nodes.size());
            for (size_t i = 0; i < source_node.children_count(); ++i) {
                // Translate child node
                size_t child_source_node_id =
                    source_node.children_begin_or_value() + source_node.children_count() - 1 - i;
                auto& child_node = ast[child_source_node_id];
                uint32_t parent_id = static_cast<uint32_t>(output_node_id);
                Node out_child{patchLocation(child_node.location(), snippet_offset, snippet_size),
                               child_node.node_type(),
                               child_node.attribute_key(),
                               parent_id,
                               child_node.children_begin_or_value(),
                               child_node.children_count()};
                out.nodes.push_back(out_child);

                // Visit all children
                pending.push_back({
                    child_source_node_id,
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
        if (out.nodes[left].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_ ||
            out.nodes[left].node_type() == buffers::parser::NodeType::ARRAY) {
            out.nodes[left].mutate_parent(out.nodes.size() - 1 - out.nodes[left].parent());
            out.nodes[left].mutate_children_begin_or_value(
                out.nodes.size() - out.nodes[left].children_begin_or_value() - out.nodes[left].children_count());
        }
        if (out.nodes[right].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_ ||
            out.nodes[right].node_type() == buffers::parser::NodeType::ARRAY) {
            out.nodes[right].mutate_parent(out.nodes.size() - out.nodes[right].parent() - 1);
            out.nodes[right].mutate_children_begin_or_value(
                out.nodes.size() - out.nodes[right].children_begin_or_value() - out.nodes[right].children_count());
        }
    }

    // Handle the middle element when reverting nodes
    if (out.nodes.size() % 2 == 1) {
        size_t middle = out.nodes.size() / 2;
        if (out.nodes[middle].node_type() >= buffers::parser::NodeType::OBJECT_KEYS_ ||
            out.nodes[middle].node_type() == buffers::parser::NodeType::ARRAY) {
            out.nodes[middle].mutate_parent(out.nodes.size() - 1 - out.nodes[middle].parent());
            out.nodes[middle].mutate_children_begin_or_value(
                out.nodes.size() - out.nodes[middle].children_begin_or_value() - out.nodes[middle].children_count());
        }
    }

    // Write the node markers
    out.node_markers.resize(out.nodes.size(), buffers::analyzer::SemanticNodeMarkerType::NONE);
    for (auto [i, marker] : node_markers) {
        out.node_markers[out.node_markers.size() - 1 - i] = marker;
    }

    // Invalidate parent of root node
    out.nodes.back().mutate_parent(std::numeric_limits<uint32_t>::max());
    out.root_node_id = out.nodes.size() - 1;
    return out;
}

/// Pack the script snippet
flatbuffers::Offset<buffers::snippet::ScriptSnippet> ScriptSnippet::Pack(
    flatbuffers::FlatBufferBuilder& builder) const {
    auto text_ofs = builder.CreateString(text);
    auto nodes_ofs = builder.CreateVectorOfStructs(nodes.data(), nodes.size());
    auto node_markers_ofs = builder.CreateVector(node_markers);

    std::vector<flatbuffers::Offset<flatbuffers::String>> name_offsets;
    name_offsets.reserve(names.size());
    for (auto& name : names) {
        name_offsets.push_back(builder.CreateString(name));
    }
    auto names_ofs = builder.CreateVector(name_offsets);

    buffers::snippet::ScriptSnippetBuilder snippet_builder{builder};
    snippet_builder.add_text(text_ofs);
    snippet_builder.add_nodes(nodes_ofs);
    snippet_builder.add_node_markers(node_markers_ofs);
    snippet_builder.add_root_node_id(root_node_id);
    snippet_builder.add_names(names_ofs);
    return snippet_builder.Finish();
}

}  // namespace dashql
