// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_

#include <charconv>

#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"

namespace dashql {
namespace parser {

/// Create a null node
inline sx::Node Null() { return sx::Node(sx::Location(), sx::NodeType::NONE, Key::NONE, NO_PARENT, 0, 0); }
/// Create a string node
inline sx::Node String(sx::Location loc) { return sx::Node(loc, sx::NodeType::STRING_REF, Key::NONE, NO_PARENT, 0, 0); }
/// Create a ui32 node
inline sx::Node UI32(sx::Location loc, uint32_t value) {
    return sx::Node(loc, sx::NodeType::UI32, Key::NONE, NO_PARENT, value, 0);
}
/// Create a ui32 bitmap node
inline sx::Node UI32Bitmap(sx::Location loc, uint32_t value) {
    return sx::Node(loc, sx::NodeType::UI32_BITMAP, Key::NONE, NO_PARENT, value, 0);
}
/// Create a bool node
inline sx::Node Bool(sx::Location loc, bool v) {
    return sx::Node(loc, sx::NodeType::BOOL, Key::NONE, NO_PARENT, static_cast<uint32_t>(v), 0);
}

/// Create a constant inline
inline sx::Node Const(ParserDriver& driver, sx::Location loc, sx::AConstType type) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_CONST,
                      {
                          Key::SQL_CONST_TYPE << Enum(loc, type),
                          Key::SQL_CONST_VALUE << String(loc),
                      });
}

/// Create indirection
inline sx::Node Indirection(ParserDriver& driver, sx::Location loc, sx::Node index) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION,
                      {
                          Key::SQL_INDIRECTION_INDEX << index,
                      });
}

/// Create indirection
inline sx::Node Indirection(ParserDriver& driver, sx::Location loc, sx::Node lower_bound, sx::Node upper_bound) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION,
                      {
                          Key::SQL_INDIRECTION_LOWER_BOUND << lower_bound,
                          Key::SQL_INDIRECTION_UPPER_BOUND << upper_bound,
                      });
}

/// Create relation expression
inline sx::Node Alias(ParserDriver& driver, sx::Location loc, sx::Node name, sx::Node columns) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_ALIAS,
                      {
                          Key::SQL_ALIAS_NAME << name,
                          Key::SQL_ALIAS_COLUMNS << columns,
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

/// Add an unary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_FUNCTION << func,
                          Key::SQL_EXPRESSION_ARG0 << arg,
                      });
}

/// Add a binary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node left, sx::Node right) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_FUNCTION << func,
                          Key::SQL_EXPRESSION_ARG0 << left,
                          Key::SQL_EXPRESSION_ARG1 << right,
                      });
}

/// Add a ternary expression
inline sx::Node Expr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg0, sx::Node arg1,
                     sx::Node arg2) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_FUNCTION << func,
                          Key::SQL_EXPRESSION_ARG0 << arg0,
                          Key::SQL_EXPRESSION_ARG1 << arg1,
                          Key::SQL_EXPRESSION_ARG2 << arg2,
                      });
}

/// Negate a value
inline sx::Node Negate(ParserDriver& driver, sx::Location loc, sx::Location loc_minus, sx::Node value) {
    // XXX If node_type == OBJECT_SQL_CONST inspect the attributes and expand the value

    // Otherwise fall back to an unary negation
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION,
                      {
                          Key::SQL_EXPRESSION_FUNCTION << Enum(loc_minus, sx::ExpressionFunction::NEGATE),
                          Key::SQL_EXPRESSION_ARG0 << value,
                      });
}

/// Read a float type
inline sx::NumericTypeTag ReadFloatType(ParserDriver& driver, sx::Location bitsLoc) {
    auto text = driver.scanner().TextAt(bitsLoc);
    int64_t bits;
    std::from_chars(text.data(), text.data() + text.size(), bits);
    if (bits < 1) {
        driver.AddError(bitsLoc, "precision for float type must be least 1 bit");
    } else if (bits < 24) {
        return sx::NumericTypeTag::FLOAT4;
    } else if (bits < 53) {
        return sx::NumericTypeTag::FLOAT8;
    } else {
        driver.AddError(bitsLoc, "precision for float type must be less than 54 bits");
    }
    return sx::NumericTypeTag::FLOAT4;
}

/// Map an option.
/// Add an error if the key or the (key, value) combination is invalid.
sx::Node Option(ParserDriver& driver, sx::Location loc, std::vector<sx::Location>&& key_path, sx::Node value);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
