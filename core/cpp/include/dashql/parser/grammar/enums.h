// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_

#include "dashql/parser/parser_driver.h"
#include <charconv>

namespace dashql {
namespace parser {

constexpr uint32_t NO_PARENT = std::numeric_limits<uint32_t>::max();

using ExprFunc = sxs::ExpressionFunction;

#define X(ENUM_TYPE, NODE_TYPE) inline sx::Node Enum(sx::Location loc, ENUM_TYPE e) { return sx::Node(loc, NODE_TYPE, Key::NONE, NO_PARENT, static_cast<uint32_t>(e), 0); }
    X(sxd::ExtractMethodType, sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE)
    X(sxd::LoadMethodType, sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE)
    X(sxd::ParameterType, sx::NodeType::ENUM_DASHQL_PARAMETER_TYPE)
    X(sxd::VizType, sx::NodeType::ENUM_DASHQL_VIZ_TYPE)
    X(sxs::CombineModifier, sx::NodeType::ENUM_SQL_COMBINE_MODIFIER)
    X(sxs::CombineOperation, sx::NodeType::ENUM_SQL_COMBINE_OPERATION)
    X(sxs::AConstType, sx::NodeType::ENUM_SQL_CONST_TYPE)
    X(sxs::TempType, sx::NodeType::ENUM_SQL_TEMP_TYPE)
    X(sxs::WindowBoundMode, sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE)
    X(sxs::WindowBoundDirection, sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION)
    X(sxs::WindowRangeMode, sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE)
    X(sxs::WindowExclusionMode, sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE)
    X(sxs::OrderDirection, sx::NodeType::ENUM_SQL_ORDER_DIRECTION)
    X(sxs::OrderNullRule, sx::NodeType::ENUM_SQL_ORDER_NULL_RULE)
    X(sxs::NumericTypeTag, sx::NodeType::ENUM_SQL_NUMERIC_TYPE_TAG)
    X(sxs::ExpressionFunction, sx::NodeType::ENUM_SQL_EXPRESSION_FUNCTION)
#undef X

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
