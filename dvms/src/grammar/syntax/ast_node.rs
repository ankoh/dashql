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

    FetchMethodType(#[serde(with = "serde_fetch_method_type")] sx::FetchMethodType),
    InputComponentType(#[serde(with = "serde_input_component_type")] sx::InputComponentType),
    LoadMethodType(#[serde(with = "serde_load_method_type")] sx::LoadMethodType),
    VizComponentType(#[serde(with = "serde_viz_component_type")] sx::VizComponentType),

    CharacterType(#[serde(with = "serde_character_type")] sx::CharacterType),
    ColumnConstraint(#[serde(with = "serde_column_constraint")] sx::ColumnConstraint),
    CombineModifier(#[serde(with = "serde_combine_modifier")] sx::CombineModifier),
    CombineOperation(#[serde(with = "serde_combine_operation")] sx::CombineOperation),
    ConstraintAttribute(#[serde(with = "serde_constraint_attribute")] sx::ConstraintAttribute),
    ConstType(#[serde(with = "serde_const_type")] sx::AConstType),
    ExpressionOperator(#[serde(with = "serde_expression_operator")] sx::ExpressionOperator),
    ExtractTarget(#[serde(with = "serde_extract_target")] sx::ExtractTarget),
    IntervalType(#[serde(with = "serde_interval_type")] sx::IntervalType),
    JoinType(#[serde(with = "serde_join_type")] sx::JoinType),
    KnownFunction(#[serde(with = "serde_known_function")] sx::KnownFunction),
    NumericType(#[serde(with = "serde_numeric_type")] sx::NumericType),
    OnCommitOption(#[serde(with = "serde_on_commit_option")] sx::OnCommitOption),
    OrderDirection(#[serde(with = "serde_order_direction")] sx::OrderDirection),
    OrderNullRule(#[serde(with = "serde_order_null_rule")] sx::OrderNullRule),
    RowLockingBlockBehavior(
        #[serde(with = "serde_row_locking_block_behaviour")] sx::RowLockingBlockBehavior,
    ),
    RowLockingStrength(#[serde(with = "serde_row_locking_strength")] sx::RowLockingStrength),
    SampleCountUnit(#[serde(with = "serde_sample_unit_count")] sx::SampleCountUnit),
    SubqueryQuantifier(#[serde(with = "serde_subquery_quantifier")] sx::SubqueryQuantifier),
    TempType(#[serde(with = "serde_temp_type")] sx::TempType),
    TrimDirection(#[serde(with = "serde_trim_direction")] sx::TrimDirection),
    WindowBoundDirection(#[serde(with = "serde_window_bound_direction")] sx::WindowBoundDirection),
    WindowBoundMode(#[serde(with = "serde_window_bound_mode")] sx::WindowBoundMode),
    WindowExclusionMode(#[serde(with = "serde_window_exclusion_mode")] sx::WindowExclusionMode),
    WindowRangeMode(#[serde(with = "serde_window_range_mode")] sx::WindowRangeMode),

    OrderSpecification(OrderSpecification<'text>),
    Expression(Expression<'text>),
    IndirectionIndex(IndirectionIndex<'text>),
    IndirectionBounds(IndirectionBounds<'text>),
    IntervalSpecification(IntervalSpecification<'text>),
    ResultTarget(ResultTarget<'text>),
    TableSample(TableSample<'text>),
    GenericType(GenericType<'text>),

    SelectStatement(SelectStatement<'text>),
}
