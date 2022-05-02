use dashql_proto::syntax as sx;

#[derive(Debug, Clone)]
pub struct IndirectionIndex<'text, 'arena> {
    pub value: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct IndirectionBounds<'text, 'arena> {
    pub lower_bound: Expression<'text, 'arena>,
    pub upper_bound: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub enum Indirection<'text, 'arena> {
    Name(&'text str),
    Index(IndirectionIndex<'text, 'arena>),
    Bounds(IndirectionBounds<'text, 'arena>),
}
impl<'text, 'arena> Default for Indirection<'text, 'arena> {
    fn default() -> Self {
        Indirection::Name("")
    }
}
pub type NamePath<'text, 'arena> = &'arena [Indirection<'text, 'arena>];

#[derive(Debug, Clone)]
pub enum ArrayBound<'text> {
    Empty,
    Index(&'text str),
}

impl<'text> Default for ArrayBound<'text> {
    fn default() -> Self {
        ArrayBound::Empty
    }
}

#[derive(Debug, Clone)]
pub enum ExpressionOperatorName<'text, 'arena> {
    Known(sx::ExpressionOperator),
    Qualified(&'arena [&'text str]),
}
impl<'text, 'arena> Default for ExpressionOperatorName<'text, 'arena> {
    fn default() -> Self {
        ExpressionOperatorName::Known(sx::ExpressionOperator::EQUAL)
    }
}

#[derive(Debug, Clone)]
pub struct NaryExpression<'text, 'arena> {
    pub operator: ExpressionOperatorName<'text, 'arena>,
    pub args: &'arena [Expression<'text, 'arena>],
    pub postfix: bool,
}

#[derive(Debug, Clone)]
pub struct ConstCastExpression<'text, 'arena> {
    pub cast_type: &'text str,
    pub func_name: Option<NamePath<'text, 'arena>>,
    pub func_args: &'arena [Expression<'text, 'arena>],
    pub func_arg_ordering: &'arena [&'arena OrderSpecification<'text, 'arena>],
    pub value: &'text str,
    pub interval: Option<&'arena IntervalSpecification<'text>>,
}

#[derive(Debug, Clone)]
pub struct TypecastExpression<'text, 'arena> {
    pub value: Expression<'text, 'arena>,
    pub typename: SQLType<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct SubqueryExpression<'text, 'arena> {
    pub operator: ExpressionOperatorName<'text, 'arena>,
    pub quantifier: sx::SubqueryQuantifier,
    pub args: [Expression<'text, 'arena>; 2],
}

#[derive(Debug, Clone)]
pub struct SelectStatementExpression<'text, 'arena> {
    pub statement: &'arena SelectStatement<'text, 'arena>,
    pub indirection: Option<NamePath<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct ExistsExpression<'text, 'arena> {
    pub statement: &'arena SelectStatement<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct CaseExpressionClause<'text, 'arena> {
    pub when: Expression<'text, 'arena>,
    pub then: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct CaseExpression<'text, 'arena> {
    pub argument: Expression<'text, 'arena>,
    pub cases: &'arena [&'arena CaseExpressionClause<'text, 'arena>],
    pub default: Option<Expression<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct ParameterRef<'text, 'arena> {
    pub prefix: &'text str,
    pub name: NamePath<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub enum Expression<'text, 'arena> {
    Null,
    True,
    False,
    StringRef(&'text str),
    ColumnRef(NamePath<'text, 'arena>),
    Nary(&'arena NaryExpression<'text, 'arena>),
    ConstCast(&'arena ConstCastExpression<'text, 'arena>),
    Typecast(&'arena TypecastExpression<'text, 'arena>),
    FunctionCall(&'arena FunctionExpression<'text, 'arena>),
    SelectStatement(&'arena SelectStatementExpression<'text, 'arena>),
    Subquery(&'arena SubqueryExpression<'text, 'arena>),
    Exists(&'arena ExistsExpression<'text, 'arena>),
    Case(&'arena CaseExpression<'text, 'arena>),
    ParameterRef(&'arena ParameterRef<'text, 'arena>),
}

impl<'text, 'arena> Default for Expression<'text, 'arena> {
    fn default() -> Self {
        Expression::Null
    }
}

#[derive(Debug, Clone)]
pub struct OrderSpecification<'text, 'arena> {
    pub value: Expression<'text, 'arena>,
    pub direction: Option<sx::OrderDirection>,
    pub null_rule: Option<sx::OrderNullRule>,
}

#[derive(Debug, Clone)]
pub enum GroupByItem<'text, 'arena> {
    Empty,
    Expression(Expression<'text, 'arena>),
    Cube(&'arena [Expression<'text, 'arena>]),
    Rollup(&'arena [Expression<'text, 'arena>]),
    GroupingSets(&'arena [&'arena GroupByItem<'text, 'arena>]),
}

#[derive(Debug, Clone)]
pub enum IntervalSpecification<'text> {
    Raw(&'text str),
    Type {
        interval_type: sx::IntervalType,
        precision: Option<&'text str>,
    },
}

#[derive(Debug, Clone)]
pub enum ResultTarget<'text, 'arena> {
    Star,
    Value {
        value: Expression<'text, 'arena>,
        alias: Option<&'text str>,
    },
}

#[derive(Debug, Clone)]
pub struct GenericType<'text, 'arena> {
    pub name: &'text str,
    pub modifiers: &'arena [Expression<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct NumericType<'text, 'arena> {
    pub base: sx::NumericType,
    pub modifiers: &'arena [Expression<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct BitType<'text, 'arena> {
    pub varying: bool,
    pub length: Option<Expression<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct CharacterType<'text> {
    pub base: sx::CharacterType,
    pub length: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub struct TimestampType<'text> {
    pub precision: Option<&'text str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone)]
pub struct TimeType<'text> {
    pub precision: Option<&'text str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone)]
pub struct IntervalType<'text> {
    pub base: Option<sx::IntervalType>,
    pub precision: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub enum SQLBaseType<'text, 'arena> {
    Invalid,
    Generic(GenericType<'text, 'arena>),
    Numeric(NumericType<'text, 'arena>),
    Bit(BitType<'text, 'arena>),
    Character(CharacterType<'text>),
    Time(TimeType<'text>),
    Timestamp(TimestampType<'text>),
    Interval(IntervalType<'text>),
}

#[derive(Debug, Clone)]
pub struct SQLType<'text, 'arena> {
    pub base_type: SQLBaseType<'text, 'arena>,
    pub array_bounds: &'arena [ArrayBound<'text>],
    pub set_of: bool,
}

#[derive(Debug, Clone)]
pub struct Into<'text, 'arena> {
    pub temp: sx::TempType,
    pub name: NamePath<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct ColumnDefinition<'text, 'arena> {
    pub name: &'text str,
    pub sql_type: &'text SQLType<'text, 'arena>,
    pub collate: &'arena [&'text str],
    pub constraints: &'arena [ColumnConstraintVariant<'text, 'arena>],
    pub options: &'arena [&'arena GenericOption<'text>],
}

#[derive(Debug, Clone)]
pub struct Alias<'text, 'arena> {
    pub name: &'text str,
    pub column_names: &'arena [&'text str],
    pub column_definitions: &'arena [&'arena ColumnDefinition<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct TableSample<'text> {
    pub count: &'text str,
    pub unit: sx::SampleCountUnit,
    pub function: Option<&'text str>,
    pub repeat: Option<&'text str>,
    pub seed: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub struct SelectStatementRef<'text, 'arena> {
    pub table: &'arena SelectStatement<'text, 'arena>,
    pub alias: Option<&'arena Alias<'text, 'arena>>,
    pub sample: Option<&'arena TableSample<'text>>,
    pub lateral: bool,
}

#[derive(Debug, Clone)]
pub struct RowsFromItem<'text, 'arena> {
    pub function: &'arena FunctionExpression<'text, 'arena>,
    pub columns: &'arena [&'arena ColumnDefinition<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct FunctionTable<'text, 'arena> {
    pub function: Option<&'arena FunctionExpression<'text, 'arena>>,
    pub rows_from: &'arena [&'arena RowsFromItem<'text, 'arena>],
    pub with_ordinality: bool,
}

#[derive(Debug, Clone)]
pub struct FunctionTableRef<'text, 'arena> {
    pub table: &'arena FunctionTable<'text, 'arena>,
    pub alias: Option<&'arena Alias<'text, 'arena>>,
    pub sample: Option<&'arena TableSample<'text>>,
    pub lateral: bool,
}

#[derive(Debug, Clone)]
pub enum JoinQualifier<'text, 'arena> {
    On(Expression<'text, 'arena>),
    Using(&'arena [&'text str]),
}

#[derive(Debug, Clone)]
pub struct JoinedTable<'text, 'arena> {
    pub join: sx::JoinType,
    pub qualifier: Option<JoinQualifier<'text, 'arena>>,
    pub input: &'arena [&'arena TableRef<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct JoinedTableRef<'text, 'arena> {
    pub table: &'arena JoinedTable<'text, 'arena>,
    pub alias: Option<&'arena Alias<'text, 'arena>>,
}

#[derive(Debug, Clone, Default)]
pub struct RelationRef<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub inherit: bool,
}

#[derive(Debug, Clone)]
pub enum TableRef<'text, 'arena> {
    Relation(RelationRef<'text, 'arena>),
    Select(SelectStatementRef<'text, 'arena>),
    Function(FunctionTableRef<'text, 'arena>),
    Join(JoinedTableRef<'text, 'arena>),
}

#[derive(Debug, Clone, Default)]
pub struct FunctionArgument<'text, 'arena> {
    pub name: Option<&'text str>,
    pub value: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub enum FunctionName<'text> {
    Unknown(&'text str),
    Known(sx::KnownFunction),
}

impl<'text, 'arena> Default for FunctionName<'text> {
    fn default() -> Self {
        FunctionName::Unknown("")
    }
}

#[derive(Debug, Clone)]
pub struct OverlayFunctionArguments<'text, 'arena> {
    pub input: Expression<'text, 'arena>,
    pub placing: Expression<'text, 'arena>,
    pub substr_from: Expression<'text, 'arena>,
    pub substr_for: Option<Expression<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub enum ExtractFunctionTarget<'text> {
    Unknown(&'text str),
    Known(sx::ExtractTarget),
}

#[derive(Debug, Clone)]
pub struct ExtractFunctionArguments<'text, 'arena> {
    pub target: ExtractFunctionTarget<'text>,
    pub input: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct SubstringFunctionArguments<'text, 'arena> {
    pub input: Expression<'text, 'arena>,
    pub substr_from: Option<Expression<'text, 'arena>>,
    pub substr_for: Option<Expression<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct PositionFunctionArguments<'text, 'arena> {
    pub search: Expression<'text, 'arena>,
    pub input: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct TrimFunctionArguments<'text, 'arena> {
    pub direction: sx::TrimDirection,
    pub characters: Option<Expression<'text, 'arena>>,
    pub input: &'arena [Expression<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub struct CastFunctionArguments<'text, 'arena> {
    pub value: Expression<'text, 'arena>,
    pub as_type: &'arena SQLType<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct TreatFunctionArguments<'text, 'arena> {
    pub value: Expression<'text, 'arena>,
    pub as_type: &'arena SQLType<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub enum KnownFunctionArguments<'text, 'arena> {
    Trim(&'arena TrimFunctionArguments<'text, 'arena>),
    Substring(&'arena SubstringFunctionArguments<'text, 'arena>),
    Position(&'arena PositionFunctionArguments<'text, 'arena>),
    Extract(&'arena ExtractFunctionArguments<'text, 'arena>),
    Overlay(&'arena OverlayFunctionArguments<'text, 'arena>),
    Cast(&'arena CastFunctionArguments<'text, 'arena>),
    Treat(&'arena TreatFunctionArguments<'text, 'arena>),
}

#[derive(Debug, Clone)]
pub struct FunctionExpression<'text, 'arena> {
    pub name: FunctionName<'text>,
    pub args: &'arena [FunctionArgument<'text, 'arena>],
    pub args_known: Option<KnownFunctionArguments<'text, 'arena>>,
    pub arg_ordering: &'arena [&'arena OrderSpecification<'text, 'arena>],
    pub variadic: Option<&'arena FunctionArgument<'text, 'arena>>,
    pub within_group: &'arena [&'arena OrderSpecification<'text, 'arena>],
    pub filter: Expression<'text, 'arena>,
    pub all: bool,
    pub distinct: bool,
    pub over: bool,
}

#[derive(Debug, Clone)]
pub enum Limit<'text, 'arena> {
    ALL,
    Expression(Expression<'text, 'arena>),
}

#[derive(Default, Debug, Clone)]
pub struct SampleCount<'text> {
    pub value: &'text str,
    pub unit: sx::SampleCountUnit,
}

#[derive(Default, Debug, Clone)]
pub struct Sample<'text> {
    pub function: &'text str,
    pub seed: Option<&'text str>,
    pub repeat: Option<&'text str>,
    pub count: Option<SampleCount<'text>>,
}

#[derive(Default, Debug, Clone)]
pub struct RowLocking<'text, 'arena> {
    pub strength: sx::RowLockingStrength,
    pub of: &'arena [NamePath<'text, 'arena>],
    pub block_behavior: Option<sx::RowLockingBlockBehavior>,
}

#[derive(Default, Debug, Clone)]
pub struct SelectFromStatement<'text, 'arena> {
    pub all: bool,
    pub distinct: bool,
    pub targets: &'arena [&'arena ResultTarget<'text, 'arena>],
    pub into: Option<&'arena Into<'text, 'arena>>,
    pub from: &'arena [&'arena TableRef<'text, 'arena>],
    pub where_clause: Option<Expression<'text, 'arena>>,
    pub group_by: &'arena [&'arena GroupByItem<'text, 'arena>],
    pub having: Option<Expression<'text, 'arena>>,
    pub windows: bool,
    pub sample: Option<&'arena Sample<'text>>,
}

#[derive(Debug, Clone)]
pub struct CombineOperation<'text, 'arena> {
    pub operation: sx::CombineOperation,
    pub modifier: sx::CombineModifier,
    pub input: &'arena [&'arena SelectStatement<'text, 'arena>],
}

#[derive(Debug, Clone)]
pub enum SelectData<'text, 'arena> {
    From(SelectFromStatement<'text, 'arena>),
    Table(&'arena TableRef<'text, 'arena>),
    Values(&'arena [&'arena [Expression<'text, 'arena>]]),
    Combine(CombineOperation<'text, 'arena>),
}

#[derive(Debug, Clone)]
pub struct CommonTableExpression<'text, 'arena> {
    pub name: &'text str,
    pub columns: &'arena [&'text str],
    pub statement: &'arena SelectStatement<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct SelectStatement<'text, 'arena> {
    pub with_ctes: &'arena [&'arena CommonTableExpression<'text, 'arena>],
    pub with_recursive: bool,
    pub data: SelectData<'text, 'arena>,
    pub order_by: &'arena [&'arena OrderSpecification<'text, 'arena>],
    pub row_locking: &'arena [&'arena RowLocking<'text, 'arena>],
    pub limit: Option<Limit<'text, 'arena>>,
    pub offset: Option<Expression<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct CreateStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub elements: &'arena [&'arena ColumnDefinition<'text, 'arena>],
    pub temp: Option<sx::TempType>,
    pub on_commit: Option<sx::OnCommitOption>,
}

#[derive(Debug, Clone)]
pub struct CreateAsStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub columns: &'arena [&'text str],
    pub statement: &'arena SelectStatement<'text, 'arena>,
    pub if_not_exists: bool,
    pub with_data: bool,
    pub temp: Option<sx::TempType>,
    pub on_commit: Option<sx::OnCommitOption>,
}

#[derive(Debug, Clone)]
pub struct CreateViewStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub columns: &'arena [&'text str],
    pub statement: &'arena SelectStatement<'text, 'arena>,
    pub temp: Option<sx::TempType>,
}

#[derive(Debug, Clone)]
pub struct GenericOption<'text> {
    pub key: &'text str,
    pub value: &'text str,
}

#[derive(Debug, Clone)]
pub struct ColumnConstraintArgument<'text, 'arena> {
    pub name: &'text str,
    pub value: Expression<'text, 'arena>,
}

#[derive(Debug, Clone)]
pub struct ColumnConstraint<'text, 'arena> {
    pub constraint_name: Option<&'text str>,
    pub constraint_type: Option<sx::ColumnConstraint>,
    // pub value: any, XXX
    pub arguments: &'arena [&'arena ColumnConstraintArgument<'text, 'arena>],
    pub no_inherit: bool,
}

#[derive(Debug, Clone)]
pub enum ColumnConstraintVariant<'text, 'arena> {
    Attribute(sx::ConstraintAttribute),
    Constraint(&'arena ColumnConstraint<'text, 'arena>),
}
impl<'text, 'arena> Default for ColumnConstraintVariant<'text, 'arena> {
    fn default() -> Self {
        ColumnConstraintVariant::Attribute(sx::ConstraintAttribute::DEFERRABLE)
    }
}
