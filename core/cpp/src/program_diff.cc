#include "dashql/program_diff.h"

#include <iostream>

#include "duckdb/web/common/span.h"

namespace dashql {

namespace {

std::string_view TextAt(std::string_view text, sx::Location loc) { return text.substr(loc.offset(), loc.length()); }

}  // namespace

/// Compute subtree sizes
size_t ProgramMatcher::ComputeSubtreeSizes(const sx::Program& prog, size_t root, std::vector<size_t>& sizes) {
    // Already computed?
    if (auto n = sizes[root]; n > 0) return n;

    /// Run a DFS starting at every program statement
    struct SubtreeNode {
        size_t target;
        size_t parent;
    };
    std::vector<SubtreeNode> pending_nodes;
    std::vector<bool> pending_visited;
    pending_nodes.reserve(32);
    pending_visited.reserve(32);
    pending_nodes.push_back({root, root});
    pending_visited.push_back(false);

    // Traverse the tree
    size_t node_count = 0;
    while (!pending_nodes.empty()) {
        auto [target, parent] = pending_nodes.back();

        // Already pending_visited?
        if (pending_visited.back()) {
            if (pending_nodes.size() == 1) {
                node_count = sizes[target];
                break;
            }
            sizes[parent] += sizes[target];
            pending_nodes.pop_back();
            pending_visited.pop_back();
            continue;
        }

        // Set subtree size and mark as visited
        sizes[target] = 1;
        pending_visited.back() = true;

        // Discover children
        auto* node = prog.nodes()->Get(target);
        auto node_type = node->node_type();
        if (node_type > sx::NodeType::OBJECT_MIN || node_type == sx::NodeType::ARRAY) {
            auto children_begin = node->children_begin_or_value();
            auto children_count = node->children_count();
            auto children_end = children_begin + children_count;
            for (auto i = children_begin; i < children_end; ++i) {
                pending_nodes.push_back({i, target});
                pending_visited.push_back(false);
            }
        }
    }
    return node_count;
}

// Constructor
ProgramMatcher::ProgramMatcher(std::string_view source_text, std::string_view target_text,
                               const sx::Program& source_program, const sx::Program& target_program)
    : source_text_(source_text),
      target_text_(target_text),
      source_program_(source_program),
      target_program_(target_program),
      source_subtree_sizes_(source_program.nodes()->size(), 0),
      target_subtree_sizes_(target_program.nodes()->size(), 0) {}

// Compare two statements
ProgramMatcher::Similarity ProgramMatcher::ComputeSimilarity(const sx::Statement& source, const sx::Statement& target) {
    // Short circuit the equality case
    auto& source_nodes = *source_program_.nodes();
    auto& target_nodes = *target_program_.nodes();
    if (auto s = source_nodes.Get(source.root()), t = target_nodes.Get(target.root());
        (s->location().length() == t->location().length()) && (s->node_type() == t->node_type()) &&
        (s->children_count() == t->children_count())) {
        auto st = TextAt(source_text_, s->location());
        auto tt = TextAt(target_text_, t->location());
        if (st == tt) return Similarity{1, 1};
    }

    // Compute tree sizes
    auto source_size = ComputeSubtreeSizes(source_program_, source.root(), source_subtree_sizes_);
    auto target_size = ComputeSubtreeSizes(target_program_, target.root(), target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return {};

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

    // Traverse the tree
    Similarity sim;
    while (!pending_nodes.empty()) {
        auto& [source_id, target_id, parent_entry, matching] = pending_nodes.back();
        auto source = *source_nodes[source_id];
        auto target = *target_nodes[target_id];

        // Already visited?
        if (pending_visited.back()) {
            // Root entry?
            if (pending_nodes.size() == 1) {
                sim = Similarity{node_count, matching};
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
    return sim;
}

}  // namespace dashql
