use dashql_proto::syntax as sx;

pub fn get_enum_text(target: &sx::Node) -> &'static str {
    let v = target.children_begin_or_value();
    match target.node_type() {
        sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => {
            sx::VizComponentType(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE => {
            sx::InputComponentType(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE => sx::FetchMethodType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => sx::LoadMethodType(v as u8).variant_name().unwrap_or_default(),

        sx::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE => sx::GroupByItemType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_TEMP_TYPE => sx::TempType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_CONST_TYPE => sx::AConstType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_CHARACTER_TYPE => sx::CharacterType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => {
            sx::ExpressionOperator(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_ORDER_DIRECTION => sx::OrderDirection(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_ORDER_NULL_RULE => sx::OrderNullRule(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_COMBINE_MODIFIER => sx::CombineModifier(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_COMBINE_OPERATION => sx::CombineOperation(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_NUMERIC_TYPE => sx::NumericType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => sx::WindowBoundMode(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => sx::WindowRangeMode(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => {
            sx::WindowExclusionMode(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => {
            sx::WindowBoundDirection(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION => sx::OnCommitOption(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => {
            sx::ConstraintAttribute(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => sx::ColumnConstraint(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_INTERVAL_TYPE => sx::IntervalType(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => {
            sx::SubqueryQuantifier(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_KNOWN_FUNCTION => sx::KnownFunction(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_TRIM_TARGET => sx::TrimDirection(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_EXTRACT_TARGET => sx::ExtractTarget(v as u8).variant_name().unwrap_or_default(),
        sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => {
            sx::RowLockingBlockBehavior(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => {
            sx::RowLockingStrength(v as u8).variant_name().unwrap_or_default()
        }
        sx::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => sx::SampleCountUnit(v as u8).variant_name().unwrap_or_default(),

        sx::NodeType::ENUM_SQL_JOIN_TYPE => sx::JoinType(v as u8).variant_name().unwrap_or_default(),

        _ => "?",
    }
}
