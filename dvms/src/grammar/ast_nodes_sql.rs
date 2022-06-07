use super::ast_cell::*;
use super::ast_list::ASTList;
use super::enums_serde::*;
use dashql_proto::syntax::{self as sx};
use serde::Serialize;
use std::fmt::Debug;
use std::hash::Hash;

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
    pub func_name: ASTCell<Option<NamePath<'a>>>,
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
    pub indirection: ASTCell<Option<NamePath<'a>>>,
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
    pub argument: ASTCell<Expression<'a>>,
    pub cases: ASTCell<&'a [ASTCell<&'a CaseExpressionClause<'a>>]>,
    pub default: ASTCell<Expression<'a>>,
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
    Array(&'a [ASTCell<Expression<'a>>]),
    Boolean(bool),
    Case(&'a CaseExpression<'a>),
    ColumnRef(NamePath<'a>),
    Conjunction(&'a ASTList<'a, Expression<'a>>),
    ConstCast(ConstCastExpression<'a>),
    Disjunction(&'a ASTList<'a, Expression<'a>>),
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
    Uint32(u32),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct OrderSpecification<'a> {
    pub value: ASTCell<Expression<'a>>,
    #[serde(with = "serde_order_direction::cell_opt")]
    pub direction: ASTCell<Option<sx::OrderDirection>>,
    #[serde(with = "serde_order_null_rule::cell_opt")]
    pub null_rule: ASTCell<Option<sx::OrderNullRule>>,
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
    #[serde(with = "serde_interval_type::cell_opt")]
    pub interval_type: ASTCell<Option<sx::IntervalType>>,
    pub precision: ASTCell<Option<&'a str>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub enum ResultTarget<'a> {
    Star,
    Value {
        value: ASTCell<Expression<'a>>,
        alias: ASTCell<Option<&'a str>>,
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
    pub varying: ASTCell<bool>,
    pub length: ASTCell<Option<Expression<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CharacterType<'a> {
    #[serde(with = "serde_character_type::cell")]
    pub base: ASTCell<sx::CharacterType>,
    pub length: ASTCell<Option<Expression<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TimestampType<'a> {
    pub precision: ASTCell<Option<&'a str>>,
    pub with_timezone: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TimeType<'a> {
    pub precision: ASTCell<Option<&'a str>>,
    pub with_timezone: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct IntervalType<'a> {
    #[serde(with = "serde_interval_type::cell_opt")]
    pub base: ASTCell<Option<sx::IntervalType>>,
    pub precision: ASTCell<Option<&'a str>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
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
    pub base_type: ASTCell<SQLBaseType<'a>>,
    pub array_bounds: ASTCell<&'a [ArrayBound<'a>]>,
    pub set_of: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Into<'a> {
    #[serde(with = "serde_temp_type::cell")]
    pub temp: ASTCell<sx::TempType>,
    pub name: ASTCell<NamePath<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ColumnDefinition<'a> {
    pub name: ASTCell<&'a str>,
    pub sql_type: ASTCell<&'a SQLType<'a>>,
    pub collate: ASTCell<&'a [ASTCell<&'a str>]>,
    pub constraints: ASTCell<&'a [ASTCell<ColumnConstraintVariant<'a>>]>,
    pub options: ASTCell<&'a [ASTCell<&'a GenericOption<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Alias<'a> {
    pub name: ASTCell<&'a str>,
    pub column_names: ASTCell<&'a [ASTCell<&'a str>]>,
    pub column_definitions: ASTCell<&'a [ASTCell<&'a ColumnDefinition<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TableSample<'a> {
    pub count: ASTCell<&'a str>,
    #[serde(with = "serde_sample_count_unit::cell")]
    pub unit: ASTCell<sx::SampleCountUnit>,
    pub function: ASTCell<Option<&'a str>>,
    pub repeat: ASTCell<Option<&'a str>>,
    pub seed: ASTCell<Option<&'a str>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectStatementRef<'a> {
    pub table: ASTCell<&'a SelectStatement<'a>>,
    pub alias: ASTCell<Option<&'a Alias<'a>>>,
    pub sample: ASTCell<Option<&'a TableSample<'a>>>,
    pub lateral: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct RowsFromItem<'a> {
    pub function: ASTCell<&'a FunctionExpression<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a ColumnDefinition<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FunctionTable<'a> {
    pub function: ASTCell<Option<&'a FunctionExpression<'a>>>,
    pub rows_from: ASTCell<&'a [ASTCell<&'a RowsFromItem<'a>>]>,
    pub with_ordinality: ASTCell<bool>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FunctionTableRef<'a> {
    pub table: ASTCell<&'a FunctionTable<'a>>,
    pub alias: ASTCell<Option<&'a Alias<'a>>>,
    pub sample: ASTCell<Option<&'a TableSample<'a>>>,
    pub lateral: ASTCell<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum JoinQualifier<'a> {
    On(Expression<'a>),
    Using(&'a [ASTCell<&'a str>]),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct JoinedTable<'a> {
    #[serde(with = "serde_join_type::cell")]
    pub join: ASTCell<sx::JoinType>,
    pub qualifier: ASTCell<Option<JoinQualifier<'a>>>,
    pub input: ASTCell<&'a [ASTCell<&'a TableRef<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct JoinedTableRef<'a> {
    pub table: ASTCell<&'a JoinedTable<'a>>,
    pub alias: ASTCell<Option<&'a Alias<'a>>>,
}

#[derive(Debug, Clone, Serialize, Default, Hash, PartialEq, Eq)]
pub struct RelationRef<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub inherit: ASTCell<bool>,
    pub alias: ASTCell<Option<&'a Alias<'a>>>,
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
    pub name: ASTCell<Option<&'a str>>,
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum FunctionName<'a> {
    Unknown(&'a str),
    #[serde(with = "serde_known_function")]
    Known(sx::KnownFunction),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct OverlayFunctionArguments<'a> {
    pub input: ASTCell<Expression<'a>>,
    pub placing: ASTCell<Expression<'a>>,
    pub substr_from: ASTCell<Expression<'a>>,
    pub substr_for: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum ExtractFunctionTarget<'a> {
    Unknown(&'a str),
    #[serde(with = "serde_extract_target")]
    Known(sx::ExtractTarget),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ExtractFunctionArguments<'a> {
    pub target: ASTCell<ExtractFunctionTarget<'a>>,
    pub input: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SubstringFunctionArguments<'a> {
    pub input: ASTCell<Expression<'a>>,
    pub substr_from: ASTCell<Expression<'a>>,
    pub substr_for: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct PositionFunctionArguments<'a> {
    pub search: ASTCell<Expression<'a>>,
    pub input: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TrimFunctionArguments<'a> {
    #[serde(with = "serde_trim_direction::cell")]
    pub direction: ASTCell<sx::TrimDirection>,
    pub characters: ASTCell<Expression<'a>>,
    pub input: ASTCell<&'a [ASTCell<Expression<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CastFunctionArguments<'a> {
    pub value: ASTCell<Expression<'a>>,
    pub as_type: ASTCell<&'a SQLType<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TreatFunctionArguments<'a> {
    pub value: ASTCell<Expression<'a>>,
    pub as_type: ASTCell<&'a SQLType<'a>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum KnownFunctionArguments<'a> {
    Trim(&'a TrimFunctionArguments<'a>),
    Substring(&'a SubstringFunctionArguments<'a>),
    Position(&'a PositionFunctionArguments<'a>),
    Extract(&'a ExtractFunctionArguments<'a>),
    Overlay(&'a OverlayFunctionArguments<'a>),
    Cast(&'a CastFunctionArguments<'a>),
    Treat(&'a TreatFunctionArguments<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq, Default)]
pub struct FunctionExpression<'a> {
    pub name: ASTCell<FunctionName<'a>>,
    pub args: ASTCell<&'a [ASTCell<&'a FunctionArgument<'a>>]>,
    pub args_known: ASTCell<Option<KnownFunctionArguments<'a>>>,
    pub arg_ordering: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
    pub variadic: ASTCell<Option<&'a FunctionArgument<'a>>>,
    pub within_group: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
    pub filter: ASTCell<Expression<'a>>,
    pub all: ASTCell<bool>,
    pub distinct: ASTCell<bool>,
    pub over: ASTCell<Option<&'a WindowFrame<'a>>>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum Limit<'a> {
    ALL,
    Expression(Expression<'a>),
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SampleCount<'a> {
    pub value: ASTCell<&'a str>,
    #[serde(with = "serde_sample_count_unit::cell")]
    pub unit: ASTCell<sx::SampleCountUnit>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct Sample<'a> {
    pub function: ASTCell<&'a str>,
    pub seed: ASTCell<Option<&'a str>>,
    pub repeat: ASTCell<Option<&'a str>>,
    pub count: ASTCell<Option<&'a SampleCount<'a>>>,
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct RowLocking<'a> {
    #[serde(with = "serde_row_locking_strength::cell")]
    pub strength: ASTCell<sx::RowLockingStrength>,
    pub of: ASTCell<&'a [NamePath<'a>]>,
    #[serde(with = "serde_row_locking_block_behavior::cell_opt")]
    pub block_behavior: ASTCell<Option<sx::RowLockingBlockBehavior>>,
}

#[derive(Default, Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SelectFromStatement<'a> {
    pub all: ASTCell<bool>,
    pub distinct: ASTCell<Option<&'a [ASTCell<Expression<'a>>]>>,
    pub targets: ASTCell<&'a [ASTCell<&'a ResultTarget<'a>>]>,
    pub into: ASTCell<Option<&'a Into<'a>>>,
    pub from: ASTCell<&'a [ASTCell<&'a TableRef<'a>>]>,
    pub where_clause: ASTCell<Expression<'a>>,
    pub group_by: ASTCell<&'a [ASTCell<&'a GroupByItem<'a>>]>,
    pub having: ASTCell<Expression<'a>>,
    pub windows: ASTCell<&'a [ASTCell<&'a WindowDefinition<'a>>]>,
    pub sample: ASTCell<Option<&'a Sample<'a>>>,
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
    pub limit: ASTCell<Option<Limit<'a>>>,
    pub offset: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a ColumnDefinition<'a>>]>,
    pub constraints: ASTCell<&'a [ASTCell<&'a TableConstraintSpec<'a>>]>,
    #[serde(with = "serde_temp_type::cell_opt")]
    pub temp: ASTCell<Option<sx::TempType>>,
    #[serde(with = "serde_on_commit_option::cell_opt")]
    pub on_commit: ASTCell<Option<sx::OnCommitOption>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateAsStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub statement: ASTCell<&'a SelectStatement<'a>>,
    pub if_not_exists: ASTCell<bool>,
    pub with_data: ASTCell<bool>,
    #[serde(with = "serde_temp_type::cell_opt")]
    pub temp: ASTCell<Option<sx::TempType>>,
    #[serde(with = "serde_on_commit_option::cell_opt")]
    pub on_commit: ASTCell<Option<sx::OnCommitOption>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct CreateViewStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub statement: ASTCell<&'a SelectStatement<'a>>,
    #[serde(with = "serde_temp_type::cell_opt")]
    pub temp: ASTCell<Option<sx::TempType>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct GenericOption<'a> {
    pub key: ASTCell<&'a str>,
    pub value: ASTCell<&'a str>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct GenericDefinition<'a> {
    pub key: ASTCell<&'a str>,
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ColumnConstraintSpec<'a> {
    pub constraint_name: ASTCell<Option<&'a str>>,
    #[serde(with = "serde_column_constraint::cell")]
    pub constraint_type: ASTCell<sx::ColumnConstraint>,
    pub value: ASTCell<Expression<'a>>,
    pub definition: ASTCell<&'a [ASTCell<&'a GenericDefinition<'a>>]>,
    pub no_inherit: ASTCell<bool>,
}

#[derive(Debug, Clone, Copy, Serialize, Hash, PartialEq, Eq)]
pub enum ColumnConstraintVariant<'a> {
    #[serde(with = "serde_constraint_attribute")]
    Attribute(sx::ConstraintAttribute),
    Constraint(&'a ColumnConstraintSpec<'a>),
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowFrameBound<'a> {
    #[serde(with = "serde_window_bound_mode::cell")]
    pub mode: ASTCell<sx::WindowBoundMode>,
    #[serde(with = "serde_window_bound_direction::cell_opt")]
    pub direction: ASTCell<Option<sx::WindowBoundDirection>>,
    pub value: ASTCell<Expression<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowFrame<'a> {
    pub name: ASTCell<Option<&'a str>>,
    pub partition_by: ASTCell<&'a [ASTCell<Expression<'a>>]>,
    pub order_by: ASTCell<&'a [ASTCell<&'a OrderSpecification<'a>>]>,
    #[serde(with = "serde_window_range_mode::cell_opt")]
    pub frame_mode: ASTCell<Option<sx::WindowRangeMode>>,
    pub frame_bounds: ASTCell<&'a [ASTCell<&'a WindowFrameBound<'a>>]>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct WindowDefinition<'a> {
    pub name: ASTCell<&'a str>,
    pub frame: ASTCell<&'a WindowFrame<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct KeyAction {
    #[serde(with = "serde_key_action_trigger::cell")]
    pub trigger: ASTCell<sx::KeyActionTrigger>,
    #[serde(with = "serde_key_action_command::cell")]
    pub command: ASTCell<sx::KeyActionCommand>,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub struct ConstraintAttribute(pub sx::ConstraintAttribute);

impl Default for ConstraintAttribute {
    fn default() -> Self {
        Self(sx::ConstraintAttribute::NO_INHERIT)
    }
}

impl Serialize for ConstraintAttribute {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serde_constraint_attribute::serialize(&self.0, serializer)
    }
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct TableConstraintSpec<'a> {
    pub constraint_name: ASTCell<Option<&'a str>>,
    #[serde(with = "serde_table_constraint::cell")]
    pub constraint_type: ASTCell<sx::TableConstraint>,
    pub columns: ASTCell<&'a [ASTCell<&'a str>]>,
    pub argument: ASTCell<Option<Expression<'a>>>,
    pub using_index: ASTCell<Option<&'a str>>,
    pub definition: ASTCell<&'a [ASTCell<&'a GenericDefinition<'a>>]>,
    pub attributes: ASTCell<&'a [ASTCell<ConstraintAttribute>]>,
    pub references_name: ASTCell<NamePath<'a>>,
    pub references_columns: ASTCell<&'a [ASTCell<&'a str>]>,
    #[serde(with = "serde_key_match::cell_opt")]
    pub key_match: ASTCell<Option<sx::KeyMatch>>,
    pub key_actions: ASTCell<&'a [ASTCell<&'a KeyAction>]>,
}
