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
pub enum NamePathElement<'text> {
    Component(&'text str),
    IndirectionIndex(IndirectionIndex<'text>),
    IndirectionBounds(IndirectionBounds<'text>),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NamePath<'text> {
    #[serde(borrow)]
    pub elements: Vec<NamePathElement<'text>>,
}

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
    Nary(NaryExpression<'text>),
    ConstCast(ConstCastExpression<'text>),
    Typecast(TypecastExpression<'text>),
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
    pub with_timezone: Option<&'text str>,
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
    pub set_of: bool,
    #[serde(borrow)]
    pub array_bounds: Vec<ArrayBound<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Into<'text> {
    #[serde(with = "serde_temp_type")]
    temp: sx::TempType,
    #[serde(borrow)]
    name: NamePath<'text>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias<'text> {
    name: &'text str,
    columns: Vec<&'text str>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InlineTable<'text> {
    #[serde(borrow)]
    SelectStatement(Box<SelectStatement<'text>>),
    FunctionTable,
    JoinedTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRef<'text> {
    #[serde(borrow)]
    pub alias: Option<Alias<'text>>,
    #[serde(borrow)]
    pub sample: Option<TableSample<'text>>,
    pub table: Option<InlineTable<'text>>,
    pub lateral: bool,
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
    pub variadic: Option<FunctionArgument<'text>>,
    #[serde(with = "serde_trim_direction::opt")]
    pub trim_direction: Option<sx::TrimDirection>,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct SelectStatement<'text> {
    pub all: bool,
    #[serde(borrow)]
    pub targets: Vec<ResultTarget<'text>>,
    pub into: Option<Into<'text>>,
    pub from: bool,
    pub where_clause: bool,
    pub group_by: bool,
    pub having: bool,
    pub order_by: bool,
    pub windows: bool,
    pub sample: bool,
    pub row_locking: bool,
}
