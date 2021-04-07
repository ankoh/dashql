// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
#define INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_

#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <unordered_map>
#include <variant>

#include "dashql/analyzer/program_linter.h"
#include "dashql/common/enum.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

namespace sx = proto::syntax;

struct ProgramInstance;

/// A node spec type
enum ASTMatcherType {
    ARRAY,
    BOOL,
    ENUM,
    OBJECT,
    STRING,
    UI32,
    UI32_BITMAP,
};

/// A node matching status
enum NodeMatchStatus {
    MISSING,
    TYPE_MISMATCH,
    MATCHED,
};

/// A node match
struct NodeMatch {
    /// The matching status
    NodeMatchStatus status = NodeMatchStatus::MISSING;
    /// The node id (if any)
    size_t node_id = std::numeric_limits<size_t>::max();
    /// The value (if any)
    std::variant<std::monostate, bool, uint32_t, std::string_view> data = std::monostate();

    /// Is matched?
    bool IsMatched() const { return status == NodeMatchStatus::MATCHED; }
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
    operator bool() const { return IsMatched(); }
};

class ASTMatcher;

/// The syntax match gives us constant time to all expected attributes in a node.
class ASTIndex {
    friend class ASTMatcher;

   protected:
    /// The schema
    const ASTMatcher& schema;
    /// The node matches
    std::vector<NodeMatch> matches;
    /// Is a full match?
    bool full_match;

   public:
    /// Constructor
    ASTIndex(const ASTMatcher& schema, size_t size) : schema(schema), matches(size), full_match(true) {}

    /// Subscript operator
    const NodeMatch& operator[](size_t id) const { return matches[id]; };

    /// Is full match?
    bool IsFullMatch() const { return full_match; }
    /// Is any node set?
    bool HasAny(std::initializer_list<size_t> ids) const;
    /// Is any node set?
    bool HasAny(std::initializer_list<const NodeMatch*> matches) const;
    /// Select a node with alternative
    const NodeMatch* SelectAlt(size_t id, size_t alt_id) const;
};

/// Use uint32_t max as NULL matching id
constexpr size_t DISCARD_SYNTAX_MATCH = std::numeric_limits<uint32_t>::max();

/// A syntax matcher
struct ASTMatcher {
    /// The matcher type
    ASTMatcherType node_spec = ASTMatcherType::OBJECT;
    /// The attribute key (if any)
    sx::AttributeKey attribute_key = sx::AttributeKey::NONE;
    /// The node type
    sx::NodeType node_type = sx::NodeType::NONE;
    /// The matching identifier (if any)
    size_t matching_id = DISCARD_SYNTAX_MATCH;
    /// The children (if any)
    std::vector<ASTMatcher> children = {};

    static inline ASTMatcher Element(size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .node_spec = ASTMatcherType::OBJECT,
            .attribute_key = sx::AttributeKey::NONE,
            .node_type = sx::NodeType::NONE,
            .matching_id = matching,
            .children = {},
        };
    }

    static inline ASTMatcher Attribute(sx::AttributeKey key, size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .node_spec = ASTMatcherType::OBJECT,
            .attribute_key = key,
            .node_type = sx::NodeType::NONE,
            .matching_id = matching,
            .children = {},
        };
    }

    static inline ASTMatcher Option(sx::AttributeKey key, size_t matching = DISCARD_SYNTAX_MATCH) {
        return {
            .node_spec = ASTMatcherType::OBJECT,
            .attribute_key = key,
            .node_type = sx::NodeType::NONE,
            .matching_id = matching,
            .children = {},
        };
    }

    /// Add children
    inline ASTMatcher& MatchChildren(std::initializer_list<ASTMatcher> c) {
        assert(std::is_sorted(c.begin(), c.end(), [&](auto& l, auto& r) { return l.attribute_key < r.attribute_key; }));
        children = std::move(c);
        return *this;
    }

    /// Create an object
    constexpr inline ASTMatcher& MatchObject(sx::NodeType type) {
        node_spec = ASTMatcherType::OBJECT;
        node_type = type;
        return *this;
    }
    /// Create options
    constexpr inline ASTMatcher& MatchOptions() {
        node_spec = ASTMatcherType::OBJECT;
        node_type = sx::NodeType::OBJECT_DASHQL_OPTION_LIST;
        return *this;
    }
    /// Create an array
    constexpr inline ASTMatcher& MatchArray() {
        node_spec = ASTMatcherType::ARRAY;
        node_type = sx::NodeType::ARRAY;
        return *this;
    }
    /// Create a string
    constexpr inline ASTMatcher& MatchString() {
        node_spec = ASTMatcherType::STRING;
        node_type = sx::NodeType::NONE;
        return *this;
    }
    /// Create a boolean
    constexpr inline ASTMatcher& MatchBool() {
        node_spec = ASTMatcherType::BOOL;
        node_type = sx::NodeType::BOOL;
        return *this;
    }
    /// Create an enum
    constexpr inline ASTMatcher& MatchEnum(sx::NodeType type) {
        node_spec = ASTMatcherType::ENUM;
        node_type = type;
        return *this;
    }
    /// Create an integer
    constexpr inline ASTMatcher& MatchUI32() {
        node_spec = ASTMatcherType::UI32;
        node_type = sx::NodeType::UI32;
        return *this;
    }
    /// Create an integer bitmap
    constexpr inline ASTMatcher& MatchUI32Bitmap() {
        node_spec = ASTMatcherType::UI32_BITMAP;
        node_type = sx::NodeType::UI32_BITMAP;
        return *this;
    }

    /// Match a schema
    ASTIndex Match(const ProgramInstance& program, size_t node_id, size_t match_size) const;
};
using sxm = ASTMatcher;

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_SYNTAX_MATCHER_H_
