use super::enums_serde::*;
use dashql_proto::syntax as sx;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndirectionIndex<'text> {
    #[serde(borrow)]
    pub value: Box<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndirectionBounds<'text> {
    #[serde(borrow)]
    pub lower_bound: Box<Expression<'text>>,
    #[serde(borrow)]
    pub upper_bound: Box<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Indirection<'text> {
    Name(&'text str),
    Index(IndirectionIndex<'text>),
    Bounds(IndirectionBounds<'text>),
}

pub type NamePath<'text> = Vec<Indirection<'text>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ArrayBound<'text> {
    Empty,
    Index(&'text str),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaryExpression<'text> {
    #[serde(with = "serde_expression_operator")]
    pub operator: sx::ExpressionOperator,
    #[serde(borrow)]
    pub args: Vec<Expression<'text>>,
    pub postfix: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstCastExpression<'text> {
    pub cast_type: &'text str,
    pub func_name: Option<NamePath<'text>>,
    pub func_args: Vec<Expression<'text>>,
    #[serde(borrow)]
    pub func_arg_ordering: Vec<OrderSpecification<'text>>,
    pub value: &'text str,
    #[serde(borrow)]
    pub interval: Option<IntervalSpecification<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypecastExpression<'text> {
    #[serde(borrow)]
    pub value: Box<Expression<'text>>,
    #[serde(borrow)]
    pub typename: Box<SQLType<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Expression<'text> {
    Null,
    True,
    False,
    StringRef(&'text str),
    ColumnRef(NamePath<'text>),
    Nary(NaryExpression<'text>),
    ConstCast(ConstCastExpression<'text>),
    Typecast(TypecastExpression<'text>),
    FunctionCall(FunctionExpression<'text>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderSpecification<'text> {
    #[serde(borrow)]
    pub value: Box<Expression<'text>>,
    #[serde(with = "serde_order_direction::opt")]
    pub direction: Option<sx::OrderDirection>,
    #[serde(with = "serde_order_null_rule::opt")]
    pub null_rule: Option<sx::OrderNullRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IntervalSpecification<'text> {
    Raw(&'text str),
    Type {
        #[serde(with = "serde_interval_type")]
        interval_type: sx::IntervalType,
        precision: Option<&'text str>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResultTarget<'text> {
    Star,
    Value {
        value: Box<Expression<'text>>,
        alias: Option<&'text str>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenericType<'text> {
    pub name: &'text str,
    pub modifiers: Vec<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NumericType<'text> {
    #[serde(with = "serde_numeric_type")]
    pub base: sx::NumericType,
    #[serde(borrow)]
    pub modifiers: Vec<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BitType<'text> {
    pub varying: bool,
    #[serde(borrow)]
    pub length: Option<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterType<'text> {
    #[serde(with = "serde_character_type")]
    pub base: sx::CharacterType,
    pub length: Option<&'text str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimestampType<'text> {
    pub precision: Option<&'text str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeType<'text> {
    pub precision: Option<&'text str>,
    pub with_timezone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntervalType<'text> {
    #[serde(with = "serde_interval_type::opt")]
    pub base: Option<sx::IntervalType>,
    #[serde(borrow)]
    pub precision: Option<&'text str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SQLBaseType<'text> {
    Invalid,
    #[serde(borrow)]
    Generic(GenericType<'text>),
    Numeric(NumericType<'text>),
    Bit(BitType<'text>),
    Character(CharacterType<'text>),
    Time(TimeType<'text>),
    Timestamp(TimestampType<'text>),
    Interval(IntervalType<'text>),
}

impl<'text> Default for SQLBaseType<'text> {
    fn default() -> Self {
        SQLBaseType::Invalid
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SQLType<'text> {
    pub base_type: SQLBaseType<'text>,
    #[serde(borrow)]
    pub array_bounds: Vec<ArrayBound<'text>>,
    pub set_of: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Into<'text> {
    #[serde(with = "serde_temp_type")]
    pub temp: sx::TempType,
    #[serde(borrow)]
    pub name: NamePath<'text>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Alias<'text> {
    pub name: &'text str,
    pub columns: Vec<&'text str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSample<'text> {
    pub count: &'text str,
    #[serde(with = "serde_sample_unit_count")]
    pub unit: sx::SampleCountUnit,
    pub function: Option<&'text str>,
    pub repeat: Option<&'text str>,
    pub seed: Option<&'text str>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SelectStatementRef<'text> {
    #[serde(borrow)]
    pub table: Box<SelectStatement<'text>>,
    pub alias: Option<Alias<'text>>,
    pub sample: Option<TableSample<'text>>,
    pub lateral: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RowsFromItem<'text> {
    #[serde(borrow)]
    pub function: Box<FunctionExpression<'text>>,
    pub columns: Vec<FunctionTableElement<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FunctionTableElement<'text> {
    pub element_name: &'text str,
    pub element_type: SQLType<'text>,
    pub collate: Option<Vec<&'text str>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FunctionTable<'text> {
    #[serde(borrow)]
    pub function: Option<Box<FunctionExpression<'text>>>,
    pub rows_from: Vec<RowsFromItem<'text>>,
    pub with_ordinality: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FunctionTableRef<'text> {
    #[serde(borrow)]
    pub table: FunctionTable<'text>,
    pub alias: Option<Alias<'text>>,
    pub sample: Option<TableSample<'text>>,
    pub lateral: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JoinedTable<'text> {
    #[serde(with = "serde_join_type")]
    pub join: sx::JoinType,
    #[serde(borrow)]
    pub input: Vec<TableRef<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JoinedTableRef<'text> {
    #[serde(borrow)]
    pub table: JoinedTable<'text>,
    pub alias: Option<Alias<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RelationRef<'text> {
    #[serde(borrow)]
    pub name: NamePath<'text>,
    pub inherit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TableRef<'text> {
    #[serde(borrow)]
    Relation(RelationRef<'text>),
    Select(SelectStatementRef<'text>),
    Function(FunctionTableRef<'text>),
    Join(JoinedTableRef<'text>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionArgument<'text> {
    #[serde(borrow)]
    pub name: Option<&'text str>,
    pub value: Expression<'text>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FunctionExpression<'text> {
    #[serde(borrow)]
    pub name: Option<&'text str>,
    pub arguments: Vec<FunctionArgument<'text>>,
    pub argument_ordering: Vec<OrderSpecification<'text>>,
    pub within_group: Vec<OrderSpecification<'text>>,
    pub filter: Option<Box<Expression<'text>>>,
    pub all: bool,
    pub distinct: bool,
    pub over: bool,
    pub variadic: Option<Box<FunctionArgument<'text>>>,
    #[serde(with = "serde_trim_direction::opt")]
    pub trim_direction: Option<sx::TrimDirection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Limit<'text> {
    ALL,
    #[serde(borrow)]
    Expression(Box<Expression<'text>>),
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct Sample<'text> {
    pub function: &'text str,
    pub seed: Option<&'text str>,
    pub repeat: Option<&'text str>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct SelectStatement<'text> {
    pub all: bool,
    #[serde(borrow)]
    pub targets: Vec<ResultTarget<'text>>,
    pub into: Option<Into<'text>>,
    pub from: Vec<TableRef<'text>>,
    pub where_clause: Option<Box<Expression<'text>>>,
    pub group_by: bool,
    pub having: bool,
    pub order_by: bool,
    pub windows: bool,
    pub sample: Option<Sample<'text>>,
    pub row_locking: bool,
    pub limit: Option<Limit<'text>>,
    pub offset: Option<Box<Expression<'text>>>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct CreateAsStatement<'text> {
    #[serde(borrow)]
    pub name: NamePath<'text>,
    pub columns: Option<Vec<&'text str>>,
    pub as_statement: SelectStatement<'text>,
    pub if_not_exists: bool,
    pub with_data: bool,
    #[serde(with = "serde_temp_type::opt")]
    pub temp: Option<sx::TempType>,
    #[serde(with = "serde_on_commit_option::opt")]
    pub on_commit: Option<sx::OnCommitOption>,
}
