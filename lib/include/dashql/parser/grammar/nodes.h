// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_

#include <charconv>
#include <initializer_list>

#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"

namespace dashql {
namespace parser {

/// Helper to configure an attribute node
inline sx::Node Attr(sx::AttributeKey key, sx::Node node) {
    return sx::Node(node.location(), node.node_type(), static_cast<uint16_t>(key), node.parent(),
                    node.children_begin_or_value(), node.children_count());
}
/// Helper to configure an attribute node
inline sx::Node Attr(uint16_t key, sx::Node node) {
    return sx::Node(node.location(), node.node_type(), key, node.parent(), node.children_begin_or_value(),
                    node.children_count());
}
/// Helper to append a node to a node vector
inline NodeVector& Attr(NodeVector& attrs, sx::Node node) {
    attrs.push_back(node);
    return attrs;
}
/// Helper to concatenate node vectors
inline NodeVector Concat(NodeVector&& l, NodeVector&& r) {
    for (auto& node : r) {
        l.push_back(node);
    }
    return l;
}
/// Helper to concatenate node vectors
inline NodeVector Concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2) {
    v0.reserve(v0.size() + v1.size() + v2.size());
    for (auto& n : v1) {
        v0.push_back(n);
    }
    for (auto& n : v2) {
        v0.push_back(n);
    }
    return v0;
}
/// Helper to concatenate node vectors
inline NodeVector Concat(NodeVector&& v0, NodeVector&& v1, NodeVector&& v2, NodeVector&& v3) {
    v0.reserve(v0.size() + v1.size() + v2.size() + v3.size());
    for (auto& n : v1) {
        v0.push_back(n);
    }
    for (auto& n : v2) {
        v0.push_back(n);
    }
    for (auto& n : v3) {
        v0.push_back(n);
    }
    return v0;
}

/// Create a null node
inline sx::Node Null() { return sx::Node(sx::Location(), sx::NodeType::NONE, 0, NO_PARENT, 0, 0); }
/// Create a string node
inline sx::Node String(sx::Location loc) { return sx::Node(loc, sx::NodeType::STRING_REF, 0, NO_PARENT, 0, 0); }
/// Create a ui32 node
inline sx::Node UI32(sx::Location loc, uint32_t value) {
    return sx::Node(loc, sx::NodeType::UI32, 0, NO_PARENT, value, 0);
}
/// Create a ui32 bitmap node
inline sx::Node UI32Bitmap(sx::Location loc, uint32_t value) {
    return sx::Node(loc, sx::NodeType::UI32_BITMAP, 0, NO_PARENT, value, 0);
}
/// Create a bool node
inline sx::Node Bool(sx::Location loc, bool v) {
    return sx::Node(loc, sx::NodeType::BOOL, 0, NO_PARENT, static_cast<uint32_t>(v), 0);
}

/// Create a constant inline
inline sx::Node Const(ParserDriver& driver, sx::Location loc, sx::AConstType /*type*/) {
    return sx::Node(loc, sx::NodeType::STRING_REF, 0, NO_PARENT, 0, 0);
}

/// Create indirection
inline sx::Node IndirectionIndex(ParserDriver& driver, sx::Location loc, sx::Node index) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX,
                      {
                          Key::SQL_INDIRECTION_INDEX_VALUE << index,
                      });
}

/// Create indirection
inline sx::Node IndirectionIndex(ParserDriver& driver, sx::Location loc, sx::Node lower_bound, sx::Node upper_bound) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX,
                      {
                          Key::SQL_INDIRECTION_INDEX_LOWER_BOUND << lower_bound,
                          Key::SQL_INDIRECTION_INDEX_UPPER_BOUND << upper_bound,
                      });
}

/// Create a temp table name
inline sx::Node Into(ParserDriver& driver, sx::Location loc, sx::Node type, sx::Node name) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INTO,
                      {
                          Key::SQL_TEMP_TYPE << type,
                          Key::SQL_TEMP_NAME << name,
                      });
}

/// Create a column ref
inline sx::Node ColumnRef(ParserDriver& driver, sx::Location loc, NodeVector&& path) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_COLUMN_REF,
                      {
                          Key::SQL_COLUMN_REF_PATH << driver.Add(loc, move(path)),
                      });
}

/// Add an expression without arguments
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION, {Key::SQL_EXPRESSION_OPERATOR << func});
}

/// Add an unary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_OPERATOR << func,
                          Key::SQL_EXPRESSION_ARG0 << arg,
                      });
}

enum PostFixTag { PostFix };

/// Add an unary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg, PostFixTag) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_OPERATOR << func,
                          Key::SQL_EXPRESSION_POSTFIX << Bool(loc, true),
                          Key::SQL_EXPRESSION_ARG0 << arg,
                      });
}

/// Add a binary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node left, sx::Node right) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_OPERATOR << func,
                          Key::SQL_EXPRESSION_ARG0 << left,
                          Key::SQL_EXPRESSION_ARG1 << right,
                      });
}

/// Add a ternary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg0, sx::Node arg1,
                     sx::Node arg2) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_OPERATOR << func,
                          Key::SQL_EXPRESSION_ARG0 << arg0,
                          Key::SQL_EXPRESSION_ARG1 << arg1,
                          Key::SQL_EXPRESSION_ARG2 << arg2,
                      });
}

/// Negate a value
inline sx::Node Negate(ParserDriver& driver, sx::Location loc, sx::Location loc_minus, sx::Node value) {
    // XXX If node_type == OBJECT_SQL_CONST inspect the attributes and expand the value

    // Otherwise fall back to an unary negation
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_NARY_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_OPERATOR << Enum(loc_minus, sx::ExpressionOperator::NEGATE),
                          Key::SQL_EXPRESSION_ARG0 << value,
                      });
}

/// Merge join types
inline sx::JoinType Merge(sx::JoinType left, sx::JoinType right) {
    uint8_t result = 0;
    result |= static_cast<uint8_t>(left);
    result |= static_cast<uint8_t>(right);
    return static_cast<sx::JoinType>(result);
}

/// Read a float type
inline sx::NumericType ReadFloatType(ParserDriver& driver, sx::Location bitsLoc) {
    auto text = driver.scanner().TextAt(bitsLoc);
    int64_t bits;
    std::from_chars(text.data(), text.data() + text.size(), bits);
    if (bits < 1) {
        driver.AddError(bitsLoc, "precision for float type must be least 1 bit");
    } else if (bits < 24) {
        return sx::NumericType::FLOAT4;
    } else if (bits < 53) {
        return sx::NumericType::FLOAT8;
    } else {
        driver.AddError(bitsLoc, "precision for float type must be less than 54 bits");
    }
    return sx::NumericType::FLOAT4;
}

/// Create a qualified name
sx::Node QualifiedName(ParserDriver& driver, sx::Location loc, std::vector<sx::Node>&& nodes);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
