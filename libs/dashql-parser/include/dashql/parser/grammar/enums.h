// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_

#include <charconv>

#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

constexpr uint32_t NO_PARENT = std::numeric_limits<uint32_t>::max();

using ExprFunc = sx::ExpressionOperator;

#define X(ENUM_TYPE, NODE_TYPE)                                                     \
    inline sx::Node Enum(sx::Location loc, ENUM_TYPE e) {                           \
        return sx::Node(loc, NODE_TYPE, 0, NO_PARENT, static_cast<uint32_t>(e), 0); \
    }
X(sx::AConstType, sx::NodeType::ENUM_SQL_CONST_TYPE)
X(sx::CharacterType, sx::NodeType::ENUM_SQL_CHARACTER_TYPE)
X(sx::ColumnConstraint, sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT)
X(sx::CombineModifier, sx::NodeType::ENUM_SQL_COMBINE_MODIFIER)
X(sx::CombineOperation, sx::NodeType::ENUM_SQL_COMBINE_OPERATION)
X(sx::ConstraintAttribute, sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE)
X(sx::ExpressionOperator, sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR)
X(sx::ExtractTarget, sx::NodeType::ENUM_SQL_EXTRACT_TARGET)
X(sx::FetchMethodType, sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE)
X(sx::GroupByItemType, sx::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE)
X(sx::InputComponentType, sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE)
X(sx::IntervalType, sx::NodeType::ENUM_SQL_INTERVAL_TYPE)
X(sx::JoinType, sx::NodeType::ENUM_SQL_JOIN_TYPE)
X(sx::KeyActionCommand, sx::NodeType::ENUM_SQL_KEY_ACTION_COMMAND)
X(sx::KeyActionTrigger, sx::NodeType::ENUM_SQL_KEY_ACTION_TRIGGER)
X(sx::KeyMatch, sx::NodeType::ENUM_SQL_KEY_MATCH)
X(sx::KnownFunction, sx::NodeType::ENUM_SQL_KNOWN_FUNCTION)
X(sx::LoadMethodType, sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE)
X(sx::NumericType, sx::NodeType::ENUM_SQL_NUMERIC_TYPE)
X(sx::OnCommitOption, sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION)
X(sx::OrderDirection, sx::NodeType::ENUM_SQL_ORDER_DIRECTION)
X(sx::OrderNullRule, sx::NodeType::ENUM_SQL_ORDER_NULL_RULE)
X(sx::RowLockingBlockBehavior, sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR)
X(sx::RowLockingStrength, sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH)
X(sx::SampleCountUnit, sx::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE)
X(sx::SubqueryQuantifier, sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER)
X(sx::TableConstraint, sx::NodeType::ENUM_SQL_TABLE_CONSTRAINT)
X(sx::TempType, sx::NodeType::ENUM_SQL_TEMP_TYPE)
X(sx::TrimDirection, sx::NodeType::ENUM_SQL_TRIM_TARGET)
X(sx::VizComponentType, sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE)
X(sx::WindowBoundDirection, sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION)
X(sx::WindowBoundMode, sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE)
X(sx::WindowExclusionMode, sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE)
X(sx::WindowRangeMode, sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE)
#undef X

const char* getEnumText(const sx::Node& target);

}  // namespace parser
}  // namespace dashql

#endif  // INCLUDE_DASHQL_PARSER_GRAMMAR_ENUMS_H_
