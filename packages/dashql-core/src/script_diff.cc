#include "dashql/script_diff.h"

#include <algorithm>
#include <cassert>
#include <cstdint>

namespace dashql {

namespace {

using NodeType = buffers::parser::NodeType;
using Node = buffers::parser::Node;
using TextSpan = buffers::parser::TextSpan;

// The fraction of nodes that must be equal between statements to emit an UPDATE (instead of DELETE + INSERT).
constexpr double UPDATE_SIMILARITY_THRESHOLD = 0.75;

/// Get the numeric value of a node type
inline uint32_t typeId(NodeType t) { return static_cast<uint32_t>(t); }
/// Get the numeric value of an attribute key
inline uint16_t keyId(const Node& n) { return static_cast<uint16_t>(n.attribute_key()); }

/// Is the node type an enum?
///
/// Enums live between ENUM_KEYS_ and OBJECT_KEYS_, EXCEPT the four ENUM_VIS_* values that were
/// appended later and sit numerically between OBJECT_KEYS_ and VIS_OBJECT_KEYS_.
inline bool isEnumType(NodeType t) {
    auto id = typeId(t);
    return (id > typeId(NodeType::ENUM_KEYS_) && id < typeId(NodeType::OBJECT_KEYS_)) ||
           (id >= typeId(NodeType::ENUM_VIS_ENCODING_CHANNEL) && id <= typeId(NodeType::ENUM_VIS_SCALE_TYPE));
}
/// Is the node type an object?
///
/// Objects live above OBJECT_KEYS_, EXCEPT the ENUM_VIS_* block; the vis objects live above
/// VIS_OBJECT_KEYS_.
inline bool isObjectType(NodeType t) {
    auto id = typeId(t);
    return (id > typeId(NodeType::OBJECT_KEYS_) && id < typeId(NodeType::ENUM_VIS_ENCODING_CHANNEL)) ||
           (id > typeId(NodeType::VIS_OBJECT_KEYS_));
}
/// Does the node type have child nodes (as opposed to an inline value)?
inline bool hasChildren(NodeType t) { return t == NodeType::ARRAY || isObjectType(t); }

/// Read the resolved text of a node (for operators and literals)
inline std::string_view nodeText(const ParsedScript& script, const Node& node) {
    return script.scanned_script->ReadTextAtSymbolSpan(node.symbol_span());
}
/// Read the registered name text of a NAME node
inline std::string_view nameText(const ParsedScript& script, const Node& node) {
    return script.scanned_script->name_registry.At(node.children_begin_or_value()).text;
}
/// Resolve the text span of a statement root (empty span if the root is invalid)
inline TextSpan resolveStatementSpan(const ParsedScript& script, const ParsedScript::Statement& stmt) {
    if (stmt.root >= script.nodes.size()) return TextSpan(0, 0);
    return script.scanned_script->ResolveTextSpan(script.nodes[stmt.root].symbol_span());
}

/// Collect an object's child node indices sorted by attribute key (stable, to keep grammar order for
/// duplicate keys). Object attribute lists are NOT sorted in the current AST, so we sort a scratch copy.
inline void collectSortedChildren(const ParsedScript& script, const Node& node, std::vector<uint32_t>& out) {
    out.clear();
    uint32_t begin = node.children_begin_or_value();
    uint32_t count = node.children_count();
    out.reserve(count);
    for (uint32_t i = 0; i < count; ++i) out.push_back(begin + i);
    std::stable_sort(out.begin(), out.end(),
                     [&](uint32_t a, uint32_t b) { return keyId(script.nodes[a]) < keyId(script.nodes[b]); });
}

}  // namespace

/// Constructor
ScriptDiff::ScriptDiff(const ParsedScript& source, const ParsedScript& target) : source_(source), target_(target) {}

/// Compute the size of a subtree rooted at `root` (memoized DFS)
size_t ScriptDiff::ComputeTreeSize(const ParsedScript& script, size_t root, std::vector<size_t>& sizes) {
    if (root >= script.nodes.size()) return 0;
    // Init tree sizes
    if (sizes.size() != script.nodes.size()) {
        sizes.assign(script.nodes.size(), 0);
    } else if (auto n = sizes[root]; n > 0) {
        // Already computed
        return n;
    }

    // Run an iterative DFS
    struct SubtreeNode {
        size_t node;
        size_t parent;
    };
    std::vector<SubtreeNode> pending;
    std::vector<bool> visited;
    pending.reserve(32);
    visited.reserve(32);
    pending.push_back({root, root});
    visited.push_back(false);

    size_t node_count = 0;
    while (!pending.empty()) {
        auto [node_id, parent] = pending.back();

        // Already visited? Then all children have been summed into sizes[node_id].
        if (visited.back()) {
            if (pending.size() == 1) {
                node_count = sizes[node_id];
                break;
            }
            sizes[parent] += sizes[node_id];
            pending.pop_back();
            visited.pop_back();
            continue;
        }

        // Count the node itself and mark visited
        sizes[node_id] = 1;
        visited.back() = true;

        // Discover children
        auto& node = script.nodes[node_id];
        if (hasChildren(node.node_type())) {
            uint32_t children_begin = node.children_begin_or_value();
            uint32_t children_end = children_begin + node.children_count();
            for (uint32_t i = children_begin; i < children_end; ++i) {
                pending.push_back({i, node_id});
                visited.push_back(false);
            }
        }
    }
    return node_count;
}

/// Estimate the similarity of two statements (cheap; catches all unchanged statements in O(1))
ScriptDiff::SimilarityEstimate ScriptDiff::EstimateSimilarity(const ParsedScript::Statement& source,
                                                              const ParsedScript::Statement& target) const {
    // Guard invalid roots (error-recovery statements)
    if (source.root >= source_.nodes.size() || target.root >= target_.nodes.size()) {
        return SimilarityEstimate::NOT_EQUAL;
    }
    auto& s = source_.nodes[source.root];
    auto& t = target_.nodes[target.root];

    // Different root node types?
    if (s.node_type() != t.node_type()) return SimilarityEstimate::NOT_EQUAL;

    // Do a string comparison if the strings are equal in size and number of root attributes.
    // This bypasses the tree diffing for all unchanged statements.
    auto s_span = source_.scanned_script->ResolveTextSpan(s.symbol_span());
    auto t_span = target_.scanned_script->ResolveTextSpan(t.symbol_span());
    if (s.children_count() == t.children_count() && s_span.length() == t_span.length()) {
        auto st = source_.scanned_script->ReadTextAtTextSpan(s_span);
        auto tt = target_.scanned_script->ReadTextAtTextSpan(t_span);
        if (st == tt) return SimilarityEstimate::EQUAL;
    }
    return SimilarityEstimate::SIMILAR;
}

/// Compute the similarity of two statements (expensive; lockstep DFS over the subtrees)
ScriptDiff::StatementSimilarity ScriptDiff::ComputeSimilarity(const ParsedScript::Statement& source,
                                                              const ParsedScript::Statement& target) {
    auto source_size = ComputeTreeSize(source_, source.root, source_subtree_sizes_);
    auto target_size = ComputeTreeSize(target_, target.root, target_subtree_sizes_);
    auto node_count = std::max(source_size, target_size);
    if (node_count == 0) return StatementSimilarity{};

    struct Entry {
        size_t source_node;
        size_t target_node;
        size_t parent_entry;
        size_t matching_nodes;
    };
    std::vector<Entry> pending;
    std::vector<bool> visited;
    pending.reserve(32);
    visited.reserve(32);
    pending.push_back({source.root, target.root, 0, 0});
    visited.push_back(false);

    std::vector<uint32_t> src_children;
    std::vector<uint32_t> tgt_children;

    StatementSimilarity sim;
    while (!pending.empty()) {
        size_t idx = pending.size() - 1;

        // Already visited? Fold the matching count into the parent.
        if (visited[idx]) {
            if (idx == 0) {
                sim.total_nodes = node_count;
                sim.matching_nodes = pending[0].matching_nodes;
                break;
            }
            size_t parent = pending[idx].parent_entry;
            size_t matching = pending[idx].matching_nodes;
            pending.pop_back();
            visited.pop_back();
            pending[parent].matching_nodes += matching;
            continue;
        }
        visited[idx] = true;

        size_t source_id = pending[idx].source_node;
        size_t target_id = pending[idx].target_node;
        auto& s = source_.nodes[source_id];
        auto& t = target_.nodes[target_id];

        bool match = true;
        if (s.node_type() != t.node_type()) {
            match = false;
        } else {
            auto node_type = s.node_type();
            switch (node_type) {
                case NodeType::NONE:
                    break;
                case NodeType::BOOL:
                    match = s.children_begin_or_value() == t.children_begin_or_value();
                    break;
                case NodeType::NAME:
                    match = nameText(source_, s) == nameText(target_, t);
                    break;
                case NodeType::OPERATOR:
                case NodeType::LITERAL_NULL:
                case NodeType::LITERAL_INTEGER:
                case NodeType::LITERAL_FLOAT:
                case NodeType::LITERAL_STRING:
                case NodeType::LITERAL_INTERVAL:
                    match = nodeText(source_, s) == nodeText(target_, t);
                    break;
                case NodeType::ARRAY: {
                    auto sc = s.children_count();
                    auto tc = t.children_count();
                    match = sc == tc;
                    uint32_t sb = s.children_begin_or_value();
                    uint32_t tb = t.children_begin_or_value();
                    for (uint32_t i = 0, n = std::min(sc, tc); i < n; ++i) {
                        pending.push_back({sb + i, tb + i, idx, 0});
                        visited.push_back(false);
                    }
                    break;
                }
                default: {
                    if (isObjectType(node_type)) {
                        // Attribute lists are unsorted; sort scratch copies by key, then merge-join.
                        collectSortedChildren(source_, s, src_children);
                        collectSortedChildren(target_, t, tgt_children);
                        match = s.children_count() == t.children_count();
                        size_t i = 0, j = 0;
                        while (i < src_children.size() && j < tgt_children.size()) {
                            auto sk = keyId(source_.nodes[src_children[i]]);
                            auto tk = keyId(target_.nodes[tgt_children[j]]);
                            if (sk < tk) {
                                ++i;
                                match = false;
                            } else if (sk > tk) {
                                ++j;
                                match = false;
                            } else {
                                pending.push_back({src_children[i], tgt_children[j], idx, 0});
                                visited.push_back(false);
                                ++i;
                                ++j;
                            }
                        }
                    } else if (isEnumType(node_type)) {
                        match = s.children_begin_or_value() == t.children_begin_or_value();
                    }
                    break;
                }
            }
        }

        // `idx` still points at the current node (children were appended above it)
        if (match) {
            pending[idx].matching_nodes += 1;
        }
    }
    return sim;
}

/// Check two statements for deep equality
bool ScriptDiff::CheckDeepEquality(const ParsedScript::Statement& source, const ParsedScript::Statement& target) {
    if (source.root >= source_.nodes.size() || target.root >= target_.nodes.size()) {
        return source.root >= source_.nodes.size() && target.root >= target_.nodes.size();
    }

    struct Entry {
        size_t source_node;
        size_t target_node;
    };
    std::vector<Entry> pending;
    pending.reserve(32);
    pending.push_back({source.root, target.root});

    std::vector<uint32_t> src_children;
    std::vector<uint32_t> tgt_children;

    while (!pending.empty()) {
        auto [source_id, target_id] = pending.back();
        pending.pop_back();
        auto& s = source_.nodes[source_id];
        auto& t = target_.nodes[target_id];

        if (s.node_type() != t.node_type()) return false;

        auto node_type = s.node_type();
        switch (node_type) {
            case NodeType::NONE:
                break;
            case NodeType::BOOL:
                if (s.children_begin_or_value() != t.children_begin_or_value()) return false;
                break;
            case NodeType::NAME:
                if (nameText(source_, s) != nameText(target_, t)) return false;
                break;
            case NodeType::OPERATOR:
            case NodeType::LITERAL_NULL:
            case NodeType::LITERAL_INTEGER:
            case NodeType::LITERAL_FLOAT:
            case NodeType::LITERAL_STRING:
            case NodeType::LITERAL_INTERVAL:
                if (nodeText(source_, s) != nodeText(target_, t)) return false;
                break;
            case NodeType::ARRAY: {
                auto sc = s.children_count();
                auto tc = t.children_count();
                if (sc != tc) return false;
                uint32_t sb = s.children_begin_or_value();
                uint32_t tb = t.children_begin_or_value();
                for (uint32_t i = 0; i < sc; ++i) {
                    pending.push_back({sb + i, tb + i});
                }
                break;
            }
            default: {
                if (isObjectType(node_type)) {
                    if (s.children_count() != t.children_count()) return false;
                    collectSortedChildren(source_, s, src_children);
                    collectSortedChildren(target_, t, tgt_children);
                    for (size_t i = 0; i < src_children.size(); ++i) {
                        auto sk = keyId(source_.nodes[src_children[i]]);
                        auto tk = keyId(target_.nodes[tgt_children[i]]);
                        if (sk != tk) return false;
                        pending.push_back({src_children[i], tgt_children[i]});
                    }
                } else if (isEnumType(node_type)) {
                    if (s.children_begin_or_value() != t.children_begin_or_value()) return false;
                }
                break;
            }
        }
    }
    return true;
}

/// Map statements between the two scripts (unique + equal pairs, with ambiguity handling)
void ScriptDiff::MapStatements(StatementMappings& unique_pairs, StatementMappings& equal_pairs) {
    auto source_count = source_.statements.size();
    auto target_count = target_.statements.size();
    std::vector<bool> source_ambiguous(source_count, false);
    std::vector<bool> target_ambiguous(target_count, false);
    std::vector<std::optional<size_t>> target_mapping(target_count, std::nullopt);

    // We deviate from PatienceDiff slightly here: instead of first making both sides unique and then
    // matching, we assume statements are unique most of the time and compute the mapping directly.
    // The EstimateSimilarity short-circuit keeps the quadratic behaviour acceptable.
    for (size_t source_id = 0; source_id < source_count; ++source_id) {
        auto& source_stmt = source_.statements[source_id];
        std::optional<size_t> match;

        for (size_t target_id = 0; target_id < target_count; ++target_id) {
            auto& target_stmt = target_.statements[target_id];
            switch (EstimateSimilarity(source_stmt, target_stmt)) {
                case SimilarityEstimate::NOT_EQUAL:
                    break;
                case SimilarityEstimate::SIMILAR:
                    if (!CheckDeepEquality(source_stmt, target_stmt)) break;
                    [[fallthrough]];
                case SimilarityEstimate::EQUAL:
                    equal_pairs.push_back({source_id, target_id});

                    // Two source statements map to the same target statement?
                    if (auto existing = target_mapping[target_id]; existing) {
                        source_ambiguous[source_id] = true;
                        source_ambiguous[*existing] = true;
                        target_ambiguous[target_id] = true;
                        continue;
                    } else if (match) {
                        // The source statement maps to two target statements
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
    for (size_t target_id = 0; target_id < target_count; ++target_id) {
        auto source_id = target_mapping[target_id];
        if (!source_id) continue;
        if (source_ambiguous[*source_id] || target_ambiguous[target_id]) continue;
        unique_pairs.push_back({*source_id, target_id});
    }
    std::sort(unique_pairs.begin(), unique_pairs.end(), [](auto& l, auto& r) { return l.first < r.first; });
    std::sort(equal_pairs.begin(), equal_pairs.end());
}

/// Find the longest common subsequence among the unique pairs (patience sort)
ScriptDiff::StatementMappings ScriptDiff::FindLCS(const StatementMappings& unique_pairs) {
    StatementMappings lcs;
    struct Entry {
        size_t source_id;
        size_t target_id;
        size_t prev_pile_size;
    };
    using Pile = std::vector<Entry>;

    // Build the piles
    std::vector<Pile> piles;
    for (auto& [source_id, target_id] : unique_pairs) {
        auto p = std::find_if(piles.begin(), piles.end(),
                              [t = target_id](Pile& x) { return x.back().target_id >= t; });
        if (p != piles.end()) {
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

    if (piles.empty()) return lcs;

    // Walk back through the piles to build the LCS
    for (size_t pile_id = piles.size() - 1, entry_id = piles[pile_id].size() - 1;; --pile_id) {
        assert(entry_id < piles[pile_id].size());
        auto [source_id, target_id, prev_pile_size] = piles[pile_id][entry_id];
        lcs.push_back({source_id, target_id});
        if (pile_id == 0) break;
        assert(prev_pile_size >= 1);
        entry_id = prev_pile_size - 1;
    }
    std::reverse(lcs.begin(), lcs.end());
    return lcs;
}

/// Collect the changed sub-ranges within an UPDATE target statement (target-side highlighting)
std::vector<buffers::parser::TextSpan> ScriptDiff::CollectTargetChanges(const ParsedScript::Statement& source,
                                                                        const ParsedScript::Statement& target) {
    std::vector<TextSpan> changes;
    if (source.root >= source_.nodes.size() || target.root >= target_.nodes.size()) return changes;

    // Record the resolved span of a whole target subtree (or leaf)
    auto record = [&](size_t target_node_id) {
        auto span = target_.scanned_script->ResolveTextSpan(target_.nodes[target_node_id].symbol_span());
        if (span.length() > 0) changes.push_back(span);
    };

    struct Entry {
        size_t source_node;
        size_t target_node;
    };
    std::vector<Entry> pending;
    pending.reserve(32);
    pending.push_back({source.root, target.root});

    std::vector<uint32_t> src_children;
    std::vector<uint32_t> tgt_children;

    while (!pending.empty()) {
        auto [source_id, target_id] = pending.back();
        pending.pop_back();
        auto& s = source_.nodes[source_id];
        auto& t = target_.nodes[target_id];

        // Different node type => the entire target subtree changed. Record it and stop descending.
        if (s.node_type() != t.node_type()) {
            record(target_id);
            continue;
        }

        auto node_type = s.node_type();
        switch (node_type) {
            case NodeType::NONE:
                break;
            case NodeType::BOOL:
                if (s.children_begin_or_value() != t.children_begin_or_value()) record(target_id);
                break;
            case NodeType::NAME:
                if (nameText(source_, s) != nameText(target_, t)) record(target_id);
                break;
            case NodeType::OPERATOR:
            case NodeType::LITERAL_NULL:
            case NodeType::LITERAL_INTEGER:
            case NodeType::LITERAL_FLOAT:
            case NodeType::LITERAL_STRING:
            case NodeType::LITERAL_INTERVAL:
                if (nodeText(source_, s) != nodeText(target_, t)) record(target_id);
                break;
            case NodeType::ARRAY: {
                auto sc = s.children_count();
                auto tc = t.children_count();
                uint32_t sb = s.children_begin_or_value();
                uint32_t tb = t.children_begin_or_value();
                uint32_t common = std::min(sc, tc);
                for (uint32_t i = 0; i < common; ++i) {
                    pending.push_back({sb + i, tb + i});
                }
                // Extra target children are additions.
                for (uint32_t i = common; i < tc; ++i) {
                    record(tb + i);
                }
                break;
            }
            default: {
                if (isObjectType(node_type)) {
                    collectSortedChildren(source_, s, src_children);
                    collectSortedChildren(target_, t, tgt_children);
                    size_t i = 0, j = 0;
                    while (i < src_children.size() && j < tgt_children.size()) {
                        auto sk = keyId(source_.nodes[src_children[i]]);
                        auto tk = keyId(target_.nodes[tgt_children[j]]);
                        if (sk < tk) {
                            ++i;  // source-only attribute (removed); nothing to highlight on target
                        } else if (sk > tk) {
                            record(tgt_children[j]);  // target-only attribute (added)
                            ++j;
                        } else {
                            pending.push_back({src_children[i], tgt_children[j]});
                            ++i;
                            ++j;
                        }
                    }
                    // Remaining target-only attributes
                    for (; j < tgt_children.size(); ++j) {
                        record(tgt_children[j]);
                    }
                } else if (isEnumType(node_type)) {
                    if (s.children_begin_or_value() != t.children_begin_or_value()) record(target_id);
                }
                break;
            }
        }
    }

    // Sort and coalesce overlapping/adjacent spans into a minimal list
    if (changes.size() > 1) {
        std::sort(changes.begin(), changes.end(),
                  [](const TextSpan& l, const TextSpan& r) { return l.offset() < r.offset(); });
        std::vector<TextSpan> coalesced;
        coalesced.reserve(changes.size());
        coalesced.push_back(changes.front());
        for (size_t k = 1; k < changes.size(); ++k) {
            auto& last = coalesced.back();
            uint32_t last_end = last.offset() + last.length();
            if (changes[k].offset() <= last_end) {
                uint32_t new_end = std::max(last_end, changes[k].offset() + changes[k].length());
                last = TextSpan(last.offset(), new_end - last.offset());
            } else {
                coalesced.push_back(changes[k]);
            }
        }
        changes = std::move(coalesced);
    }
    return changes;
}

/// Compute the diff between the two scripts
const std::vector<ScriptDiff::DiffOp>& ScriptDiff::Compute() {
    if (computed_) return ops_;
    computed_ = true;

    auto source_count = source_.statements.size();
    auto target_count = target_.statements.size();

    // Map statements and build the LCS
    StatementMappings unique_pairs;
    StatementMappings equal_pairs;
    MapStatements(unique_pairs, equal_pairs);
    auto lcs = FindLCS(unique_pairs);

    std::vector<bool> source_emitted(source_count, false);
    std::vector<bool> target_emitted(target_count, false);

    auto emit = [&](OpCode code, std::optional<size_t> source_id, std::optional<size_t> target_id) {
        DiffOp op;
        op.code = code;
        if (source_id) {
            op.source_statement = static_cast<StatementID>(*source_id);
            op.source_span = resolveStatementSpan(source_, source_.statements[*source_id]);
            source_emitted[*source_id] = true;
        }
        if (target_id) {
            op.target_statement = static_cast<StatementID>(*target_id);
            op.target_span = resolveStatementSpan(target_, target_.statements[*target_id]);
            target_emitted[*target_id] = true;
        }
        if (code == OpCode::UPDATE && source_id && target_id) {
            op.target_changes = CollectTargetChanges(source_.statements[*source_id], target_.statements[*target_id]);
        }
        ops_.push_back(std::move(op));
    };

    // Iterate over the LCS sections
    StatementMapping prev = {0, 0};
    StatementMapping next = {0, 0};
    for (auto lcs_iter = lcs.begin();; ++lcs_iter) {
        prev = next;
        next = (lcs_iter < lcs.end()) ? *lcs_iter : StatementMapping{source_count, target_count};
        auto [prev_source_id, prev_target_id] = prev;
        auto [next_source_id, next_target_id] = next;

        // Iterate over all source statements in the section
        for (auto source_id = prev_source_id; source_id < next_source_id; ++source_id) {
            // Emit equal pairs that are either ambiguous or unique but cross section boundaries (MOVE).
            auto cmp_lb = [](const StatementMapping& l, size_t v) { return l.first < v; };
            auto cmp_ub = [](size_t v, const StatementMapping& r) { return v < r.first; };
            auto equal_begin = std::lower_bound(equal_pairs.begin(), equal_pairs.end(), source_id, cmp_lb);
            auto equal_end = std::upper_bound(equal_begin, equal_pairs.end(), source_id, cmp_ub);
            for (auto equal_iter = equal_begin; equal_iter != equal_end; ++equal_iter) {
                auto target_id = equal_iter->second;
                if (target_emitted[target_id]) continue;
                emit(OpCode::MOVE, source_id, target_id);
                break;
            }
            if (source_emitted[source_id]) continue;
            auto& source_stmt = source_.statements[source_id];

            // Find the best match among the remaining targets in the section.
            // We pick the highest-scoring target above the threshold (a deliberate divergence from the
            // legacy heap, which picked the smallest qualifying score).
            std::optional<size_t> best_target;
            double best_score = -1.0;
            for (auto target_id = prev_target_id; target_id < next_target_id; ++target_id) {
                if (target_emitted[target_id]) continue;
                auto& target_stmt = target_.statements[target_id];
                // Fast estimate first; the similarity computation is the most expensive step.
                auto sim_est = EstimateSimilarity(source_stmt, target_stmt);
                if (sim_est == SimilarityEstimate::NOT_EQUAL) {
                    continue;
                } else if (sim_est == SimilarityEstimate::EQUAL) {
                    emit(OpCode::KEEP, source_id, target_id);
                    break;
                }
                auto sim_score = ComputeSimilarity(source_stmt, target_stmt).Score();
                if (sim_score >= UPDATE_SIMILARITY_THRESHOLD && sim_score > best_score) {
                    best_score = sim_score;
                    best_target = target_id;
                }
            }
            if (source_emitted[source_id]) continue;  // an EQUAL match emitted a KEEP

            if (best_target) {
                emit(OpCode::UPDATE, source_id, *best_target);
            } else {
                emit(OpCode::DELETE, source_id, std::nullopt);
            }
        }

        // Create the new statements in the section
        for (auto target_id = prev_target_id; target_id < next_target_id; ++target_id) {
            if (!target_emitted[target_id]) {
                emit(OpCode::INSERT, std::nullopt, target_id);
            }
        }

        if (lcs_iter == lcs.end()) break;
        emit(OpCode::KEEP, next_source_id, next_target_id);
    }
    return ops_;
}

/// Pack the diff into a flatbuffer
flatbuffers::Offset<buffers::diff::ScriptDiff> ScriptDiff::Pack(flatbuffers::FlatBufferBuilder& builder) {
    Compute();

    std::vector<flatbuffers::Offset<buffers::diff::ScriptDiffOp>> op_offsets;
    op_offsets.reserve(ops_.size());
    for (auto& op : ops_) {
        // Vectors must be created before the table builder is started
        flatbuffers::Offset<flatbuffers::Vector<const TextSpan*>> changes_ofs = 0;
        if (!op.target_changes.empty()) {
            changes_ofs = builder.CreateVectorOfStructs(op.target_changes.data(), op.target_changes.size());
        }

        buffers::diff::ScriptDiffOpBuilder op_builder{builder};
        op_builder.add_code(op.code);
        op_builder.add_source_statement(op.source_statement.value_or(std::numeric_limits<uint32_t>::max()));
        op_builder.add_target_statement(op.target_statement.value_or(std::numeric_limits<uint32_t>::max()));
        if (op.source_statement) op_builder.add_source_span(&op.source_span);
        if (op.target_statement) op_builder.add_target_span(&op.target_span);
        if (!op.target_changes.empty()) op_builder.add_target_changes(changes_ofs);
        op_offsets.push_back(op_builder.Finish());
    }
    auto ops_ofs = builder.CreateVector(op_offsets);

    buffers::diff::ScriptDiffBuilder diff_builder{builder};
    diff_builder.add_ops(ops_ofs);
    return diff_builder.Finish();
}

}  // namespace dashql
