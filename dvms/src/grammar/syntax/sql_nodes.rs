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
pub struct OrderSpecification<'text> {
    pub value: Box<Expression<'text>>,
    pub direction: sx::OrderDirection,
    pub null_rule: sx::OrderNullRule,
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
pub enum Expression<'text> {
    Null,
    True,
    False,
    StringRef(&'text str),
    Nary(NaryExpression<'text>),
    Cast(CastExpression<'text>),
}
