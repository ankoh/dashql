#include "dashql/parser/grammar/enums.h"

#include <algorithm>

#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

const char* getEnumText(const sx::Node& target) {
    auto nt = target.node_type();
    auto v = static_cast<uint32_t>(target.children_begin_or_value());
    switch (nt) {
#define X(ENUM_TYPE, TYPE_TABLE)  \
    case sx::NodeType::ENUM_TYPE: \
        return sx::TYPE_TABLE()->names[v];

        X(ENUM_DASHQL_VIZ_COMPONENT_TYPE, VizComponentTypeTypeTable)
        X(ENUM_DASHQL_INPUT_COMPONENT_TYPE, InputComponentTypeTypeTable)
        X(ENUM_DASHQL_FETCH_METHOD_TYPE, FetchMethodTypeTypeTable)
        X(ENUM_DASHQL_LOAD_METHOD_TYPE, LoadMethodTypeTypeTable)

        X(ENUM_SQL_CHARACTER_TYPE, CharacterTypeTypeTable)
        X(ENUM_SQL_COLUMN_CONSTRAINT, ColumnConstraintTypeTable)
        X(ENUM_SQL_COMBINE_MODIFIER, CombineModifierTypeTable)
        X(ENUM_SQL_COMBINE_OPERATION, CombineOperationTypeTable)
        X(ENUM_SQL_CONSTRAINT_ATTRIBUTE, ConstraintAttributeTypeTable)
        X(ENUM_SQL_CONST_TYPE, AConstTypeTypeTable)
        X(ENUM_SQL_EXPRESSION_OPERATOR, ExpressionOperatorTypeTable)
        X(ENUM_SQL_EXTRACT_TARGET, ExtractTargetTypeTable)
        X(ENUM_SQL_GROUP_BY_ITEM_TYPE, GroupByItemTypeTypeTable)
        X(ENUM_SQL_INTERVAL_TYPE, IntervalTypeTypeTable)
        X(ENUM_SQL_KNOWN_FUNCTION, KnownFunctionTypeTable)
        X(ENUM_SQL_NUMERIC_TYPE, NumericTypeTypeTable)
        X(ENUM_SQL_ON_COMMIT_OPTION, OnCommitOptionTypeTable)
        X(ENUM_SQL_ORDER_DIRECTION, OrderDirectionTypeTable)
        X(ENUM_SQL_ORDER_NULL_RULE, OrderNullRuleTypeTable)
        X(ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR, RowLockingBlockBehaviorTypeTable)
        X(ENUM_SQL_ROW_LOCKING_STRENGTH, RowLockingStrengthTypeTable)
        X(ENUM_SQL_SUBQUERY_QUANTIFIER, SubqueryQuantifierTypeTable)
        X(ENUM_SQL_TEMP_TYPE, TempTypeTypeTable)
        X(ENUM_SQL_TRIM_TARGET, TrimDirectionTypeTable)
        X(ENUM_SQL_WINDOW_BOUND_DIRECTION, WindowBoundDirectionTypeTable)
        X(ENUM_SQL_WINDOW_BOUND_MODE, WindowBoundModeTypeTable)
        X(ENUM_SQL_WINDOW_EXCLUSION_MODE, WindowExclusionModeTypeTable)
        X(ENUM_SQL_WINDOW_RANGE_MODE, WindowRangeModeTypeTable)

#undef X

        case sx::NodeType::ENUM_SQL_JOIN_TYPE: {
            auto tt = sx::JoinTypeTypeTable();
            auto iter =
                std::lower_bound(tt->values, tt->values + tt->num_elems, v, [](auto l, auto r) { return l < r; });
            if (iter >= (tt->values + tt->num_elems) || *iter != v) {
                return "?";
            }
            auto idx = iter - tt->values;
            return sx::JoinTypeTypeTable()->names[idx];
        }

        default:
            return "?";
    }
}

}  // namespace parser
}  // namespace dashql
