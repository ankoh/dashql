use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
pub enum ConstantExpression<'buf> {
    Null(u32),
    True(u32),
    False(u32),
    String(u32, &'buf str),
}

#[derive(Debug, Clone)]
pub struct UnaryExpression<'buf> {
    pub node_id: u32,
    pub operator: sx::ExpressionOperator,
    pub value: Box<Expression<'buf>>,
    pub postfix: bool,
}

#[derive(Debug, Clone)]
pub struct BinaryExpression<'buf> {
    pub node_id: u32,
    pub operator: sx::ExpressionOperator,
    pub arg0: Box<Expression<'buf>>,
    pub arg1: Box<Expression<'buf>>,
}

#[derive(Debug, Clone)]
pub struct TernaryExpression<'buf> {
    pub node_id: u32,
    pub operator: sx::ExpressionOperator,
    pub arg0: Box<Expression<'buf>>,
    pub arg1: Box<Expression<'buf>>,
    pub arg2: Box<Expression<'buf>>,
}

#[derive(Debug, Clone)]
pub enum Expression<'buf> {
    Constant(ConstantExpression<'buf>),
    Unary(UnaryExpression<'buf>),
    Binary(BinaryExpression<'buf>),
    Ternary(TernaryExpression<'buf>),
}

#[derive(Debug, Clone)]
pub enum Indirection<'buf> {
    Index {
        node_id: u32,
        value: Box<Expression<'buf>>,
    },
    Bounds {
        node_id: u32,
        lower_bound: Box<Expression<'buf>>,
        upper_bound: Box<Expression<'buf>>,
    },
}

#[derive(Debug, Clone)]
pub struct QualifiedName<'buf> {
    pub node_id: u32,
    pub catalog: Option<&'buf str>,
    pub schema: Option<&'buf str>,
    pub relation: Option<&'buf str>,
    pub indirection: Option<Indirection<'buf>>,
}
