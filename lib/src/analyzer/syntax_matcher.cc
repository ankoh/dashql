#include "dashql/analyzer/syntax_matcher.h"

#include <istream>
#include <streambuf>

#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/stmt/input_stmt.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"

namespace dashql {

// Return as string ref
std::string_view NodeMatch::DataAsStringRef() const {
    return std::visit(overload{
                          [](std::string_view arg) { return arg; },
                          [](auto arg) { return std::string_view{""}; },
                      },
                      data);
}

// Return as string
std::string NodeMatch::DataAsString() const {
    return std::visit(overload{
                          [](bool arg) { return std::to_string(arg); },
                          [](double arg) { return std::to_string(arg); },
                          [](uint32_t arg) { return std::to_string(arg); },
                          [](std::string_view arg) { return std::string{arg}; },
                          [](auto arg) { return std::string{""}; },
                      },
                      data);
}

// Return as string
int64_t NodeMatch::DataAsI64() const {
    return std::visit(overload{
                          [](bool arg) { return static_cast<int64_t>(arg); },
                          [](double arg) { return static_cast<int64_t>(arg); },
                          [](uint32_t arg) { return static_cast<int64_t>(arg); },
                          [](std::string_view arg) {
                              int64_t value;
                              imemstream ss{arg.data(), arg.size()};
                              ss >> value;
                              return value;
                          },
                          [](auto arg) { return static_cast<int64_t>(0); },
                      },
                      data);
}

// Return as double
double NodeMatch::DataAsDouble() const {
    return std::visit(overload{
                          [](bool arg) { return static_cast<double>(arg); },
                          [](double arg) { return arg; },
                          [](uint32_t arg) { return static_cast<double>(arg); },
                          [](std::string_view arg) {
                              double value;
                              imemstream ss{arg.data(), arg.size()};
                              ss >> value;
                              return value;
                          },
                          [](auto arg) { return 0.0; },
                      },
                      data);
}

/// Match a matcher
ASTIndex ASTMatcher::Match(const ProgramInstance& instance, size_t root_id, size_t match_size) const {
    return Match(instance.program().nodes, instance.program_text(), root_id, match_size);
}

/// Match a matcher
ASTIndex ASTMatcher::Match(nonstd::span<sx::Node> nodes, std::string_view text, size_t root_id,
                           size_t match_size) const {
    ASTIndex index{*this, match_size};

    // Helper to get matching output
    NodeMatch tmp;
    auto getOut = [&](const ASTMatcher& matcher) -> NodeMatch& {
        if (matcher.matching_id == DISCARD_SYNTAX_MATCH) return tmp;
        assert(matcher.matching_id < index.matches.size());
        return index.matches[matcher.matching_id];
    };

    // Match the matcher with a DFS
    struct Step {
        size_t node_id;
        const ASTMatcher& matcher;
    };
    std::vector<Step> pending;
    pending.reserve(8);
    pending.push_back({root_id, *this});

    while (!pending.empty()) {
        auto top = pending.back();
        auto& top_node = nodes[top.node_id];
        pending.pop_back();
        auto& matching = getOut(top.matcher);
        matching.node_id = top.node_id;

        // Compare node type
        if (top.matcher.node_type != sx::NodeType::NONE && top.matcher.node_type != top_node.node_type()) {
            matching.status = NodeMatchStatus::TYPE_MISMATCH;
            index.full_match = false;
            continue;
        }

        // Match the node spec
        switch (top.matcher.node_spec) {
            case ASTMatcherType::BOOL:
                matching.status = NodeMatchStatus::MATCHED;
                matching.data = top_node.children_begin_or_value() != 0;
                break;
            case ASTMatcherType::UI32:
                matching.status = NodeMatchStatus::MATCHED;
                matching.data = top_node.children_begin_or_value();
                break;
            case ASTMatcherType::UI32_BITMAP:
                matching.status = NodeMatchStatus::MATCHED;
                matching.data = top_node.children_begin_or_value();
                break;
            case ASTMatcherType::STRING:
                if (top_node.node_type() == sx::NodeType::STRING_REF) {
                    matching.status = NodeMatchStatus::MATCHED;
                    auto loc = top_node.location();
                    matching.data = std::string_view{text}.substr(loc.offset(), loc.length());
                } else {
                    matching.status = NodeMatchStatus::MISSING;
                    index.full_match = false;
                }
                break;
            case ASTMatcherType::ENUM:
                matching.status = NodeMatchStatus::MATCHED;
                matching.data = top_node.children_begin_or_value();
                break;
            case ASTMatcherType::ARRAY: {
                matching.status = NodeMatchStatus::MATCHED;
                auto visit = std::min<size_t>(top_node.children_count(), top.matcher.children.size());
                auto unmatched = top.matcher.children.size() - visit;
                auto base = top_node.children_begin_or_value();
                for (unsigned i = 0; i < visit; ++i) {
                    pending.push_back({base + i, top.matcher.children[i]});
                }
                for (unsigned i = 0; i < unmatched; ++i) {
                    getOut(top.matcher.children[visit + i]).status = NodeMatchStatus::MISSING;
                    index.full_match = false;
                }
                break;
            }
            case ASTMatcherType::OBJECT: {
                matching.status = NodeMatchStatus::MATCHED;
                nonstd::span<const sx::Node> children{nodes.data() + top_node.children_begin_or_value(),
                                                      top_node.children_count()};
                assert(std::is_sorted(children.begin(), children.end(),
                                      [](auto& l, auto& r) { return l.attribute_key() < r.attribute_key(); }));

                size_t h = 0, e = 0;
                while (h < children.size() && e < top.matcher.children.size()) {
                    auto& have = children[h];
                    auto& expected = top.matcher.children[e];
                    if (have.attribute_key() < expected.attribute_key ||
                        have.attribute_key() > static_cast<uint16_t>(sx::AttributeKey::DSON_DYNAMIC_KEYS_)) {
                        ++h;
                    } else if (have.attribute_key() > expected.attribute_key) {
                        getOut(expected).status = NodeMatchStatus::MISSING;
                        index.full_match = false;
                        ++e;
                    } else {
                        pending.push_back({top_node.children_begin_or_value() + h, expected});
                        ++h;
                        ++e;
                    }
                }
                for (; e < top.matcher.children.size(); ++e) {
                    getOut(top.matcher.children[e]).status = NodeMatchStatus::MISSING;
                    index.full_match = false;
                }
                break;
            }
            case ASTMatcherType::SELECT_BY_TYPE: {
                matching.status = NodeMatchStatus::MISSING;
                for (auto i = 0; i < top.matcher.children.size(); ++i) {
                    auto& child_matcher = top.matcher.children[i];
                    if (child_matcher.node_type == top_node.node_type()) {
                        pending.push_back({top.node_id, child_matcher});
                        matching.status = NodeMatchStatus::MATCHED;
                    }
                }
                if (matching.status == NodeMatchStatus::MISSING) {
                    index.full_match = false;
                }
                break;
            }
        }
    }
    return index;
}

/// Select an option
bool ASTIndex::HasAny(std::initializer_list<size_t> ids) const {
    bool any = false;
    for (auto id : ids) {
        any |= matches[id].IsMatched();
    }
    return any;
}

/// Select an option
bool ASTIndex::HasAny(std::initializer_list<const NodeMatch*> nodes) const {
    bool any = false;
    for (auto* node : nodes) {
        any |= node && node->IsMatched();
    }
    return any;
}

/// Select an option with alternative
const NodeMatch* ASTIndex::SelectAlt(size_t id, size_t alt_id) const {
    const NodeMatch* match = nullptr;
    if (matches[id].node_id < INVALID_NODE_ID) {
        match = &matches[id];
    } else if (matches[alt_id].node_id < INVALID_NODE_ID) {
        match = &matches[alt_id];
    }
    return match;
}

}  // namespace dashql
