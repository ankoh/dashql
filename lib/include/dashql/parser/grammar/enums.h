// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_

#include <charconv>

#include "dashql/parser/parser_driver.h"

namespace dashql {
namespace parser {

constexpr uint32_t NO_PARENT = std::numeric_limits<uint32_t>::max();

using ExprFunc = sx::ExpressionFunction;

#define X(ENUM_TYPE, NODE_TYPE)                                                             \
    inline sx::Node Enum(sx::Location loc, ENUM_TYPE e) {                                   \
        return sx::Node(loc, NODE_TYPE, Key::NONE, NO_PARENT, static_cast<uint32_t>(e), 0); \
    }
X(sx::AConstType, sx::NodeType::ENUM_SQL_CONST_TYPE)
X(sx::CombineModifier, sx::NodeType::ENUM_SQL_COMBINE_MODIFIER)
X(sx::CombineOperation, sx::NodeType::ENUM_SQL_COMBINE_OPERATION)
X(sx::ExpressionFunction, sx::NodeType::ENUM_SQL_EXPRESSION_FUNCTION)
X(sx::ExtractMethodType, sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE)
X(sx::LoadMethodType, sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE)
X(sx::NumericTypeTag, sx::NodeType::ENUM_SQL_NUMERIC_TYPE_TAG)
X(sx::OnCommitOption, sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION)
X(sx::OrderDirection, sx::NodeType::ENUM_SQL_ORDER_DIRECTION)
X(sx::OrderNullRule, sx::NodeType::ENUM_SQL_ORDER_NULL_RULE)
X(sx::ParameterType, sx::NodeType::ENUM_DASHQL_PARAMETER_TYPE)
X(sx::TempType, sx::NodeType::ENUM_SQL_TEMP_TYPE)
X(sx::VizType, sx::NodeType::ENUM_DASHQL_VIZ_TYPE)
X(sx::WindowBoundDirection, sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION)
X(sx::WindowBoundMode, sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE)
X(sx::WindowExclusionMode, sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE)
X(sx::WindowRangeMode, sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE)
#undef X

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
