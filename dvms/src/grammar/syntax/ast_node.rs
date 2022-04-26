use super::dashql_nodes::*;
use super::dson::*;
use super::enums_serde::*;
use super::sql_nodes::*;
use dashql_proto::syntax as sx;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ASTNode<'text> {
    Null,

    Boolean(bool),
    UInt32(u32),
    UInt32Bitmap(u32),
    StringRef(&'text str),
    Array(Vec<ASTNode<'text>>),

    #[serde(with = "serde_fetch_method_type")]
    FetchMethodType(sx::FetchMethodType),
    #[serde(with = "serde_input_component_type")]
    InputComponentType(sx::InputComponentType),
    #[serde(with = "serde_load_method_type")]
    LoadMethodType(sx::LoadMethodType),
    #[serde(with = "serde_viz_component_type")]
    VizComponentType(sx::VizComponentType),

    #[serde(with = "serde_character_type")]
    CharacterType(sx::CharacterType),
    #[serde(with = "serde_column_constraint")]
    ColumnConstraint(sx::ColumnConstraint),
    #[serde(with = "serde_combine_modifier")]
    CombineModifier(sx::CombineModifier),
    #[serde(with = "serde_combine_operation")]
    CombineOperation(sx::CombineOperation),
    #[serde(with = "serde_constraint_attribute")]
    ConstraintAttribute(sx::ConstraintAttribute),
    #[serde(with = "serde_const_type")]
    ConstType(sx::AConstType),
    #[serde(with = "serde_expression_operator")]
    ExpressionOperator(sx::ExpressionOperator),
    #[serde(with = "serde_extract_target")]
    ExtractTarget(sx::ExtractTarget),
    #[serde(with = "serde_interval_type")]
    IntervalType(sx::IntervalType),
    #[serde(with = "serde_join_type")]
    JoinType(sx::JoinType),
    #[serde(with = "serde_known_function")]
    KnownFunction(sx::KnownFunction),
    #[serde(with = "serde_numeric_type")]
    NumericType(sx::NumericType),
    #[serde(with = "serde_on_commit_option")]
    OnCommitOption(sx::OnCommitOption),
    #[serde(with = "serde_order_direction")]
    OrderDirection(sx::OrderDirection),
    #[serde(with = "serde_order_null_rule")]
    OrderNullRule(sx::OrderNullRule),
    #[serde(with = "serde_row_locking_block_behaviour")]
    RowLockingBlockBehavior(sx::RowLockingBlockBehavior),
    #[serde(with = "serde_row_locking_strength")]
    RowLockingStrength(sx::RowLockingStrength),
    #[serde(with = "serde_sample_unit_count")]
    SampleCountUnit(sx::SampleCountUnit),
    #[serde(with = "serde_subquery_quantifier")]
    SubqueryQuantifier(sx::SubqueryQuantifier),
    #[serde(with = "serde_temp_type")]
    TempType(sx::TempType),
    #[serde(with = "serde_trim_direction")]
    TrimDirection(sx::TrimDirection),
    #[serde(with = "serde_window_bound_direction")]
    WindowBoundDirection(sx::WindowBoundDirection),
    #[serde(with = "serde_window_bound_mode")]
    WindowBoundMode(sx::WindowBoundMode),
    #[serde(with = "serde_window_exclusion_mode")]
    WindowExclusionMode(sx::WindowExclusionMode),
    #[serde(with = "serde_window_range_mode")]
    WindowRangeMode(sx::WindowRangeMode),

    GenericTypeInfo(GenericType<'text>),
    NumericTypeInfo(NumericType<'text>),
    BitTypeInfo(BitType<'text>),
    CharacterTypeInfo(CharacterType<'text>),
    TimestampTypeInfo(TimestampType<'text>),
    TimeTypeInfo(TimeType<'text>),
    IntervalTypeInfo(IntervalType<'text>),

    Sample(Sample<'text>),
    Alias(Alias<'text>),
    Into(Into<'text>),

    RowsFromItem(RowsFromItem<'text>),
    FunctionTable(FunctionTable<'text>),
    FunctionTableRef(FunctionTableRef<'text>),
    JoinedTable(JoinedTable<'text>),
    JoinedTableRef(JoinedTableRef<'text>),
    TableRef(TableRef<'text>),

    OrderSpecification(OrderSpecification<'text>),
    Expression(Expression<'text>),
    Indirection(Indirection<'text>),
    IntervalSpecification(IntervalSpecification<'text>),
    ResultTarget(ResultTarget<'text>),
    TableSample(TableSample<'text>),
    ColumnRef(NamePath<'text>),
    FunctionArgument(FunctionArgument<'text>),
    FunctionExpression(FunctionExpression<'text>),
    SQLType(SQLType<'text>),

    SelectStatement(SelectStatement<'text>),
    FetchStatement(FetchStatement<'text>),
    InputStatement(InputStatement<'text>),
    LoadStatement(LoadStatement<'text>),
    VizComponent(VizComponent<'text>),
    VizStatement(VizStatement<'text>),

    Dson(DsonValue<'text>),
}
