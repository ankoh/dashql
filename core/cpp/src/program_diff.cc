#include "dashql/program_diff.h"

#include <iostream>
#include <stack>

#include "duckdb/web/common/span.h"

namespace dashql {

namespace {

std::string_view TextAt(std::string_view text, sx::Location loc) { return text.substr(loc.offset(), loc.length()); }

}  // namespace

// Estimate the similarity
ProgramMatcher::SimilarityEstimate ProgramMatcher::EstimateSimilarity(const sx::Statement& source,
                                                                      const sx::Statement& target) {
    auto& source_nodes = *source_program_.nodes();
    auto& target_nodes = *target_program_.nodes();
    auto s = source_nodes.Get(source.root());
    auto t = target_nodes.Get(target.root());

    // Different node types?
    if (s->node_type() != t->node_type()) return SimilarityEstimate::NOT_EQUAL;

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This will bypass us the tree diffing for all unchanged statements.
    if ((s->children_count() == t->children_count()) && (s->location().length() == t->location().length())) {
        auto st = TextAt(source_text_, s->location());
        auto tt = TextAt(target_text_, t->location());
        if (st == tt) return SimilarityEstimate::EQUAL;
    }
    return SimilarityEstimate::SIMILAR;
}

// Constructor
ProgramMatcher::ProgramMatcher(std::string_view source_text, std::string_view target_text,
                               const sx::Program& source_program, const sx::Program& target_program)
    : source_text_(source_text),
      target_text_(target_text),
      source_program_(source_program),
      target_program_(target_program),
      source_subtree_sizes_(),
      target_subtree_sizes_() {}

/// Compute tree size
size_t ProgramMatcher::ComputeTreeSize(const sx::Program& prog, size_t root, std::vector<size_t>& sizes) {
    // Init tree sizes
    if (auto n = prog.nodes()->size(); sizes.size() != n) sizes.resize(n, 0);
    // Already computed?
    else if (auto n = sizes[root]; n > 0) return n;

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

// Perform two statements
ProgramMatcher::StatementDiff ProgramMatcher::ComputeDiff(const sx::Statement& source, const sx::Statement& target, size_t diff_cap) {
    // Compute tree sizes
    auto& source_nodes = *source_program_.nodes();
    auto& target_nodes = *target_program_.nodes();
    auto source_size = ComputeTreeSize(source_program_, source.root(), source_subtree_sizes_);
    auto target_size = ComputeTreeSize(target_program_, target.root(), target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return StatementDiff{};

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
    StatementDiff diff;
    while (!pending_nodes.empty()) {
        auto& [source_id, target_id, parent_entry, matching_nodes] = pending_nodes.back();
        auto source = *source_nodes[source_id];
        auto target = *target_nodes[target_id];

        // Already visited?
        if (pending_visited.back()) {
            // Root entry?
            if (pending_nodes.size() == 1) {
                diff.total_nodes = node_count;
                diff.matching_nodes = matching_nodes;
                break;
            }
            pending_nodes[parent_entry].matching_nodes += matching_nodes;
            pending_nodes.pop_back();
            pending_visited.pop_back();
            continue;
        }
        pending_visited.back() = true;
        auto pile_idx = pending_nodes.size() - 1;

        // Different node type?
        if (source.node_type() != target.node_type()) {
            continue;
        }

        // Enum or literal
        auto node_type = source.node_type();
        auto match = true;
        switch (node_type) {
            case sx::NodeType::NONE:
                break;
            case sx::NodeType::BOOL:
                match = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::UI32:
                match = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::STRING:
                match = TextAt(source_text_, source.location()) == TextAt(target_text_, target.location());
                break;
            case sx::NodeType::ARRAY: {
                auto sc = source.children_count();
                auto tc = target.children_count();
                match = sc == tc;
                for (unsigned i = 0, sb = source.children_begin_or_value(), tb = target.children_begin_or_value();
                     i < std::min(sc, tc); ++i) {
                    pending_nodes.push_back({sb + i, tb + i, pile_idx, 0});
                    pending_visited.push_back(false);
                }
                break;
            }
            default: {
                assert(node_type > sx::NodeType::ENUM_MIN);
                if (node_type > sx::NodeType::OBJECT_MIN) {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough.
                    auto si = source.children_begin_or_value();
                    auto ti = target.children_begin_or_value();
                    auto se = si + source.children_count();
                    auto te = ti + target.children_count();
                    match = source.children_count() == target.children_count();
                    while ((si < se) && (ti < te)) {
                        auto sk = static_cast<uint16_t>(source_nodes[si]->attribute_key());
                        auto tk = static_cast<uint16_t>(target_nodes[ti]->attribute_key());
                        if (sk < tk) {
                            ++si;
                            match = false;
                        } else if (sk > tk) {
                            ++ti;
                            match = false;
                        } else {
                            pending_nodes.push_back({si++, ti++, pile_idx, 0});
                            pending_visited.push_back(false);
                        }
                    }

                } else if (node_type > sx::NodeType::ENUM_MIN) {
                    // Is enum?
                    // Match the value.
                    match = source.children_begin_or_value() == target.children_begin_or_value();
                }
            }
        }

        // Was a match?
        if (match) {
            ++matching_nodes;
        } else {
            if (diff.diff_nodes.size() < diff_cap) {
                diff.diff_nodes.push_back(source_id);
            }
        }
    }
    return diff;
}

// Compare two statements for deep equality
bool ProgramMatcher::CheckDeepEquality(const sx::Statement& source, const sx::Statement& target) {
    // Compute tree sizes
    auto& source_nodes = *source_program_.nodes();
    auto& target_nodes = *target_program_.nodes();
    auto source_size = ComputeTreeSize(source_program_, source.root(), source_subtree_sizes_);
    auto target_size = ComputeTreeSize(target_program_, target.root(), target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return true;

    // Do a DFS traversal starting at the root node
    struct NodeSimilarity {
        size_t source_node;
        size_t target_node;
    };
    std::vector<NodeSimilarity> pending_nodes;
    pending_nodes.reserve(32);
    pending_nodes.push_back({source.root(), target.root()});

    // Traverse the tree
    while (!pending_nodes.empty()) {
        auto [source_id, target_id] = pending_nodes.back();
        auto source = *source_nodes[source_id];
        auto target = *target_nodes[target_id];
        pending_nodes.pop_back();

        // Different node type?
        if (source.node_type() != target.node_type()) return false;

        // Enum or literal
        auto node_type = source.node_type();
        auto eq = true;
        switch (node_type) {
            case sx::NodeType::NONE:
                break;
            case sx::NodeType::BOOL:
                eq = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::UI32:
                eq = source.children_begin_or_value() == target.children_begin_or_value();
                break;
            case sx::NodeType::STRING:
                eq = TextAt(source_text_, source.location()) == TextAt(target_text_, target.location());
                break;
            case sx::NodeType::ARRAY: {
                auto sc = source.children_count();
                auto tc = target.children_count();
                if (sc != tc) return false;
                for (unsigned i = 0, sb = source.children_begin_or_value(), tb = target.children_begin_or_value();
                     i < std::min(sc, tc); ++i) {
                    pending_nodes.push_back({sb + i, tb + i});
                }
                break;
            }
            default: {
                assert(node_type > sx::NodeType::ENUM_MIN);
                if (node_type > sx::NodeType::OBJECT_MIN) {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough.
                    auto si = source.children_begin_or_value();
                    auto ti = target.children_begin_or_value();
                    auto se = si + source.children_count();
                    auto te = ti + target.children_count();
                    eq = source.children_count() == target.children_count();
                    while ((si < se) && (ti < te)) {
                        auto sk = static_cast<uint16_t>(source_nodes[si]->attribute_key());
                        auto tk = static_cast<uint16_t>(target_nodes[ti]->attribute_key());
                        if (sk != tk) {
                            return false;
                        } else {
                            pending_nodes.push_back({si++, ti++});
                        }
                    }

                } else if (node_type > sx::NodeType::ENUM_MIN) {
                    // Is enum?
                    // Match the value.
                    eq = source.children_begin_or_value() == target.children_begin_or_value();
                }
            }
        }

        // Node differs?
        if (!eq) return false;
    }
    return true;
}

// Find unique statement pairs in two lists of statement ids.
void ProgramMatcher::MapStatements(const std::vector<size_t>& source_ids, const std::vector<size_t>& target_ids,
                                   StatementMappings& unique_pairs, StatementMappings& equal) {
    auto& source_stmts = *source_program_.statements();
    auto& target_stmts = *target_program_.statements();

    // Maps target ids to matched source ids
    std::vector<bool> source_ambiguous;
    std::vector<bool> target_ambiguous;
    std::vector<std::optional<size_t>> source_mapping;
    source_ambiguous.resize(source_ids.size(), false);
    target_ambiguous.resize(target_ids.size(), false);
    source_mapping.resize(source_ids.size(), std::nullopt);

    // We deviate from PatienceDiff sightly here:
    //
    // PatienceDiff first makes both sides unique and then finds mappings between unique records.
    // We assume that our statements are unique most of the time and therefore compute the mapping directly.
    // We also short-circuit the equality checks which makes the quadratic behavior acceptable here.
    //
    for (auto target_id : target_ids) {
        auto& target_stmt = *target_stmts.Get(target_id);
        std::optional<size_t> match;

        // Compare source statement with all targets
        for (auto source_id : source_ids) {
            auto& source_stmt = *source_stmts.Get(source_id);
            switch (EstimateSimilarity(source_stmt, target_stmt)) {
                case SimilarityEstimate::NOT_EQUAL:
                    break;
                case SimilarityEstimate::SIMILAR:
                    if (!CheckDeepEquality(source_stmt, target_stmt)) break;
                    // Fall through to the equality case
                case SimilarityEstimate::EQUAL:
                    equal.push_back({source_id, target_id});

                    // Mapping ambiguous?
                    // Two target statements map to the same source statement
                    if (auto existing = source_mapping[source_id]; existing) {
                        target_ambiguous[target_id] = true;
                        target_ambiguous[*existing] = true;
                        source_ambiguous[source_id] = true;
                        continue;
                    } else if (match) {
                        // Target statement maps to two source statements
                        target_ambiguous[target_id] = true;
                        source_ambiguous[*match] = true;
                        source_ambiguous[source_id] = true;
                        continue;
                    }
                    source_mapping[source_id] = target_id;
                    match = source_id;
                    break;
            }
        }
    }

    // Emit non-ambiguous mappings
    for (unsigned source_id = 0; source_id < source_ids.size(); ++source_id) {
        auto target_id = source_mapping[source_id];
        if (!target_id) continue;
        if (source_ambiguous[source_id] || target_ambiguous[*target_id]) continue;
        unique_pairs.push_back({source_id, *target_id});
    }
}

// Find the longest common subsequence among the unique pairs.
void ProgramMatcher::FindLCS(const std::vector<std::pair<size_t, size_t>>& unique_pairs, std::vector<std::pair<size_t, size_t>>& lcs) {
    struct Entry {
        size_t source_id;
        size_t target_id;
        size_t prev_pile_size;
    };
    using Pile = std::vector<Entry>;
    struct PileLess {
        bool operator()(const Pile& pile, size_t stmt) const { return pile.back().target_id < stmt; }
    };

    // Build the piles
    std::vector<Pile> piles;
    for (auto& [source_id, target_id]: unique_pairs) {
        if (auto p = std::find_if(piles.begin(), piles.end(), [t=target_id](auto& x) { return x.back().target_id >= t; }); p != piles.end()) {
            auto prev_pile_id = std::max<size_t>(p - piles.begin(), 1) - 1;
            auto prev_pile_size = piles[prev_pile_id].size();
            p->push_back({source_id, target_id, prev_pile_size});
        } else {
            piles.emplace_back();
            auto prev_pile_id = std::max<size_t>(piles.size(), 2) - 2;
            auto prev_pile_size = piles[prev_pile_id].size();
            piles.back().push_back({source_id, target_id, prev_pile_id});
        }
    }

    // No piles?
    if (piles.empty())
        return;

    // Build the LCS
    for (auto pile_id = piles.size() - 1, entry_id = piles[pile_id].size() - 1;; --pile_id) {
        auto [source_id, target_id, prev_pile_size] = piles[pile_id][entry_id];
        lcs.push_back({source_id, target_id});
        if (pile_id == 0)
            break;
        entry_id = prev_pile_size - 1;
    }
    std::reverse(lcs.begin(), lcs.end());
}

}  // namespace dashql
