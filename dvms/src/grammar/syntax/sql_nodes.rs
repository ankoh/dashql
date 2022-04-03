use crate::proto::syntax as sx;

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
    pub value: &'text str,
    pub args: Vec<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub enum Expression<'text> {
    Constant(ConstantExpression<'text>),
    Nary(NaryExpression<'text>),
    Cast(CastExpression<'text>),
}

#[derive(Debug, Clone)]
pub enum Indirection<'text> {
    Index {
        node_id: u32,
        value: Box<Expression<'text>>,
    },
    Bounds {
        node_id: u32,
        lower_bound: Box<Expression<'text>>,
        upper_bound: Box<Expression<'text>>,
    },
}

#[derive(Debug, Clone)]
pub struct QualifiedName<'text> {
    pub catalog: Option<&'text str>,
    pub schema: Option<&'text str>,
    pub relation: Option<&'text str>,
    pub indirection: Option<Indirection<'text>>,
}
