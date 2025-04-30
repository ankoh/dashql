#pragma once

#include <charconv>

#include "dashql/buffers/index_generated.h"
#include "dashql/parser/parser.h"

namespace dashql {
namespace parser {

constexpr uint32_t NO_PARENT = std::numeric_limits<uint32_t>::max();

using ExprFunc = buffers::parser::ExpressionOperator;

#define X(ENUM_TYPE, NODE_TYPE)                                                                      \
    inline buffers::parser::Node Enum(buffers::parser::Location loc, ENUM_TYPE e) {                  \
        return buffers::parser::Node(loc, NODE_TYPE, buffers::parser::AttributeKey::NONE, NO_PARENT, \
                                     static_cast<uint32_t>(e), 0);                                   \
    }
X(buffers::parser::AConstType, buffers::parser::NodeType::ENUM_SQL_CONST_TYPE)
X(buffers::parser::CharacterType, buffers::parser::NodeType::ENUM_SQL_CHARACTER_TYPE)
X(buffers::parser::ColumnConstraint, buffers::parser::NodeType::ENUM_SQL_COLUMN_CONSTRAINT)
X(buffers::parser::CombineModifier, buffers::parser::NodeType::ENUM_SQL_COMBINE_MODIFIER)
X(buffers::parser::CombineOperation, buffers::parser::NodeType::ENUM_SQL_COMBINE_OPERATION)
X(buffers::parser::ConstraintAttribute, buffers::parser::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE)
X(buffers::parser::ExpressionOperator, buffers::parser::NodeType::ENUM_SQL_EXPRESSION_OPERATOR)
X(buffers::parser::ExtractTarget, buffers::parser::NodeType::ENUM_SQL_EXTRACT_TARGET)
X(buffers::parser::GroupByItemType, buffers::parser::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE)
X(buffers::parser::IntervalType, buffers::parser::NodeType::ENUM_SQL_INTERVAL_TYPE)
X(buffers::parser::JoinType, buffers::parser::NodeType::ENUM_SQL_JOIN_TYPE)
X(buffers::parser::KeyActionCommand, buffers::parser::NodeType::ENUM_SQL_KEY_ACTION_COMMAND)
X(buffers::parser::KeyActionTrigger, buffers::parser::NodeType::ENUM_SQL_KEY_ACTION_TRIGGER)
X(buffers::parser::KeyMatch, buffers::parser::NodeType::ENUM_SQL_KEY_MATCH)
X(buffers::parser::KnownFunction, buffers::parser::NodeType::ENUM_SQL_KNOWN_FUNCTION)
X(buffers::parser::NumericType, buffers::parser::NodeType::ENUM_SQL_NUMERIC_TYPE)
X(buffers::parser::OnCommitOption, buffers::parser::NodeType::ENUM_SQL_ON_COMMIT_OPTION)
X(buffers::parser::OrderDirection, buffers::parser::NodeType::ENUM_SQL_ORDER_DIRECTION)
X(buffers::parser::OrderNullRule, buffers::parser::NodeType::ENUM_SQL_ORDER_NULL_RULE)
X(buffers::parser::RowLockingBlockBehavior, buffers::parser::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR)
X(buffers::parser::RowLockingStrength, buffers::parser::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH)
X(buffers::parser::SampleCountUnit, buffers::parser::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE)
X(buffers::parser::SubqueryQuantifier, buffers::parser::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER)
X(buffers::parser::TableConstraint, buffers::parser::NodeType::ENUM_SQL_TABLE_CONSTRAINT)
X(buffers::parser::TempType, buffers::parser::NodeType::ENUM_SQL_TEMP_TYPE)
X(buffers::parser::TrimDirection, buffers::parser::NodeType::ENUM_SQL_TRIM_TARGET)
X(buffers::parser::WindowBoundDirection, buffers::parser::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION)
X(buffers::parser::WindowBoundMode, buffers::parser::NodeType::ENUM_SQL_WINDOW_BOUND_MODE)
X(buffers::parser::WindowExclusionMode, buffers::parser::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE)
X(buffers::parser::WindowRangeMode, buffers::parser::NodeType::ENUM_SQL_WINDOW_RANGE_MODE)
#undef X

const char* getEnumText(const buffers::parser::Node& target);

}  // namespace parser
}  // namespace dashql
