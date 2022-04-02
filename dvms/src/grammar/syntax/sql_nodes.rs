use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
pub enum ConstantExpression<'text> {
    Null(u32),
    True(u32),
    False(u32),
    String(u32, &'text str),
}

#[derive(Debug, Clone)]
pub struct UnaryExpression<'text> {
    pub operator: sx::ExpressionOperator,
    pub value: Box<Expression<'text>>,
    pub postfix: bool,
}

#[derive(Debug, Clone)]
pub struct BinaryExpression<'text> {
    pub operator: sx::ExpressionOperator,
    pub arg0: Box<Expression<'text>>,
    pub arg1: Box<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub struct TernaryExpression<'text> {
    pub operator: sx::ExpressionOperator,
    pub arg0: Box<Expression<'text>>,
    pub arg1: Box<Expression<'text>>,
    pub arg2: Box<Expression<'text>>,
}

#[derive(Debug, Clone)]
pub enum Expression<'text> {
    Constant(ConstantExpression<'text>),
    Unary(UnaryExpression<'text>),
    Binary(BinaryExpression<'text>),
    Ternary(TernaryExpression<'text>),
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
