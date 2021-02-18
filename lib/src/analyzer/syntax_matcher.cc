#include "dashql/analyzer/syntax_matcher.h"

#include <istream>
#include <streambuf>

#include "dashql/common/memstream.h"
#include "dashql/common/variant.h"

namespace dashql {

// Return as string ref
std::string_view NodeMatching::DataAsStringRef() const {
    return std::visit(overload{
                          [](std::string_view arg) { return arg; },
                          [](auto arg) { return std::string_view{""}; },
                      },
                      data);
}

// Return as string
std::string NodeMatching::DataAsString() const {
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
int64_t NodeMatching::DataAsI64() const {
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
double NodeMatching::DataAsDouble() const {
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
bool SyntaxMatcher::Match(const ProgramInstance& program, const sx::Node& root, nonstd::span<NodeMatching> out) const {
    bool full_match = true;

    // Helper to get matching output
    NodeMatching tmp;
    auto getOut = [&](const SyntaxMatcher& matcher) -> NodeMatching& {
        assert(!matcher.matching_id || matcher.matching_id < out.size());
        return matcher.matching_id ? out[*matcher.matching_id] : tmp;
    };

    // Match the matcher with a DFS
    struct Step {
        const sx::Node& node;
        const SyntaxMatcher& matcher;
    };
    std::vector<Step> pending;
    pending.reserve(8);
    pending.push_back({root, *this});

    while (!pending.empty()) {
        auto top = pending.back();
        pending.pop_back();
        auto& matching = getOut(top.matcher);
        matching.node = &top.node;

        // Compare node type
        if (top.matcher.node_type != sx::NodeType::NONE && top.matcher.node_type != top.node.node_type()) {
            matching.status = NodeMatchingStatus::TYPE_MISMATCH;
            full_match = false;
            continue;
        }

        // Match the node spec
        switch (top.matcher.node_spec) {
            case SyntaxMatcherType::BOOL:
                matching.status = NodeMatchingStatus::MATCHED;
                matching.data = top.node.children_begin_or_value() != 0;
                break;
            case SyntaxMatcherType::UI32:
                matching.status = NodeMatchingStatus::MATCHED;
                matching.data = top.node.children_begin_or_value();
                break;
            case SyntaxMatcherType::UI32_BITMAP:
                matching.status = NodeMatchingStatus::MATCHED;
                matching.data = top.node.children_begin_or_value();
                break;
            case SyntaxMatcherType::STRING:
                if (top.node.node_type() == sx::NodeType::STRING_REF) {
                    matching.status = NodeMatchingStatus::MATCHED;
                    matching.data = program.TextAt(top.node.location());
                } else {
                    matching.status = NodeMatchingStatus::MISSING;
                    full_match = false;
                }
                break;
            case SyntaxMatcherType::ENUM:
                matching.status = NodeMatchingStatus::MATCHED;
                matching.data = top.node.children_begin_or_value();
                break;
            case SyntaxMatcherType::ARRAY: {
                matching.status = NodeMatchingStatus::MATCHED;
                auto visit = std::min<size_t>(top.node.children_count(), top.matcher.children.size());
                auto unmatched = top.matcher.children.size() - visit;
                auto base = top.node.children_begin_or_value();
                for (unsigned i = 0; i < visit; ++i) {
                    pending.push_back({program.program().nodes[base + i], top.matcher.children[i]});
                }
                for (unsigned i = 0; i < unmatched; ++i) {
                    getOut(top.matcher.children[visit + i]).status = NodeMatchingStatus::MISSING;
                    full_match = false;
                }
                break;
            }
            case SyntaxMatcherType::OBJECT: {
                matching.status = NodeMatchingStatus::MATCHED;
                nonstd::span<const sx::Node> children{
                    program.program().nodes.data() + top.node.children_begin_or_value(), top.node.children_count()};
                assert(std::is_sorted(children.begin(), children.end(),
                                      [](auto& l, auto& r) { return l.attribute_key() < r.attribute_key(); }));
                size_t h = 0, e = 0;
                while (h < children.size() && e < top.matcher.children.size()) {
                    auto& have = children[h];
                    auto& expected = top.matcher.children[e];
                    if (have.attribute_key() < expected.attribute_key) {
                        ++h;
                    } else if (have.attribute_key() > expected.attribute_key) {
                        getOut(expected).status = NodeMatchingStatus::MISSING;
                        full_match = false;
                        ++e;
                    } else {
                        pending.push_back({have, expected});
                        ++h;
                        ++e;
                    }
                }
                for (; e < top.matcher.children.size(); ++e) {
                    getOut(top.matcher.children[e]).status = NodeMatchingStatus::MISSING;
                    full_match = false;
                }
                break;
            }
        }
    }
    return full_match;
}

}  // namespace dashql
