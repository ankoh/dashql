// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
#define INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_

#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <unordered_map>
#include <variant>

#include "dashql/analyzer/program_instance.h"
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
    UI32_BITMAP,
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
    template <typename T> T DataAsEnum() const {
        auto* v = std::get_if<uint32_t>(&data);
        return static_cast<T>(!!v ? *v : 0);
    }
    /// Matched
    operator bool() const { return status == NodeMatchingStatus::MATCHED; }
};

/// Use uint32_t max as NULL matching id
constexpr size_t DISCARD_SYNTAX_MATCH = std::numeric_limits<uint32_t>::max();

/// A syntax matcher
struct SyntaxMatcher {
    /// The matching identifier (if any)
    size_t matching_id = DISCARD_SYNTAX_MATCH;
    /// The attribute key (if any)
    sx::AttributeKey attribute_key = sx::AttributeKey::NONE;
    /// The matcher type
    SyntaxMatcherType node_spec = SyntaxMatcherType::OBJECT;
    /// The node type
    sx::NodeType node_type = sx::NodeType::NONE;
    /// The children (if any)
    std::vector<SyntaxMatcher> children = {};

    static inline SyntaxMatcher Element(size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .matching_id = matching,
            .attribute_key = sx::AttributeKey::NONE,
            .node_spec = SyntaxMatcherType::OBJECT,
            .node_type = sx::NodeType::NONE,
            .children = {},
        };
    }

    static inline SyntaxMatcher Attribute(sx::AttributeKey key, size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .matching_id = matching,
            .attribute_key = key,
            .node_spec = SyntaxMatcherType::OBJECT,
            .node_type = sx::NodeType::NONE,
            .children = {},
        };
    }

    static inline SyntaxMatcher Option(sx::AttributeKey key, size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .matching_id = matching,
            .attribute_key = key,
            .node_spec = SyntaxMatcherType::OBJECT,
            .node_type = sx::NodeType::NONE,
            .children = {},
        };
    }

    /// Add children
    inline SyntaxMatcher& MatchChildren(std::initializer_list<SyntaxMatcher> c) {
        children = std::move(c);
        return *this;
    }

    /// Create an object
    constexpr inline SyntaxMatcher& MatchObject(sx::NodeType type) {
        node_spec = SyntaxMatcherType::OBJECT;
        node_type = type;
        return *this;
    }
    /// Create options
    constexpr inline SyntaxMatcher& MatchOptions() {
        node_spec = SyntaxMatcherType::OBJECT;
        node_type = sx::NodeType::OBJECT_DASHQL_OPTION_LIST;
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
        node_type = sx::NodeType::BOOL;
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
        node_type = sx::NodeType::UI32;
        return *this;
    }
    /// Create an integer bitmap
    constexpr inline SyntaxMatcher& MatchUI32Bitmap() {
        node_spec = SyntaxMatcherType::UI32_BITMAP;
        node_type = sx::NodeType::UI32_BITMAP;
        return *this;
    }

    /// Match a schema
    bool Match(const ProgramInstance& program, const sx::Node& node, nonstd::span<NodeMatching> matching) const;
};
using sxm = SyntaxMatcher;

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
