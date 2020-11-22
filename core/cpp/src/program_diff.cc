#include "dashql/program_diff.h"

#include "duckdb/web/common/span.h"
#include <iostream>

namespace dashql {

namespace {

std::string_view TextAt(std::string_view text, sx::Location loc) {
    return text.substr(loc.offset(), loc.length());
}

}

/// Compute subtree sizes
std::vector<size_t> ProgramMatcher::ComputeSubtreeSizes(const sx::Program& program) {
    auto node_count = program.nodes()->size();
    if (node_count == 0) return {};
    std::vector<size_t> sizes;
    sizes.resize(program.nodes()->size(), 0);

    // Prepare DFS
    std::vector<bool> visited;
    std::vector<std::pair<uint32_t, uint32_t>> traversal;
    visited.resize(node_count, false);
    traversal.reserve(32);

    /// Run a DFS starting at every program statement
    for (auto* stmt : *program.statements()) {
        traversal.clear();
        traversal.push_back({stmt->root(), stmt->root()});

        while (!traversal.empty()) {
            auto [target, parent] = traversal.back();

            // Already pending_visited?
            if (visited[target]) {
                if (traversal.size() != 1) {
                    sizes[parent] += sizes[target];
                }
                traversal.pop_back();
                continue;
            }

            // Set subtree size and mark as visited
            sizes[target] = 1;
            visited[target] = true;

            // Discover children
            auto* node = program.nodes()->Get(target);
            auto node_type = node->node_type();
            if (node_type > sx::NodeType::OBJECT_MIN || node_type == sx::NodeType::ARRAY) {
                auto children_begin = node->children_begin_or_value();
                auto children_count = node->children_count();
                auto children_end = children_begin + children_count;
                for (auto i = children_begin; i < children_end; ++i) {
                    traversal.push_back({i, target});
                }
            }
        }
    }
    return sizes;
}

// Constructor
ProgramMatcher::ProgramMatcher(std::string_view source_text, std::string_view target_text,
                                     const sx::Program& source_program, const sx::Program& target_program)
    : source_text_(source_text),
      target_text_(target_text),
      source_program_(source_program),
      target_program_(target_program),
      source_subtree_sizes_(),
      target_subtree_sizes_() {
    source_subtree_sizes_ = ComputeSubtreeSizes(source_program);
    target_subtree_sizes_ = ComputeSubtreeSizes(target_program);
}

// Compare two statements
ProgramMatcher::Similarity ProgramMatcher::ComputeSimilarity(const sx::Statement& source, const sx::Statement& target) {
    auto node_count = std::max(source_subtree_sizes_[source.root()], target_subtree_sizes_[target.root()]);
    auto& source_nodes = *source_program_.nodes();
    auto& target_nodes = *target_program_.nodes();
    if (node_count == 0) return {0, 0};

    // Do a DFS traversal starting at the root node
    struct NodeSimilarity {
        size_t source_node;
        size_t target_node;
        size_t parent_entry;
        size_t matching_nodes;
    };
    std::vector<NodeSimilarity> pending_nodes;
    std::vector<bool> pending_visited;
    pending_nodes.reserve(32);
    pending_visited.reserve(32);
    pending_nodes.push_back({source.root(), target.root(), 0, 0});
    pending_visited.push_back(false);

    Similarity result = {0, 0};
    while (!pending_nodes.empty()) {
        auto& [source_id, target_id, parent_entry, matching] = pending_nodes.back();
        auto source = *source_nodes[source_id];
        auto target = *target_nodes[target_id];

        // Already visited?
        if (pending_visited.back()) {
            // Root entry?
            if (pending_nodes.size() == 1) {
                result = {node_count, matching};
                break;
            }
            pending_nodes[parent_entry].matching_nodes += matching;
            pending_nodes.pop_back();
            pending_visited.pop_back();
            continue;
        }
        pending_visited.back() = true;
        auto stack_idx = pending_nodes.size() - 1;

        // Different node type?
        if (source.node_type() != target.node_type()) {
            continue;
        }

        // Enum or literal
        auto node_type = source.node_type();
        switch (node_type) {
            case sx::NodeType::NONE:
                break;
            case sx::NodeType::BOOL:
                matching = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::UI32:
                matching = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::STRING:
                matching = TextAt(source_text_, source.location()) == TextAt(target_text_, target.location());
                break;
            case sx::NodeType::ARRAY: {
                auto sc = source.children_count();
                auto tc = target.children_count();
                matching = sc == tc;
                for (unsigned i = 0, sb = source.children_begin_or_value(), tb = target.children_begin_or_value();
                     i < std::min(sc, tc); ++i) {
                    pending_nodes.push_back({sb + i, tb + i, stack_idx, 0});
                    pending_visited.push_back(false);
                }
                break;
            }
            default:
                assert(node_type > sx::NodeType::ENUM_MIN);
        }

        if (node_type > sx::NodeType::OBJECT_MIN) {
            // Is object?
            // Attribute lists are sorted, so a simple merge is enough.
            auto si = source.children_begin_or_value();
            auto ti = target.children_begin_or_value();
            auto se = si + source.children_count();
            auto te = ti + target.children_count();
            matching = source.children_count() == target.children_count();
            while ((si < se) && (ti < te)) {
                auto sk = static_cast<uint16_t>(source_nodes[si]->attribute_key());
                auto tk = static_cast<uint16_t>(target_nodes[ti]->attribute_key());
                if (sk < tk) {
                    ++si;
                    matching = 0;
                } else if (sk > tk) {
                    ++ti;
                    matching = 0;
                } else {
                    pending_nodes.push_back({si++, ti++, stack_idx, 0});
                    pending_visited.push_back(false);
                }
            }

        } else if (node_type > sx::NodeType::ENUM_MIN) {
            // Is enum?
            // Match the value.
            matching = source.children_begin_or_value() == target.children_begin_or_value();
        }
    }

    return result;
}

}  // namespace dashql
