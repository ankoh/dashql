use super::sql_nodes::*;
use crate::proto::syntax as sx;

type NodeId = usize;

#[derive(Clone)]
pub enum Node<'text> {
    Null,

    Boolean(bool),
    UInt32(u32),
    UInt32Bitmap(u32),
    StringRef(&'text str),
    Array(Vec<Node<'text>>),

    FetchMethodType(sx::FetchMethodType),
    InputComponentType(sx::InputComponentType),
    LoadMethodType(sx::LoadMethodType),
    VizComponentType(sx::VizComponentType),

    CharacterType(sx::CharacterType),
    ColumnConstraint(sx::ColumnConstraint),
    CombineModifier(sx::CombineModifier),
    CombineOperation(sx::CombineOperation),
    ConstraintAttribute(sx::ConstraintAttribute),
    ConstType(sx::AConstType),
    ExpressionOperator(sx::ExpressionOperator),
    ExtractTarget(sx::ExtractTarget),
    IntervalType(sx::IntervalType),
    JoinType(sx::JoinType),
    KnownFunction(sx::KnownFunction),
    NumericType(sx::NumericType),
    OnCommitOption(sx::OnCommitOption),
    OrderDirection(sx::OrderDirection),
    OrderNullRule(sx::OrderNullRule),
    RowLockingBlockBehavior(sx::RowLockingBlockBehavior),
    RowLockingStrength(sx::RowLockingStrength),
    SubqueryQuantifier(sx::SubqueryQuantifier),
    TempType(sx::TempType),
    TrimDirection(sx::TrimDirection),
    WindowBoundDirection(sx::WindowBoundDirection),
    WindowBoundMode(sx::WindowBoundMode),
    WindowExclusionMode(sx::WindowExclusionMode),
    WindowRangeMode(sx::WindowRangeMode),

    OrderSpecification(OrderSpecification<'text>),
    Expression(Expression<'text>),
    IndirectionIndex(IndirectionIndex<'text>),
    IndirectionBounds(IndirectionBounds<'text>),
    IntervalSpecification(IntervalSpecification<'text>),
}
