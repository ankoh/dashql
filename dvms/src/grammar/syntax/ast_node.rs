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

    GenericTypeInfo(GenericType<'text, 'arena>),
    NumericTypeInfo(NumericType<'text, 'arena>),
    BitTypeInfo(BitType<'text, 'arena>),
    CharacterTypeInfo(CharacterType<'text>),
    TimestampTypeInfo(TimestampType<'text>),
    TimeTypeInfo(TimeType<'text>),
    IntervalTypeInfo(IntervalType<'text>),

    Sample(Sample<'text>),
    Alias(Alias<'text, 'arena>),
    Into(Into<'text, 'arena>),

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

    RowLocking(RowLocking<'text, 'arena>),
    OrderSpecification(OrderSpecification<'text, 'arena>),
    GroupByItem(GroupByItem<'text, 'arena>),
    Expression(Expression<'text, 'arena>),
    Indirection(Indirection<'text, 'arena>),
    IntervalSpecification(IntervalSpecification<'text>),
    ResultTarget(ResultTarget<'text, 'arena>),
    TableSample(TableSample<'text>),
    ColumnRef(NamePath<'text, 'arena>),
    FunctionArgument(FunctionArgument<'text, 'arena>),
    FunctionExpression(FunctionExpression<'text, 'arena>),
    TypecastExpression(TypecastExpression<'text, 'arena>),
    SubqueryExpression(SubqueryExpression<'text, 'arena>),
    SelectStatementExpression(SelectStatementExpression<'text, 'arena>),
    ExistsExpression(ExistsExpression<'text, 'arena>),
    SQLType(SQLType<'text, 'arena>),

    CreateAs(CreateAsStatement<'text, 'arena>),
    CreateView(CreateViewStatement<'text, 'arena>),
    CommonTableExpression(CommonTableExpression<'text, 'arena>),
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
