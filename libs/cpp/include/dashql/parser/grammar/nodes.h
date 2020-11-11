// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_

#include "dashql/parser/grammar/enums.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include <charconv>

namespace dashql {
namespace parser {

/// Create a null node
inline sx::Node Null() { return sx::Node(sx::Location(), sx::NodeType::NONE, Key::NONE, 0, 0); }

/// Create a constant inline
inline sx::Node Const(ParserDriver& driver, sx::Location loc, sxs::AConstType type) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_ACONST, {
        Key::SQL_ACONST_TYPE << Enum(loc, type),
    });
}

/// Create indirection
inline sx::Node Indirection(ParserDriver& driver, sx::Location loc, sx::Node index) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION, {
        Key::SQL_INDIRECTION_INDEX << index,
    });
}

/// Create indirection
inline sx::Node Indirection(ParserDriver& driver, sx::Location loc, sx::Node lower_bound, sx::Node upper_bound) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INDIRECTION, {
        Key::SQL_INDIRECTION_LOWER_BOUND << lower_bound,
        Key::SQL_INDIRECTION_UPPER_BOUND << upper_bound,
    });
}

/// Create relation expression
inline sx::Node Alias(ParserDriver& driver, sx::Location loc, sx::Node name, sx::Node columns) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_ALIAS, {
        Key::SQL_ALIAS_NAME << name,
        Key::SQL_ALIAS_COLUMNS << columns,
    });
}

/// Create a temp table name
inline sx::Node Into(ParserDriver& driver, sx::Location loc, sx::Node type, sx::Node name) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_INTO, {
        Key::SQL_TEMP_TYPE << type,
        Key::SQL_TEMP_NAME << name,
    });
}

/// Create a column ref
inline sx::Node ColumnRef(ParserDriver& driver, sx::Location loc, NodeVector&& path) {
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_COLUMN_REF, {
        Key::SQL_COLUMN_REF_PATH << driver.Add(loc, move(path)),
    });
}

/// Add an unary expression
inline sx::Node UnaryExpr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node arg, std::optional<sx::Location> inverted_loc = std::nullopt) {
    auto inverted = inverted_loc ? sx::Node(*inverted_loc, sx::NodeType::BOOL, Key::NONE, 1, 0) : Null();
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION, {
        Key::SQL_EXPRESSION_FUNCTION << func,
        Key::SQL_EXPRESSION_INVERTED << inverted,
        Key::SQL_EXPRESSION_ARG0 << arg,
    });
}

/// Add an binary expression
inline sx::Node BinaryExpr(ParserDriver& driver, sx::Location loc, sx::Node func, sx::Node left, sx::Node right, std::optional<sx::Location> inverted_loc = std::nullopt) {
    auto inverted = inverted_loc ? sx::Node(*inverted_loc, sx::NodeType::BOOL, Key::NONE, 1, 0) : Null();
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION, {
        Key::SQL_EXPRESSION_FUNCTION << func,
        Key::SQL_EXPRESSION_INVERTED << inverted,
        Key::SQL_EXPRESSION_ARG0 << left,
        Key::SQL_EXPRESSION_ARG1 << right,
    });
}

/// Negate a value
inline sx::Node Negate(ParserDriver& driver, sx::Location loc, sx::Location loc_minus, sx::Node value) {
    // XXX If node_type == OBJECT_SQL_ACONST inspect the attributes and expand the value

    // Otherwise fall back to an unary negation
    return driver.Add(loc, sx::NodeType::OBJECT_SQL_EXPRESSION, {
        Key::SQL_EXPRESSION_FUNCTION << Enum(loc_minus, sxs::ExpressionFunction::NEGATE),
        Key::SQL_EXPRESSION_ARG0 << value,
    });
}

/// Collect viz attributes
inline NodeVector CollectViz(ParserDriver& driver, sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<NodeVector>> attrs) {
    auto type_val = Enum(viz_loc, viz_type);
    auto type_attr = Key::DASHQL_VIZ_TYPE << type_val;
    NodeVector result{type_attr};
    for (auto& as: attrs) {
        for (auto& a: as.get()) {
            result.push_back(a);
        }
    }
    return result;
}

/// Read a float type
inline sxs::NumericTypeTag ReadFloatType(ParserDriver& driver, sx::Location bitsLoc) {
    auto text = driver.scanner().TextAt(bitsLoc);
    int64_t bits;
    std::from_chars(text.data(), text.data() + text.size(), bits);
    if (bits < 1) {
        driver.AddError(bitsLoc, "precision for float type must be least 1 bit");
    } else if (bits < 24) {
        return sxs::NumericTypeTag::FLOAT4;
    } else if (bits < 53) {
        return sxs::NumericTypeTag::FLOAT8;
    } else {
        driver.AddError(bitsLoc, "precision for float type must be less than 54 bits");
    }
    return sxs::NumericTypeTag::FLOAT4;
}

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_GRAMMAR_NODES_H_
