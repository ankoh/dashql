// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_

#include "dashql/parser/parser_driver.h"
#include <charconv>

namespace dashql {
namespace parser {

using ExprFunc = sxs::ExpressionFunction;

inline sx::Node Enum(sx::Location loc, sxd::HTTPVerb e) {
    return sx::Node(loc, sx::NodeType::ENUM_DASHQL_HTTP_VERB, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxd::LoadMethodType e) {
    return sx::Node(loc, sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxd::ParameterType e) {
    return sx::Node(loc, sx::NodeType::ENUM_DASHQL_PARAMETER_TYPE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxd::VizType e) {
    return sx::Node(loc, sx::NodeType::ENUM_DASHQL_VIZ_TYPE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::CombineModifier e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_COMBINE_MODIFIER, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::CombineOperation e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_COMBINE_OPERATION, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::AConstType e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_ACONST_TYPE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::TempType e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_TEMP_TYPE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::WindowBoundMode e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::WindowBoundDirection e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::WindowRangeMode e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::WindowExclusionMode e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::OrderDirection e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_ORDER_DIRECTION, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::OrderNullRule e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_ORDER_NULL_RULE, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::NumericTypeTag e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_NUMERIC_TYPE_TAG, Key::NONE, static_cast<uint32_t>(e), 0);
}

inline sx::Node Enum(sx::Location loc, sxs::ExpressionFunction e) {
    return sx::Node(loc, sx::NodeType::ENUM_SQL_EXPRESSION_FUNCTION, Key::NONE, static_cast<uint32_t>(e), 0);
}

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
