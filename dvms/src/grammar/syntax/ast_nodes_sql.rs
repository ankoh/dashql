use super::ast_cell::*;
use super::enums_serde::*;
use dashql_proto::syntax as sx;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IndirectionExpression<'a> {
    pub value: ASTCell<Expression<'a>>,
    pub path: ASTCell<NamePath<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IndirectionIndex<'a> {
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IndirectionBounds<'a> {
    pub lower_bound: ASTCell<Expression<'a>>,
    pub upper_bound: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum Indirection<'a> {
    Name(&'a str),
    Index(&'a IndirectionIndex<'a>),
    Bounds(&'a IndirectionBounds<'a>),
}
pub type NamePath<'a> = &'a [ASTCell<Indirection<'a>>];

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ArrayBound<'a> {
    Empty,
    Index(&'a str),
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum ExpressionOperatorName<'a> {
    #[serde(with = "serde_expression_operator")]
    Known(sx::ExpressionOperator),
    Qualified(&'a [ASTCell<&'a str>]),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct NaryExpression<'a> {
    pub operator: ASTCell<ExpressionOperatorName<'a>>,
    pub args: &'a [ASTCell<Expression<'a>>],
    pub postfix: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ConstTypeCastExpression<'a> {
    pub value: ASTCell<&'a str>,
    pub sql_type: ASTCell<&'a SQLType<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ConstIntervalCastExpression<'a> {
    pub value: ASTCell<&'a str>,
    pub interval: ASTCell<&'a IntervalSpecification<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ConstFunctionCastExpression<'a> {
    pub value: ASTCell<&'a str>,
    pub func_name: Option<ASTCell<NamePath<'a>>>,
    pub func_args: ASTCell<&'a [ASTCell<&'a FunctionArgument<'a>>]>,
    pub func_arg_ordering: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
}

#[derive(Debug, Copy, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ConstCastExpression<'a> {
    Type(&'a ConstTypeCastExpression<'a>),
    Interval(&'a ConstIntervalCastExpression<'a>),
    Function(&'a ConstFunctionCastExpression<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TypeCastExpression<'a> {
    pub value: ASTCell<Expression<'a>>,
    pub sql_type: ASTCell<&'a SQLType<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SubqueryExpression<'a> {
    pub operator: ASTCell<ExpressionOperatorName<'a>>,
    #[serde(with = "serde_subquery_quantifier::cell")]
    pub quantifier: ASTCell<sx::SubqueryQuantifier>,
    pub args: [ASTCell<Expression<'a>>; 2],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectStatementExpression<'a> {
    pub statement: ASTCell<&'a SelectStatement<'a>>,
    pub indirection: Option<ASTCell<NamePath<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ExistsExpression<'a> {
    pub statement: ASTCell<&'a SelectStatement<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CaseExpressionClause<'a> {
    pub when: ASTCell<Expression<'a>>,
    pub then: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CaseExpression<'a> {
    pub argument: Option<ASTCell<Expression<'a>>>,
    pub cases: ASTCell<&'a [ASTCell<&'a CaseExpressionClause<'a>>]>,
    pub default: Option<ASTCell<Expression<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ParameterRef<'a> {
    pub prefix: ASTCell<&'a str>,
    pub name: ASTCell<NamePath<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TypeTestExpression<'a> {
    pub negate: ASTCell<bool>,
    pub value: ASTCell<Expression<'a>>,
    pub of_types: ASTCell<&'a [ASTCell<&'a SQLType<'a>>]>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum Expression<'a> {
    Null,
    Boolean(bool),
    Uint32(u32),
    Array(&'a [ASTCell<Expression<'a>>]),
    Case(&'a CaseExpression<'a>),
    ColumnRef(NamePath<'a>),
    ConstCast(ConstCastExpression<'a>),
    Exists(&'a ExistsExpression<'a>),
    FunctionCall(&'a FunctionExpression<'a>),
    Indirection(&'a IndirectionExpression<'a>),
    Nary(&'a NaryExpression<'a>),
    ParameterRef(&'a ParameterRef<'a>),
    SelectStatement(&'a SelectStatementExpression<'a>),
    StringRef(&'a str),
    Subquery(&'a SubqueryExpression<'a>),
    TypeCast(&'a TypeCastExpression<'a>),
    TypeTest(&'a TypeTestExpression<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct OrderSpecification<'a> {
    pub value: ASTCell<Expression<'a>>,
    #[serde(with = "serde_order_direction::opt_cell")]
    pub direction: Option<ASTCell<sx::OrderDirection>>,
    #[serde(with = "serde_order_null_rule::opt_cell")]
    pub null_rule: Option<ASTCell<sx::OrderNullRule>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum GroupByItem<'a> {
    Empty,
    Expression(Expression<'a>),
    Cube(&'a [ASTCell<Expression<'a>>]),
    Rollup(&'a [ASTCell<Expression<'a>>]),
    GroupingSets(&'a [ASTCell<&'a GroupByItem<'a>>]),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IntervalSpecification<'a> {
    #[serde(with = "serde_interval_type::opt_cell")]
    pub interval_type: Option<ASTCell<sx::IntervalType>>,
    pub precision: Option<ASTCell<&'a str>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ResultTarget<'a> {
    Star,
    Value {
        value: ASTCell<Expression<'a>>,
        alias: Option<ASTCell<&'a str>>,
    },
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct GenericType<'a> {
    pub name: ASTCell<&'a str>,
    pub modifiers: ASTCell<&'a [ASTCell<Expression<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct NumericType<'a> {
    #[serde(with = "serde_numeric_type::cell")]
    pub base: ASTCell<sx::NumericType>,
    pub modifiers: ASTCell<&'a [ASTCell<Expression<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct BitType<'a> {
    pub varying: bool,
    pub length: Option<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CharacterType<'a> {
    #[serde(with = "serde_character_type")]
    pub base: sx::CharacterType,
    pub length: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TimestampType<'a> {
    pub precision: Option<&'a str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TimeType<'a> {
    pub precision: Option<&'a str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IntervalType<'a> {
    #[serde(with = "serde_interval_type::opt")]
    pub base: Option<sx::IntervalType>,
    pub precision: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum SQLBaseType<'a> {
    Invalid,
    Generic(&'a GenericType<'a>),
    Numeric(&'a NumericType<'a>),
    Bit(&'a BitType<'a>),
    Character(&'a CharacterType<'a>),
    Time(&'a TimeType<'a>),
    Timestamp(&'a TimestampType<'a>),
    Interval(&'a IntervalSpecification<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SQLType<'a> {
    pub base_type: SQLBaseType<'a>,
    pub array_bounds: &'a [ArrayBound<'a>],
    pub set_of: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Into<'a> {
    #[serde(with = "serde_temp_type")]
    pub temp: sx::TempType,
    pub name: NamePath<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ColumnDefinition<'a> {
    pub name: &'a str,
    pub sql_type: &'a SQLType<'a>,
    pub collate: &'a [ASTCell<&'a str>],
    pub constraints: &'a [ColumnConstraintVariant<'a>],
    pub options: &'a [ASTCell<&'a GenericOption<'a>>],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Alias<'a> {
    pub name: &'a str,
    pub column_names: &'a [ASTCell<&'a str>],
    pub column_definitions: &'a [ASTCell<&'a ColumnDefinition<'a>>],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TableSample<'a> {
    pub count: &'a str,
    #[serde(with = "serde_sample_count_unit")]
    pub unit: sx::SampleCountUnit,
    pub function: Option<&'a str>,
    pub repeat: Option<&'a str>,
    pub seed: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectStatementRef<'a> {
    pub table: &'a SelectStatement<'a>,
    pub alias: Option<&'a Alias<'a>>,
    pub sample: Option<&'a TableSample<'a>>,
    pub lateral: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct RowsFromItem<'a> {
    pub function: &'a FunctionExpression<'a>,
    pub columns: &'a [ASTCell<&'a ColumnDefinition<'a>>],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FunctionTable<'a> {
    pub function: Option<&'a FunctionExpression<'a>>,
    pub rows_from: &'a [ASTCell<&'a RowsFromItem<'a>>],
    pub with_ordinality: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FunctionTableRef<'a> {
    pub table: &'a FunctionTable<'a>,
    pub alias: Option<&'a Alias<'a>>,
    pub sample: Option<&'a TableSample<'a>>,
    pub lateral: bool,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum JoinQualifier<'a> {
    On(Expression<'a>),
    Using(&'a [ASTCell<&'a str>]),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct JoinedTable<'a> {
    #[serde(with = "serde_join_type")]
    pub join: sx::JoinType,
    pub qualifier: Option<JoinQualifier<'a>>,
    pub input: &'a [ASTCell<&'a TableRef<'a>>],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct JoinedTableRef<'a> {
    pub table: &'a JoinedTable<'a>,
    pub alias: Option<&'a Alias<'a>>,
}

#[derive(Debug, Clone, Serialize, Default, Hash, PartialEq, Eq)]
pub struct RelationRef<'a> {
    pub name: NamePath<'a>,
    pub inherit: bool,
    pub alias: Option<&'a Alias<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum TableRef<'a> {
    Relation(&'a RelationRef<'a>),
    Select(&'a SelectStatementRef<'a>),
    Function(&'a FunctionTableRef<'a>),
    Join(&'a JoinedTableRef<'a>),
}

#[derive(Debug, Clone, Serialize, Default, Hash, PartialEq, Eq)]
pub struct FunctionArgument<'a> {
    pub name: Option<&'a str>,
    pub value: Expression<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum FunctionName<'a> {
    Unknown(&'a str),
    #[serde(with = "serde_known_function")]
    Known(sx::KnownFunction),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct OverlayFunctionArguments<'a> {
    pub input: Expression<'a>,
    pub placing: Expression<'a>,
    pub substr_from: Expression<'a>,
    pub substr_for: Option<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ExtractFunctionTarget<'a> {
    Unknown(&'a str),
    #[serde(with = "serde_extract_target")]
    Known(sx::ExtractTarget),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ExtractFunctionArguments<'a> {
    pub target: ExtractFunctionTarget<'a>,
    pub input: Expression<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SubstringFunctionArguments<'a> {
    pub input: Expression<'a>,
    pub substr_from: Option<Expression<'a>>,
    pub substr_for: Option<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct PositionFunctionArguments<'a> {
    pub search: Expression<'a>,
    pub input: Expression<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TrimFunctionArguments<'a> {
    #[serde(with = "serde_trim_direction")]
    pub direction: sx::TrimDirection,
    pub characters: Option<Expression<'a>>,
    pub input: &'a [ASTCell<Expression<'a>>],
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CastFunctionArguments<'a> {
    pub value: Expression<'a>,
    pub as_type: &'a SQLType<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TreatFunctionArguments<'a> {
    pub value: Expression<'a>,
    pub as_type: &'a SQLType<'a>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum KnownFunctionArguments<'a> {
    Trim(&'a TrimFunctionArguments<'a>),
    Substring(&'a SubstringFunctionArguments<'a>),
    Position(&'a PositionFunctionArguments<'a>),
    Extract(&'a ExtractFunctionArguments<'a>),
    Overlay(&'a OverlayFunctionArguments<'a>),
    Cast(&'a CastFunctionArguments<'a>),
    Treat(&'a TreatFunctionArguments<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FunctionExpression<'a> {
    pub name: FunctionName<'a>,
    pub args: &'a [ASTCell<&'a FunctionArgument<'a>>],
    pub args_known: Option<KnownFunctionArguments<'a>>,
    pub arg_ordering: &'a [ASTCell<&'a OrderSpecification<'a>>],
    pub variadic: Option<&'a FunctionArgument<'a>>,
    pub within_group: &'a [ASTCell<&'a OrderSpecification<'a>>],
    pub filter: Expression<'a>,
    pub all: bool,
    pub distinct: bool,
    pub over: Option<&'a WindowFrame<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum Limit<'a> {
    ALL,
    Expression(Expression<'a>),
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SampleCount<'a> {
    pub value: &'a str,
    #[serde(with = "serde_sample_count_unit")]
    pub unit: sx::SampleCountUnit,
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Sample<'a> {
    pub function: &'a str,
    pub seed: Option<&'a str>,
    pub repeat: Option<&'a str>,
    pub count: Option<SampleCount<'a>>,
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct RowLocking<'a> {
    #[serde(with = "serde_row_locking_strength")]
    pub strength: sx::RowLockingStrength,
    pub of: &'a [NamePath<'a>],
    #[serde(with = "serde_row_locking_block_behavior::opt")]
    pub block_behavior: Option<sx::RowLockingBlockBehavior>,
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectFromStatement<'a> {
    pub all: ASTCell<bool>,
    pub distinct: Option<ASTCell<&'a [ASTCell<Expression<'a>>]>>,
    pub targets: ASTCell<&'a [ASTCell<&'a ResultTarget<'a>>]>,
    pub into: Option<ASTCell<&'a Into<'a>>>,
    pub from: ASTCell<&'a [ASTCell<&'a TableRef<'a>>]>,
    pub where_clause: Option<ASTCell<Expression<'a>>>,
    pub group_by: ASTCell<&'a [ASTCell<&'a GroupByItem<'a>>]>,
    pub having: Option<ASTCell<Expression<'a>>>,
    pub windows: ASTCell<&'a [ASTCell<&'a WindowDefinition<'a>>]>,
    pub sample: Option<ASTCell<&'a Sample<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CombineOperation<'a> {
    #[serde(with = "serde_combine_operation::cell")]
    pub operation: ASTCell<sx::CombineOperation>,
    #[serde(with = "serde_combine_modifier::cell")]
    pub modifier: ASTCell<sx::CombineModifier>,
    pub input: ASTCell<&'a [ASTCell<&'a SelectStatement<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum SelectData<'a> {
    Table(ASTCell<TableRef<'a>>),
    Values(ASTCell<&'a [ASTCell<&'a [ASTCell<Expression<'a>>]>]>),
    From(&'a SelectFromStatement<'a>),
    Combine(&'a CombineOperation<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CommonTableExpression<'a> {
    pub name: ASTCell<&'a str>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub statement: ASTCell<&'a SelectStatement<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectStatement<'a> {
    pub with_ctes: ASTCell<&'a [ASTCell<&'a CommonTableExpression<'a>>]>,
    pub with_recursive: ASTCell<bool>,
    pub data: SelectData<'a>,
    pub order_by: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
    pub row_locking: ASTCell<&'a [ASTCell<&'a RowLocking<'a>>]>,
    pub limit: Option<ASTCell<Limit<'a>>>,
    pub offset: Option<ASTCell<Expression<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub elements: ASTCell<&'a [ASTCell<&'a ColumnDefinition<'a>>]>,
    #[serde(with = "serde_temp_type::opt_cell")]
    pub temp: Option<ASTCell<sx::TempType>>,
    #[serde(with = "serde_on_commit_option::opt_cell")]
    pub on_commit: Option<ASTCell<sx::OnCommitOption>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateAsStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub statement: ASTCell<&'a SelectStatement<'a>>,
    pub if_not_exists: ASTCell<bool>,
    pub with_data: ASTCell<bool>,
    #[serde(with = "serde_temp_type::opt_cell")]
    pub temp: Option<ASTCell<sx::TempType>>,
    #[serde(with = "serde_on_commit_option::opt_cell")]
    pub on_commit: Option<ASTCell<sx::OnCommitOption>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateViewStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub statement: ASTCell<&'a SelectStatement<'a>>,
    #[serde(with = "serde_temp_type::opt_cell")]
    pub temp: Option<ASTCell<sx::TempType>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct GenericOption<'a> {
    pub key: ASTCell<&'a str>,
    pub value: ASTCell<&'a str>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ColumnConstraintArgument<'a> {
    pub name: ASTCell<&'a str>,
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ColumnConstraint<'a> {
    pub constraint_name: Option<ASTCell<&'a str>>,
    #[serde(with = "serde_column_constraint::opt_cell")]
    pub constraint_type: Option<ASTCell<sx::ColumnConstraint>>,
    pub value: Option<ASTCell<Expression<'a>>>,
    pub arguments: ASTCell<&'a [ASTCell<&'a ColumnConstraintArgument<'a>>]>,
    pub no_inherit: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ColumnConstraintVariant<'a> {
    #[serde(with = "serde_constraint_attribute")]
    Attribute(sx::ConstraintAttribute),
    Constraint(&'a ColumnConstraint<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowFrameBound<'a> {
    #[serde(with = "serde_window_bound_mode::cell")]
    pub mode: ASTCell<sx::WindowBoundMode>,
    #[serde(with = "serde_window_bound_direction::opt_cell")]
    pub direction: Option<ASTCell<sx::WindowBoundDirection>>,
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowFrame<'a> {
    pub name: Option<ASTCell<&'a str>>,
    pub partition_by: ASTCell<&'a [ASTCell<Expression<'a>>]>,
    pub order_by: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
    #[serde(with = "serde_window_range_mode::opt_cell")]
    pub frame_mode: Option<ASTCell<sx::WindowRangeMode>>,
    pub frame_bounds: ASTCell<&'a [ASTCell<&'a WindowFrameBound<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowDefinition<'a> {
    pub name: ASTCell<&'a str>,
    pub frame: ASTCell<&'a WindowFrame<'a>>,
}
