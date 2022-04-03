use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
pub enum NamePathElement<'text> {
    Component(&'text str),
    IndirectionIndex(Box<Expression<'text>>),
    IndirectionBounds(Box<Expression<'text>>, Box<Expression<'text>>),
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
    pub value: &'text str,
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
