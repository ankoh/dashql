// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
#define INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_

#include <iostream>
#include <sstream>
#include <optional>
#include <unordered_map>
#include <variant>

#include "dashql/analyzer/program_instance.h"
#include "dashql/webdb/value.h"
#include "dashql/common/enum.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = proto::syntax;

/// A node spec type
enum SyntaxMatcherType {
    ARRAY,
    BOOL,
    ENUM,
    OBJECT,
    STRING,
    UI32,
};

/// A node matching status
enum NodeMatchingStatus {
    MISSING,
    TYPE_MISMATCH,
    MATCHED,
};

/// A node matching
struct NodeMatching {
    /// The matching status
    NodeMatchingStatus status = NodeMatchingStatus::MISSING;
    /// The node pointer (if any)
    const sx::Node* node = nullptr;
    /// The value (if any)
    std::variant<std::monostate, bool, uint32_t, std::string_view> data = std::monostate();

    /// Has a value?
    bool HasData() const { return !std::holds_alternative<std::monostate>(data); }
    /// Get the value as string ref
    std::string_view DataAsStringRef() const;
    /// Get the value as string
    std::string DataAsString() const;
    /// Get the value as integer
    int64_t DataAsI64() const;
    /// Get the value as double
    double DataAsDouble() const;
    /// Get the value as enum
    template <typename T>
    T DataAsEnum() const {
        auto* v = std::get_if<uint32_t>(&data);
        return static_cast<T>(!!v ? *v : 0);
    }
};

/// A syntax matcher
struct SyntaxMatcher {
    /// The matching identifier (if any)
    std::optional<size_t> matching_id = std::nullopt;
    /// The attribute key (if any)
    sx::AttributeKey attribute_key = sx::AttributeKey::NONE;
    /// The matcher type
    SyntaxMatcherType node_spec = SyntaxMatcherType::OBJECT;
    /// The node type
    sx::NodeType node_type = sx::NodeType::NONE;
    /// The children (if any)
    nonstd::span<const SyntaxMatcher> children = {};

    /// A buffer to inline static nodes
    template <size_t ID, size_t N>
    struct StaticNodeMatchers {
        static inline nonstd::span<const SyntaxMatcher> Create(std::array<SyntaxMatcher, N> elements) {
            assert(std::is_sorted(elements.begin(), elements.end(), [](auto& l, auto& r) {
                return l.attribute_key < r.attribute_key;
            }));
            static const std::array<SyntaxMatcher, N> buffer = move(elements);
            return {buffer.data(), buffer.size()};
        }
    };
#define NUM_NODES(...)  (sizeof((SyntaxMatcher[]){__VA_ARGS__})/sizeof(SyntaxMatcher))
#define NODE_MATCHERS(...) SyntaxMatcher::StaticNodeMatchers<__COUNTER__, NUM_NODES(__VA_ARGS__)>::Create({__VA_ARGS__})

    static constexpr inline SyntaxMatcher Element(std::optional<size_t> matching = std::nullopt) {
        return {
            .matching_id = matching,
            .attribute_key = sx::AttributeKey::NONE,
            .node_spec = SyntaxMatcherType::OBJECT,
            .node_type = sx::NodeType::NONE,
            .children = {},
        };
    }

    static constexpr inline SyntaxMatcher Attribute(sx::AttributeKey key, std::optional<size_t> matching = std::nullopt) {
        return {
            .matching_id = matching,
            .attribute_key = key,
            .node_spec = SyntaxMatcherType::OBJECT,
            .node_type = sx::NodeType::NONE,
            .children = {},
        };
    }

    /// Add children
    constexpr inline SyntaxMatcher& MatchChildren(nonstd::span<const SyntaxMatcher> c) {
        children = c;
        return *this;
    }

    /// Create an object
    constexpr inline SyntaxMatcher& MatchObject(sx::NodeType type) {
        node_spec = SyntaxMatcherType::OBJECT;
        node_type = type;
        return *this;
    }
    /// Create an array
    constexpr inline SyntaxMatcher& MatchArray() {
        node_spec = SyntaxMatcherType::ARRAY;
        node_type = sx::NodeType::ARRAY;
        return *this;
    }
    /// Create a string
    constexpr inline SyntaxMatcher& MatchString() {
        node_spec = SyntaxMatcherType::STRING;
        node_type = sx::NodeType::NONE;
        return *this;
    }
    /// Create a boolean
    constexpr inline SyntaxMatcher& MatchBool() {
        node_spec = SyntaxMatcherType::BOOL;
        node_type = sx::NodeType::NONE;
        return *this;
    }
    /// Create an enum
    constexpr inline SyntaxMatcher& MatchEnum(sx::NodeType type) {
        node_spec = SyntaxMatcherType::ENUM;
        node_type = type;
        return *this;
    }
    /// Create an integer
    constexpr inline SyntaxMatcher& MatchUI32() {
        node_spec = SyntaxMatcherType::UI32;
        node_type = sx::NodeType::NONE;
        return *this;
    }

    /// Match a schema
    bool Match(const ProgramInstance& program, const sx::Node& node, nonstd::span<NodeMatching> matching) const;
};
using sxm = SyntaxMatcher;

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
