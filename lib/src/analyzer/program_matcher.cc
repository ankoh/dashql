#include "dashql/analyzer/program_matcher.h"

#include <iostream>
#include <stack>
#include <unordered_map>

#include "dashql/common/span.h"

namespace dashql {

namespace {

// The fraction of nodes that must be equal between statements to emit an UPDATE.
// (Instead of DELETE + INSERT)
constexpr double UPDATE_SIMILARITY_THRESHOLD = 0.75;

}  // namespace

/// Constructor
ProgramMatcher::DiffOp::DiffOp(DiffOpCode code, std::optional<size_t> source, std::optional<size_t> target)
    : code_(code), source_(source), target_(target) {}

// Estimate the similarity
ProgramMatcher::SimilarityEstimate ProgramMatcher::EstimateSimilarity(const sx::StatementT& source,
                                                                      const sx::StatementT& target) {
    auto& s = source_.program().nodes[source.root_node];
    auto& t = target_.program().nodes[target.root_node];

    // Different node types?
    if (s.node_type() != t.node_type()) return SimilarityEstimate::NOT_EQUAL;

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This will bypass us the tree diffing for all unchanged statements.
    if ((s.children_count() == t.children_count()) && (s.location().length() == t.location().length())) {
        auto st = source_.TextAt(s.location());
        auto tt = target_.TextAt(t.location());
        if (st == tt) return SimilarityEstimate::EQUAL;
    }
    return SimilarityEstimate::SIMILAR;
}

// Constructor
ProgramMatcher::ProgramMatcher(const ProgramInstance& source, const ProgramInstance& target)
    : source_(source),
      target_(target),
      source_subtree_sizes_(),
      target_subtree_sizes_() {}

/// Compute tree size
size_t ProgramMatcher::ComputeTreeSize(const sx::ProgramT& prog, size_t root, std::vector<size_t>& sizes) {
    // Init tree sizes
    if (auto n = prog.nodes.size(); sizes.size() != n) sizes.resize(n, 0);
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
        auto& node = prog.nodes[target];
        auto node_type = node.node_type();
        if (node_type > sx::NodeType::OBJECT_MIN_ || node_type == sx::NodeType::ARRAY) {
            auto children_begin = node.children_begin_or_value();
            auto children_count = node.children_count();
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
ProgramMatcher::StatementSimilarity ProgramMatcher::ComputeSimilarity(const sx::StatementT& source, const sx::StatementT& target) {
    // Compute tree sizes
    auto& source_program = source_.program();
    auto& target_program = target_.program();
    auto source_size = ComputeTreeSize(source_program, source.root_node, source_subtree_sizes_);
    auto target_size = ComputeTreeSize(target_program, target.root_node, target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return StatementSimilarity{};

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
    pending_nodes.push_back({source.root_node, target.root_node, 0, 0});
    pending_visited.push_back(false);

    // Traverse the tree
    StatementSimilarity sim;
    while (!pending_nodes.empty()) {
        auto& [source_id, target_id, parent_entry, matching_nodes] = pending_nodes.back();
        auto& source = source_program.nodes[source_id];
        auto& target = target_program.nodes[target_id];

        // Already visited?
        if (pending_visited.back()) {
            // Root entry?
            if (pending_nodes.size() == 1) {
                sim.total_nodes = node_count;
                sim.matching_nodes = matching_nodes;
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
            case sx::NodeType::STRING_REF:
                match = source_.TextAt(source.location()) == target_.TextAt(target.location());
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
                assert(node_type > sx::NodeType::ENUM_MIN_);
                if (node_type > sx::NodeType::OBJECT_MIN_) {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough.
                    auto si = source.children_begin_or_value();
                    auto ti = target.children_begin_or_value();
                    auto se = si + source.children_count();
                    auto te = ti + target.children_count();
                    match = source.children_count() == target.children_count();
                    while ((si < se) && (ti < te)) {
                        auto sk = static_cast<uint16_t>(source_program.nodes[si].attribute_key());
                        auto tk = static_cast<uint16_t>(target_program.nodes[ti].attribute_key());
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

                } else if (node_type > sx::NodeType::ENUM_MIN_) {
                    // Is enum?
                    // Match the value.
                    match = source.children_begin_or_value() == target.children_begin_or_value();
                }
            }
        }

        // Was a match?
        if (match) {
            ++matching_nodes;
        }
    }
    return sim;
}

// Compare two statements for deep equality
bool ProgramMatcher::CheckDeepEquality(const sx::StatementT& source, const sx::StatementT& target) {
    // Compute tree sizes
    auto& source_program = source_.program();
    auto& target_program = target_.program();
    auto source_size = ComputeTreeSize(source_program, source.root_node, source_subtree_sizes_);
    auto target_size = ComputeTreeSize(target_program, target.root_node, target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return true;

    // Do a DFS traversal starting at the root node
    struct NodeSimilarity {
        size_t source_node;
        size_t target_node;
    };
    std::vector<NodeSimilarity> pending_nodes;
    pending_nodes.reserve(32);
    pending_nodes.push_back({source.root_node, target.root_node});

    // Traverse the tree
    while (!pending_nodes.empty()) {
        auto [source_id, target_id] = pending_nodes.back();
        auto& source = source_program.nodes[source_id];
        auto& target = target_program.nodes[target_id];
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
            case sx::NodeType::STRING_REF:
                eq = source_.TextAt(source.location()) == target_.TextAt(target.location());
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
                assert(node_type > sx::NodeType::ENUM_MIN_);
                if (node_type > sx::NodeType::OBJECT_MIN_) {
                    // Is object?
                    // Attribute lists are sorted, so a simple merge is enough.
                    auto si = source.children_begin_or_value();
                    auto ti = target.children_begin_or_value();
                    auto se = si + source.children_count();
                    auto te = ti + target.children_count();
                    eq = source.children_count() == target.children_count();
                    while ((si < se) && (ti < te)) {
                        auto sk = static_cast<uint16_t>(source_program.nodes[si].attribute_key());
                        auto tk = static_cast<uint16_t>(target_program.nodes[ti].attribute_key());
                        if (sk != tk) {
                            return false;
                        } else {
                            pending_nodes.push_back({si++, ti++});
                        }
                    }

                } else if (node_type > sx::NodeType::ENUM_MIN_) {
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
void ProgramMatcher::MapStatements(StatementMappings& unique_pairs, StatementMappings& equal_pairs) {
    // Maps target ids to matched source ids
    auto& source_program = source_.program();
    auto& target_program = target_.program();
    std::vector<bool> source_ambiguous;
    std::vector<bool> target_ambiguous;
    std::vector<std::optional<size_t>> target_mapping;
    source_ambiguous.resize(source_program.statements.size(), false);
    target_ambiguous.resize(target_program.statements.size(), false);
    target_mapping.resize(target_program.statements.size(), std::nullopt);

    // We deviate from PatienceDiff sightly here:
    //
    // PatienceDiff first makes both sides unique and then finds mappings between unique records.
    // We assume that our statements are unique most of the time and therefore compute the mapping directly.
    // We also short-circuit the equality checks which makes the quadratic behavior acceptable here.
    //
    for (unsigned source_id = 0; source_id < source_program.statements.size(); ++source_id) {
        auto& source_stmt = *source_program.statements[source_id];
        std::optional<size_t> match;

        // Compare source statement with all targets
        for (unsigned target_id = 0; target_id < target_program.statements.size(); ++target_id) {
            auto& target_stmt = *target_program.statements[target_id];
            switch (EstimateSimilarity(source_stmt, target_stmt)) {
                case SimilarityEstimate::NOT_EQUAL:
                    break;
                case SimilarityEstimate::SIMILAR:
                    if (!CheckDeepEquality(source_stmt, target_stmt)) break;
                    // Fall through to the equality case
                case SimilarityEstimate::EQUAL:
                    equal_pairs.push_back({source_id, target_id});

                    // Mapping ambiguous?
                    // Two target statements map to the same source statement
                    if (auto existing = target_mapping[target_id]; existing) {
                        source_ambiguous[source_id] = true;
                        source_ambiguous[*existing] = true;
                        target_ambiguous[target_id] = true;
                        continue;
                    } else if (match) {
                        // Target statement maps to two source statements
                        source_ambiguous[source_id] = true;
                        target_ambiguous[*match] = true;
                        target_ambiguous[target_id] = true;
                        continue;
                    }
                    target_mapping[target_id] = source_id;
                    match = target_id;
                    break;
            }
        }
    }

    // Emit non-ambiguous mappings
    for (unsigned target_id = 0; target_id < target_program.statements.size(); ++target_id) {
        auto source_id = target_mapping[target_id];
        if (!source_id) continue;
        if (source_ambiguous[*source_id] || target_ambiguous[target_id]) continue;
        unique_pairs.push_back({*source_id, target_id});
    }
    std::sort(unique_pairs.begin(), unique_pairs.end(), [&](auto& l, auto& r){
        return l.first < r.first;
    });

    // Make sure they are really sorted
    assert(std::is_sorted(equal_pairs.begin(), equal_pairs.end()));
    assert(std::is_sorted(unique_pairs.begin(), unique_pairs.end()));
}

// Find the longest common subsequence among the unique pairs.
ProgramMatcher::StatementMappings ProgramMatcher::FindLCS(const std::vector<std::pair<size_t, size_t>>& unique_pairs) {
    StatementMappings lcs;
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
            piles.back().push_back({source_id, target_id, prev_pile_size});
        }
    }

    // No piles?
    if (piles.empty())
        return lcs;

    // Build the LCS
    for (auto pile_id = piles.size() - 1, entry_id = piles[pile_id].size() - 1;; --pile_id) {
        assert(entry_id < piles[pile_id].size());
        auto [source_id, target_id, prev_pile_size] = piles[pile_id][entry_id];
        lcs.push_back({source_id, target_id});
        if (pile_id == 0)
            break;
        assert(prev_pile_size >= 1);
        entry_id = prev_pile_size - 1;
    }
    std::reverse(lcs.begin(), lcs.end());
    return lcs;
}

// Compute a diff between the programs
std::vector<ProgramMatcher::DiffOp> ProgramMatcher::ComputeDiff() {
    // Map statements
    auto& source_program = source_.program();
    auto& target_program = target_.program();
    StatementMappings unique_pairs;
    StatementMappings equal_pairs;
    MapStatements(unique_pairs, equal_pairs);

    // Build LCS
    auto lcs = FindLCS(unique_pairs);

    // Track which targets were emitted
    std::vector<bool> source_emitted;
    std::vector<bool> target_emitted;
    source_emitted.resize(source_program.statements.size(), false);
    target_emitted.resize(target_program.statements.size(), false);

    // Helper to emit diff ops
    std::vector<DiffOp> ops;
    auto emit = [&](DiffOpCode code, std::optional<size_t> source_id, std::optional<size_t> target_id = std::nullopt) {
        ops.emplace_back(code, source_id, target_id);
        if (source_id)
            source_emitted[*source_id] = true;
        if (target_id)
            target_emitted[*target_id] = true;
    };

    // Iterate over LCS sections
    std::pair<size_t, size_t> prev = {0, 0};
    std::pair<size_t, size_t> next = {0, 0};
    for (auto lcs_iter = lcs.begin();; ++lcs_iter) {
        // Update boundaries
        prev = next;
        next = (lcs_iter < lcs.end()) ? *lcs_iter : StatementMapping{
            source_program.statements.size(),
            target_program.statements.size(),
        };
        auto [prev_source_id, prev_target_id] = prev;
        auto [next_source_id, next_target_id] = next;

        // Iterate over all source statements in the section
        for (auto source_id = prev_source_id; source_id < next_source_id; ++source_id) {
            // Are there any equal pairs?
            // We have to emit equal pairs that are either ambiguous or unique but cross section boundaries.
            auto cmp_lb = [](auto& l, auto v) { return l.first < v; };
            auto cmp_ub = [](auto v, auto& r) { return v < r.first; };
            auto equal_begin = std::lower_bound(equal_pairs.begin(), equal_pairs.end(), source_id, cmp_lb);
            auto equal_end = std::upper_bound(equal_begin, equal_pairs.end(), source_id, cmp_ub);
            for (auto equal_iter = equal_begin; equal_iter != equal_end; ++equal_iter) {
                auto target_id = equal_iter->second;
                if (target_emitted[target_id]) continue;

                // The equal pair must cross section boundaries, otherwise it would be part of the LCS
                assert(target_id < prev_target_id || target_id > next_target_id);
                emit(DiffOpCode::MOVE, source_id, target_id);
                break;
            }
            if (source_emitted[source_id]) continue;
            auto& source_stmt = *source_program.statements[source_id];

            // Find best match among the remaining targets in the section.
            // This will result in a FCFS assignment of updated statements.
            // We could model this as bi-partite weighted matching problem but it's probably not worth it.
            // FCFS might be the more intuitive mapping anyway.
            std::vector<std::pair<size_t, double>> matches;
            for (auto target_id = prev_target_id; target_id < next_target_id; ++target_id) {
                if (target_emitted[target_id]) continue;
                auto& target_stmt = *target_program.statements[target_id];
                // The similiarity computation of unmatched statements is the most expensive operation in this diff.
                // We want to do it as rarely as possible and therefore do an additional fast estimation upfront.
                auto sim_est = EstimateSimilarity(source_stmt, target_stmt);
                if (sim_est == SimilarityEstimate::NOT_EQUAL) {
                    continue;
                } else if (sim_est == SimilarityEstimate::EQUAL) {
                    emit(DiffOpCode::KEEP, source_id, target_id);
                    break;
                }
                auto sim = ComputeSimilarity(source_stmt, target_stmt);
                auto sim_score = sim.Score();
                // Qualifies as similar statement?
                if (sim_score >= UPDATE_SIMILARITY_THRESHOLD) {
                    // Add to min-heap
                    matches.push_back({target_id, sim_score});
                    std::push_heap(matches.begin(), matches.end(), [](auto& l, auto& r) {
                        return l.second > r.second;
                    });
                }
            }
            if (source_emitted[source_id]) continue;

            // Found a match?
            if (matches.size() > 0) {
                emit(DiffOpCode::UPDATE, source_id, matches.front().first);
            } else {
                emit(DiffOpCode::DELETE, source_id);
            }
        }

        // Create new statements
        for (unsigned target_id = prev_target_id; target_id < next_target_id; ++target_id) {
            if (!target_emitted[target_id]) {
                emit(DiffOpCode::INSERT, std::nullopt, target_id);
            }
        }

        // At end?
        if (lcs_iter == lcs.end()) break;
        emit(DiffOpCode::KEEP, next_source_id, next_target_id);
    }
    return ops;
}

// Do parameter values equal?
bool ProgramMatcher::ParameterValuesEqual(const proto::session::ParameterValueT* l, const proto::session::ParameterValueT* r) {
    return l->type == r->type && l->value == r->value;
}

}  // namespace dashql
