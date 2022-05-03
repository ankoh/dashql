use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use dashql_proto::syntax as sx;

#[derive(Clone, Debug)]
pub enum ASTNode<'text, 'arena> {
    Null,

    Boolean(bool),
    UInt32(u32),
    UInt32Bitmap(u32),
    StringRef(&'text str),
    Array(&'arena [&'arena ASTNode<'text, 'arena>]),

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

    GenericTypeSpec(GenericType<'text, 'arena>),
    NumericTypeSpec(NumericType<'text, 'arena>),
    BitTypeSpec(BitType<'text, 'arena>),
    CharacterTypeSpec(CharacterType<'text>),
    TimestampTypeSpec(TimestampType<'text>),
    TimeTypeSpec(TimeType<'text>),

    Sample(Sample<'text>),
    Alias(Alias<'text, 'arena>),
    Into(Into<'text, 'arena>),

    ColumnConstraintArgument(ColumnConstraintArgument<'text, 'arena>),
    ColumnConstraintInfo(ColumnConstraint<'text, 'arena>),
    GenericOption(GenericOption<'text>),
    RowsFromItem(RowsFromItem<'text, 'arena>),
    ColumnDefinition(ColumnDefinition<'text, 'arena>),
    FunctionTable(FunctionTable<'text, 'arena>),
    FunctionTableRef(FunctionTableRef<'text, 'arena>),
    JoinedTable(JoinedTable<'text, 'arena>),
    JoinedTableRef(JoinedTableRef<'text, 'arena>),
    TableRef(TableRef<'text, 'arena>),

    TrimFunctionArguments(TrimFunctionArguments<'text, 'arena>),
    OverlayFunctionArguments(OverlayFunctionArguments<'text, 'arena>),
    SubstringFunctionArguments(SubstringFunctionArguments<'text, 'arena>),
    PositionFunctionArguments(PositionFunctionArguments<'text, 'arena>),
    ExtractFunctionArguments(ExtractFunctionArguments<'text, 'arena>),
    CastFunctionArguments(CastFunctionArguments<'text, 'arena>),
    TreatFunctionArguments(TreatFunctionArguments<'text, 'arena>),

    CaseExpression(CaseExpression<'text, 'arena>),
    CaseExpressionClause(CaseExpressionClause<'text, 'arena>),
    CommonTableExpression(CommonTableExpression<'text, 'arena>),
    ExistsExpression(ExistsExpression<'text, 'arena>),
    Expression(Expression<'text, 'arena>),
    FunctionArgument(FunctionArgument<'text, 'arena>),
    FunctionExpression(FunctionExpression<'text, 'arena>),
    GroupByItem(GroupByItem<'text, 'arena>),
    Indirection(Indirection<'text, 'arena>),
    IndirectionExpression(IndirectionExpression<'text, 'arena>),
    IntervalSpecification(IntervalSpecification<'text>),
    OrderSpecification(OrderSpecification<'text, 'arena>),
    ParameterRef(ParameterRef<'text, 'arena>),
    ResultTarget(ResultTarget<'text, 'arena>),
    RowLocking(RowLocking<'text, 'arena>),
    SelectStatementExpression(SelectStatementExpression<'text, 'arena>),
    SubqueryExpression(SubqueryExpression<'text, 'arena>),
    TableSample(TableSample<'text>),
    TypecastExpression(TypecastExpression<'text, 'arena>),
    SQLType(SQLType<'text, 'arena>),

    WindowFrameBound(WindowFrameBound<'text, 'arena>),
    WindowFrame(WindowFrame<'text, 'arena>),
    WindowDefinition(WindowDefinition<'text, 'arena>),

    Create(CreateStatement<'text, 'arena>),
    CreateAs(CreateAsStatement<'text, 'arena>),
    CreateView(CreateViewStatement<'text, 'arena>),
    SelectStatement(SelectStatement<'text, 'arena>),
    SetStatement(SetStatement<'text, 'arena>),
    FetchStatement(FetchStatement<'text, 'arena>),
    InputStatement(InputStatement<'text, 'arena>),
    LoadStatement(LoadStatement<'text, 'arena>),
    VizComponent(VizComponent<'text, 'arena>),
    VizStatement(VizStatement<'text, 'arena>),

    Dson(DsonValue<'text, 'arena>),
}

impl<'text, 'arena> Default for ASTNode<'text, 'arena> {
    fn default() -> Self {
        ASTNode::Null
    }
}
