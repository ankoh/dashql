use super::sql_nodes::*;
use crate::proto::syntax as sx;

pub enum AttributeKey<'text> {
    Key(sx::AttributeKey),
    Dynamic(&'text str),
}

type NodeId = usize;

#[derive(Clone)]
pub enum Node<'text> {
    Null,

    Boolean(NodeId, bool),
    UInt32(NodeId, u32),
    UInt32Bitmap(NodeId, u32),
    StringRef(NodeId, &'text str),
    Array(NodeId, Vec<Node<'text>>),

    FetchMethodType(NodeId, sx::FetchMethodType),
    InputComponentType(NodeId, sx::InputComponentType),
    LoadMethodType(NodeId, sx::LoadMethodType),
    VizComponentType(NodeId, sx::VizComponentType),

    CharacterType(NodeId, sx::CharacterType),
    ColumnConstraint(NodeId, sx::ColumnConstraint),
    CombineModifier(NodeId, sx::CombineModifier),
    CombineOperation(NodeId, sx::CombineOperation),
    ConstraintAttribute(NodeId, sx::ConstraintAttribute),
    ConstType(NodeId, sx::AConstType),
    ExpressionOperator(NodeId, sx::ExpressionOperator),
    ExtractTarget(NodeId, sx::ExtractTarget),
    IntervalType(NodeId, sx::IntervalType),
    JoinType(NodeId, sx::JoinType),
    KnownFunction(NodeId, sx::KnownFunction),
    NumericType(NodeId, sx::NumericType),
    OnCommitOption(NodeId, sx::OnCommitOption),
    OrderDirection(NodeId, sx::OrderDirection),
    OrderNullRule(NodeId, sx::OrderNullRule),
    RowLockingBlockBehavior(NodeId, sx::RowLockingBlockBehavior),
    RowLockingStrength(NodeId, sx::RowLockingStrength),
    SubqueryQuantifier(NodeId, sx::SubqueryQuantifier),
    TempType(NodeId, sx::TempType),
    TrimDirection(NodeId, sx::TrimDirection),
    WindowBoundDirection(NodeId, sx::WindowBoundDirection),
    WindowBoundMode(NodeId, sx::WindowBoundMode),
    WindowExclusionMode(NodeId, sx::WindowExclusionMode),
    WindowRangeMode(NodeId, sx::WindowRangeMode),

    Expression(NodeId, Expression<'text>),
}
