use super::ast_cell::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use dashql_proto::syntax as sx;

#[derive(Clone, Debug, PartialEq, Hash)]
pub enum ASTNode<'a> {
    Null,

    Boolean(bool),
    UInt32(u32),
    UInt32Bitmap(u32),
    StringRef(&'a str),
    Array(&'a [&'a ASTNode<'a>]),

    CharacterType(sx::CharacterType),
    ColumnConstraint(sx::ColumnConstraint),
    CombineModifier(sx::CombineModifier),
    CombineOperation(sx::CombineOperation),
    ConstType(sx::AConstType),
    ConstraintAttribute(sx::ConstraintAttribute),
    ExpressionOperator(sx::ExpressionOperator),
    ExtractTarget(sx::ExtractTarget),
    FetchMethodType(sx::FetchMethodType),
    GroupByItemType(sx::GroupByItemType),
    InputComponentType(sx::InputComponentType),
    IntervalType(sx::IntervalType),
    JoinType(sx::JoinType),
    KnownFunction(sx::KnownFunction),
    LoadMethodType(sx::LoadMethodType),
    NumericType(sx::NumericType),
    OnCommitOption(sx::OnCommitOption),
    OrderDirection(sx::OrderDirection),
    OrderNullRule(sx::OrderNullRule),
    RowLockingBlockBehavior(sx::RowLockingBlockBehavior),
    RowLockingStrength(sx::RowLockingStrength),
    SampleCountUnit(sx::SampleCountUnit),
    SubqueryQuantifier(sx::SubqueryQuantifier),
    TempType(sx::TempType),
    TrimDirection(sx::TrimDirection),
    VizComponentType(sx::VizComponentType),
    WindowBoundDirection(sx::WindowBoundDirection),
    WindowBoundMode(sx::WindowBoundMode),
    WindowExclusionMode(sx::WindowExclusionMode),
    WindowRangeMode(sx::WindowRangeMode),

    GenericTypeSpec(GenericType<'a>),
    NumericTypeSpec(NumericType<'a>),
    BitTypeSpec(BitType<'a>),
    CharacterTypeSpec(CharacterType<'a>),
    TimestampTypeSpec(TimestampType<'a>),
    TimeTypeSpec(TimeType<'a>),

    Sample(Sample<'a>),
    Alias(Alias<'a>),
    Into(Into<'a>),

    ColumnConstraintArgument(ColumnConstraintArgument<'a>),
    ColumnConstraintInfo(ColumnConstraint<'a>),
    GenericOption(GenericOption<'a>),
    RowsFromItem(RowsFromItem<'a>),
    ColumnDefinition(ColumnDefinition<'a>),
    FunctionTable(FunctionTable<'a>),
    JoinedTable(JoinedTable<'a>),
    TableRef(TableRef<'a>),
    ColumnRef(NamePath<'a>),

    TrimFunctionArguments(TrimFunctionArguments<'a>),
    OverlayFunctionArguments(OverlayFunctionArguments<'a>),
    SubstringFunctionArguments(SubstringFunctionArguments<'a>),
    PositionFunctionArguments(PositionFunctionArguments<'a>),
    ExtractFunctionArguments(ExtractFunctionArguments<'a>),
    CastFunctionArguments(CastFunctionArguments<'a>),
    TreatFunctionArguments(TreatFunctionArguments<'a>),

    CaseExpression(CaseExpression<'a>),
    CaseExpressionClause(CaseExpressionClause<'a>),
    CommonTableExpression(CommonTableExpression<'a>),
    ConstCastExpression(ConstCastExpression<'a>),
    ExistsExpression(ExistsExpression<'a>),
    Expression(Expression<'a>),
    FunctionArgument(FunctionArgument<'a>),
    FunctionExpression(FunctionExpression<'a>),
    GroupByItem(GroupByItem<'a>),
    Indirection(Indirection<'a>),
    IndirectionExpression(IndirectionExpression<'a>),
    IntervalSpecification(IntervalSpecification<'a>),
    OrderSpecification(OrderSpecification<'a>),
    ParameterRef(ParameterRef<'a>),
    ResultTarget(ResultTarget<'a>),
    RowLocking(RowLocking<'a>),
    SQLType(SQLType<'a>),
    SelectStatementExpression(SelectStatementExpression<'a>),
    SubqueryExpression(SubqueryExpression<'a>),
    TableSample(TableSample<'a>),
    TypeCastExpression(TypeCastExpression<'a>),
    TypeTestExpression(TypeTestExpression<'a>),
    WindowDefinition(WindowDefinition<'a>),
    WindowFrame(WindowFrame<'a>),
    WindowFrameBound(WindowFrameBound<'a>),

    Create(CreateStatement<'a>),
    CreateAs(CreateAsStatement<'a>),
    CreateView(CreateViewStatement<'a>),
    SelectStatement(SelectStatement<'a>),
    SetStatement(SetStatement<'a>),
    FetchStatement(FetchStatement<'a>),
    InputStatement(InputStatement<'a>),
    LoadStatement(LoadStatement<'a>),
    VizComponent(VizComponent<'a>),
    VizStatement(VizStatement<'a>),

    Dson(DsonValue<'a>),
}

impl<'a> Default for ASTNode<'a> {
    fn default() -> Self {
        ASTNode::Null
    }
}
