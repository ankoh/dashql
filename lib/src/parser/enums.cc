#include "dashql/parser/grammar/enums.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

const char* getEnumText(const sx::Node& target) {
    auto nt = target.node_type();
    auto v = static_cast<uint32_t>(target.children_begin_or_value());
    switch (nt) {
        case sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE:
            return sx::VizComponentTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_PARAMETER_TYPE:
            return sx::ParameterTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE:
            return sx::LoadMethodTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_DASHQL_EXTRACT_METHOD_TYPE:
            return sx::ExtractMethodTypeTypeTable()->names[v];

        case sx::NodeType::ENUM_SQL_TEMP_TYPE:
            return sx::TempTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_CONST_TYPE:
            return sx::AConstTypeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_EXPRESSION_FUNCTION:
            return sx::ExpressionFunctionTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_ORDER_DIRECTION:
            return sx::OrderDirectionTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_ORDER_NULL_RULE:
            return sx::OrderNullRuleTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_COMBINE_MODIFIER:
            return sx::CombineModifierTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_COMBINE_OPERATION:
            return sx::CombineOperationTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_NUMERIC_TYPE_TAG:
            return sx::NumericTypeTagTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE:
            return sx::WindowBoundModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE:
            return sx::WindowRangeModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE:
            return sx::WindowExclusionModeTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION:
            return sx::WindowBoundDirectionTypeTable()->names[v];
        case sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION:
            return sx::OnCommitOptionTypeTable()->names[v];

        default:
            return "?";
    }
}

}  // namespace parser
}  // namespace dashql