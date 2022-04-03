use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
pub enum NamePathElement<'text> {
    Component {
        node_id: u32,
        value: &'text str,
    },
    IndirectionIndex {
        node_id: u32,
        value: Box<Expression<'text>>,
    },
    IndirectionBounds {
        node_id: u32,
        lower_bound: Box<Expression<'text>>,
        upper_bound: Box<Expression<'text>>,
    },
}

#[derive(Debug, Clone)]
pub struct NamePath<'text> {
    node_id: u32,
    elements: Vec<NamePathElement<'text>>,
}

#[derive(Debug, Clone)]
pub enum ConstantExpression<'text> {
    Null,
    True,
    False,
    String(&'text str),
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
    Constant(ConstantExpression<'text>),
    Nary(NaryExpression<'text>),
    Cast(CastExpression<'text>),
}
