use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
pub struct IndirectionIndex<'text> {
    pub value: Box<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub struct IndirectionBounds<'text> {
    pub lower_bound: Box<Expression<'text>>,
    pub upper_bound: Box<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub enum NamePathElement<'text> {
    Component(&'text str),
    IndirectionIndex(IndirectionIndex<'text>),
    IndirectionBounds(IndirectionBounds<'text>),
}

#[derive(Debug, Clone)]
pub struct NamePath<'text> {
    pub elements: Vec<NamePathElement<'text>>,
}

#[derive(Debug, Clone)]
pub struct NaryExpression<'text> {
    pub operator: sx::ExpressionOperator,
    pub args: Vec<Expression<'text>>,
    pub postfix: bool,
}

#[derive(Debug, Clone)]
pub struct CastExpression<'text> {
    pub cast_type: &'text str,
    pub func_name: Option<NamePath<'text>>,
    pub func_args: Vec<Expression<'text>>,
    pub func_arg_ordering: Vec<OrderSpecification<'text>>,
    pub value: &'text str,
    pub interval: Option<IntervalSpecification<'text>>,
}

#[derive(Debug, Clone)]
pub enum Expression<'text> {
    Null,
    True,
    False,
    StringRef(&'text str),
    Nary(NaryExpression<'text>),
    Cast(CastExpression<'text>),
}

#[derive(Debug, Clone)]
pub struct OrderSpecification<'text> {
    pub value: Box<Expression<'text>>,
    pub direction: Option<sx::OrderDirection>,
    pub null_rule: Option<sx::OrderNullRule>,
}

#[derive(Debug, Clone)]
pub enum IntervalSpecification<'text> {
    Raw(&'text str),
    Type {
        type_: sx::IntervalType,
        precision: Option<&'text str>,
    },
}

#[derive(Debug, Clone)]
pub enum ResultTarget<'text> {
    Star,
    Value {
        value: Box<Expression<'text>>,
        alias: Option<&'text str>,
    },
}

#[derive(Debug, Clone)]
pub struct TableSample<'text> {
    pub function: Option<&'text str>,
    pub count: Option<&'text str>,
    pub repeat: Option<&'text str>,
    pub seed: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub struct GenericType<'text> {
    pub name: &'text str,
    pub modifiers: Vec<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub struct NumericType<'text> {
    pub base: sx::NumericType,
    pub modifiers: Vec<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub struct BitType<'text> {
    pub varying: bool,
    pub length: Option<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub struct CharacterType<'text> {
    pub base: sx::CharacterType,
    pub length: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub struct TimestampType<'text> {
    pub precision: Option<&'text str>,
    pub with_timezone: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub struct IntervalType<'text> {
    pub base: Option<sx::IntervalType>,
    pub precision: Option<&'text str>,
}

#[derive(Debug, Clone)]
pub enum SQLBaseType<'text> {
    Generic(GenericType<'text>),
    Numeric(NumericType<'text>),
    Bit(BitType<'text>),
    Character(CharacterType<'text>),
    Timestamp(TimestampType<'text>),
    Interval(IntervalType<'text>),
}

#[derive(Debug, Clone)]
pub struct SQLType<'text> {
    pub base: SQLBaseType<'text>,
    pub set_of: bool,
    pub array: Vec<&'text str>,
}