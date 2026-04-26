#pragma once

#include <cctype>
#include <charconv>
#include <initializer_list>
#include <string>
#include <utility>

#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/grammar/location.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/scanner.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql {
namespace parser {

/// Helper to configure an attribute node
inline buffers::parser::Node Attr(buffers::parser::AttributeKey key, buffers::parser::Node node) {
    return buffers::parser::Node(node.location(), node.node_type(), key, node.parent(), node.children_begin_or_value(),
                       node.children_count());
}
/// Helper to concatenate lists
inline WeakUniquePtr<NodeList> Concat(WeakUniquePtr<NodeList>&& l, WeakUniquePtr<NodeList>&& r) {
    l->append(std::move(r));
    return l;
}
/// Helper to concatenate lists
inline WeakUniquePtr<NodeList> Concat(WeakUniquePtr<NodeList>&& l, std::initializer_list<buffers::parser::Node> r) {
    l->append(std::move(r));
    return l;
}
/// Helper to concatenate lists
inline WeakUniquePtr<NodeList> Concat(WeakUniquePtr<NodeList>&& v0, WeakUniquePtr<NodeList>&& v1,
                                      std::initializer_list<buffers::parser::Node> v2) {
    v0->append(std::move(v1));
    v0->append(std::move(v2));
    return v0;
}
/// Helper to concatenate lists
inline WeakUniquePtr<NodeList> Concat(WeakUniquePtr<NodeList>&& v0, WeakUniquePtr<NodeList>&& v1,
                                      WeakUniquePtr<NodeList>&& v2, std::initializer_list<buffers::parser::Node> v3 = {}) {
    v0->append(std::move(v1));
    v0->append(std::move(v2));
    v0->append(std::move(v3));
    return v0;
}

/// Create a null node
inline buffers::parser::Node Null() {
    return buffers::parser::Node(buffers::parser::Location(), buffers::parser::NodeType::NONE, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
}
/// Create a name from an identifier
inline buffers::parser::Node Operator(buffers::parser::Location loc) {
    return buffers::parser::Node(loc, buffers::parser::NodeType::OPERATOR, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
}
/// Create a name from an identifier
inline buffers::parser::Node NameFromIdentifier(buffers::parser::Location loc, size_t value) {
    return buffers::parser::Node(loc, buffers::parser::NodeType::NAME, buffers::parser::AttributeKey::NONE, NO_PARENT, value, 0);
}
/// Create a bool node
inline buffers::parser::Node Bool(buffers::parser::Location loc, bool v) {
    return buffers::parser::Node(loc, buffers::parser::NodeType::BOOL, buffers::parser::AttributeKey::NONE, NO_PARENT, static_cast<uint32_t>(v), 0);
}

/// Create a constant inline
inline buffers::parser::Node Const(buffers::parser::Location loc, buffers::parser::AConstType type) {
    switch (type) {
        case buffers::parser::AConstType::NULL_:
            return buffers::parser::Node(loc, buffers::parser::NodeType::LITERAL_NULL, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
        case buffers::parser::AConstType::INTEGER:
            return buffers::parser::Node(loc, buffers::parser::NodeType::LITERAL_INTEGER, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
        case buffers::parser::AConstType::FLOAT:
            return buffers::parser::Node(loc, buffers::parser::NodeType::LITERAL_FLOAT, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
        case buffers::parser::AConstType::STRING:
            return buffers::parser::Node(loc, buffers::parser::NodeType::LITERAL_STRING, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
        case buffers::parser::AConstType::INTERVAL:
            return buffers::parser::Node(loc, buffers::parser::NodeType::LITERAL_INTERVAL, buffers::parser::AttributeKey::NONE, NO_PARENT, 0, 0);
    }
    return Null();
}

/// Create indirection
inline buffers::parser::Node IndirectionIndex(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node index) {
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_INDEX,
                         {
                             Attr(Key::SQL_INDIRECTION_INDEX_VALUE, index),
                         });
}

/// Create indirection
inline buffers::parser::Node IndirectionIndex(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node lower_bound,
                                    buffers::parser::Node upper_bound) {
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_INDIRECTION_INDEX,
                         {
                             Attr(Key::SQL_INDIRECTION_INDEX_LOWER_BOUND, lower_bound),
                             Attr(Key::SQL_INDIRECTION_INDEX_UPPER_BOUND, upper_bound),
                         });
}

/// Create a temp table name
inline buffers::parser::Node Into(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node type, buffers::parser::Node name) {
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_INTO,
                         {
                             Attr(Key::SQL_TEMP_TYPE, type),
                             Attr(Key::SQL_TEMP_NAME, name),
                         });
}

/// Create a column ref
inline buffers::parser::Node ColumnRef(ParseContext& driver, buffers::parser::Location loc, WeakUniquePtr<NodeList>&& path) {
    auto path_nodes = driver.Array(loc, std::move(path));
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_COLUMN_REF,
                         {
                             Attr(Key::SQL_COLUMN_REF_PATH, path_nodes),
                         });
}

/// Add an expression without arguments
inline buffers::parser::Node Expr(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node func) {
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION, {Attr(Key::SQL_EXPRESSION_OPERATOR, func)});
}

/// Add an unary expression
inline buffers::parser::Node Expr(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node func, ExpressionVariant arg) {
    std::array<ExpressionVariant, 1> args{std::move(arg)};
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, func),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}

enum PostFixTag { PostFix };
/// Add an unary expression
inline ExpressionVariant Expr(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node func, ExpressionVariant arg,
                              PostFixTag) {
    std::array<ExpressionVariant, 1> args{std::move(arg)};
    if (auto expr = driver.TryMerge(loc, func, args); expr.has_value()) {
        return std::move(expr.value());
    }
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, func),
                             Attr(Key::SQL_EXPRESSION_POSTFIX, Bool(loc, true)),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}

/// Add a binary expression
inline ExpressionVariant Expr(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node func, ExpressionVariant left,
                              ExpressionVariant right) {
    std::array<ExpressionVariant, 2> args{std::move(left), std::move(right)};
    if (auto expr = driver.TryMerge(loc, func, args); expr.has_value()) {
        return std::move(expr.value());
    }
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, func),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}

/// Add a ternary expression
inline ExpressionVariant Expr(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Node func, ExpressionVariant arg0,
                              ExpressionVariant arg1, ExpressionVariant arg2) {
    std::array<ExpressionVariant, 3> args{std::move(arg0), std::move(arg1), std::move(arg2)};
    if (auto expr = driver.TryMerge(loc, func, args); expr.has_value()) {
        return std::move(expr.value());
    }
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, func),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}

/// Negate an expression
inline ExpressionVariant Negate(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Location loc_minus,
                                ExpressionVariant value) {
    // XXX If node_type == OBJECT_SQL_CONST inspect the attributes and expand the value

    // Otherwise fall back to an unary negation
    std::array<ExpressionVariant, 1> args{std::move(value)};
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, Enum(loc_minus, buffers::parser::ExpressionOperator::NEGATE)),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}
/// Negate a value
inline buffers::parser::Node Negate(ParseContext& driver, buffers::parser::Location loc, buffers::parser::Location loc_minus, buffers::parser::Node value) {
    // XXX If node_type == OBJECT_SQL_CONST inspect the attributes and expand the value

    // Otherwise fall back to an unary negation
    std::array<ExpressionVariant, 1> args{std::move(value)};
    return driver.Object(loc, buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                         {
                             Attr(Key::SQL_EXPRESSION_OPERATOR, Enum(loc_minus, buffers::parser::ExpressionOperator::NEGATE)),
                             Attr(Key::SQL_EXPRESSION_ARGS, driver.Array(loc, args)),
                         });
}

/// Merge join types
inline buffers::parser::JoinType Merge(buffers::parser::JoinType left, buffers::parser::JoinType right) {
    uint8_t result = 0;
    result |= static_cast<uint8_t>(left);
    result |= static_cast<uint8_t>(right);
    return static_cast<buffers::parser::JoinType>(result);
}

/// Add a vararg field
inline buffers::parser::Node VarArgField(ParseContext& driver, buffers::parser::Location loc, WeakUniquePtr<NodeList>&& path,
                               buffers::parser::Node value) {
    auto root = value;
    for (auto iter = path->back(); iter; iter = iter->prev) {
        root = driver.Object(loc, buffers::parser::NodeType::OBJECT_EXT_VARARG_FIELD,
                             {
                                 Attr(buffers::parser::AttributeKey::EXT_VARARG_FIELD_KEY, iter->node),
                                 Attr(buffers::parser::AttributeKey::EXT_VARARG_FIELD_VALUE, value),
                             });
    }
    path.Destroy();
    return root;
}

namespace vis {

/// Map a lowercased identifier text to a VisGeom. Returns {value, true} on hit, {{}, false} on miss.
inline std::pair<buffers::parser::VisGeom, bool> LookupGeom(std::string_view lower) {
    using G = buffers::parser::VisGeom;
    // ggsql accepts `col` as an alias for `bar`
    if (lower == "point") return {G::POINT, true};
    if (lower == "line") return {G::LINE, true};
    if (lower == "path") return {G::PATH, true};
    if (lower == "bar") return {G::BAR, true};
    if (lower == "col") return {G::BAR, true};
    if (lower == "area") return {G::AREA, true};
    if (lower == "tile") return {G::TILE, true};
    if (lower == "polygon") return {G::POLYGON, true};
    if (lower == "ribbon") return {G::RIBBON, true};
    if (lower == "histogram") return {G::HISTOGRAM, true};
    if (lower == "density") return {G::DENSITY, true};
    if (lower == "smooth") return {G::SMOOTH, true};
    if (lower == "boxplot") return {G::BOXPLOT, true};
    if (lower == "violin") return {G::VIOLIN, true};
    if (lower == "text") return {G::TEXT, true};
    if (lower == "label") return {G::LABEL_GEOM, true};
    if (lower == "segment") return {G::SEGMENT, true};
    if (lower == "arrow") return {G::ARROW, true};
    if (lower == "rule") return {G::RULE, true};
    if (lower == "errorbar") return {G::ERRORBAR, true};
    return {{}, false};
}

/// Resolve a bare identifier (e.g. "point", "line") to a VisGeom enum node.
/// Unknown identifiers yield Null() and a parse diagnostic.
inline buffers::parser::Node GeomEnum(ParseContext& driver, buffers::parser::Location loc) {
    auto text = driver.GetProgram().ReadTextAtLocation(loc);
    std::string lowered;
    lowered.reserve(text.size());
    for (char c : text) {
        lowered.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    auto [value, ok] = LookupGeom(lowered);
    if (!ok) {
        driver.AddError(loc, "unknown visualise geom");
        return Null();
    }
    return Enum(loc, value);
}

/// Map a lowercased identifier text to a VisProjectType. Returns {value, true} on hit, {{}, false} on miss.
inline std::pair<buffers::parser::VisProjectType, bool> LookupProjectType(std::string_view lower) {
    using P = buffers::parser::VisProjectType;
    if (lower == "cartesian") return {P::CARTESIAN, true};
    if (lower == "polar") return {P::POLAR, true};
    if (lower == "flip") return {P::FLIP, true};
    if (lower == "fixed_aspect") return {P::FIXED_ASPECT, true};
    if (lower == "trans") return {P::TRANS, true};
    if (lower == "map") return {P::MAP_, true};
    if (lower == "quickmap") return {P::QUICKMAP, true};
    return {{}, false};
}

/// Resolve a bare identifier to a VisProjectType enum node.
/// Unknown identifiers yield Null() and a parse diagnostic.
inline buffers::parser::Node ProjectTypeEnum(ParseContext& driver, buffers::parser::Location loc) {
    auto text = driver.GetProgram().ReadTextAtLocation(loc);
    std::string lowered;
    lowered.reserve(text.size());
    for (char c : text) {
        lowered.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    auto [value, ok] = LookupProjectType(lowered);
    if (!ok) {
        driver.AddError(loc, "unknown visualise project type");
        return Null();
    }
    return Enum(loc, value);
}

}  // namespace vis

}  // namespace parser
}  // namespace dashql
