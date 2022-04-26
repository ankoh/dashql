use super::ast_node::*;
use super::dson::DsonValue;
use super::sql_nodes::*;
use crate::error::RawError;
use std::error::Error;

macro_rules! unexpected {
    ($what:expr, $value:expr) => {
        return Err(RawError::from(format!("unexpected {}: {:?}", $what, $value)).boxed())
    };
}

pub(super) fn read_expr<'text>(node: ASTNode<'text>) -> Result<Expression<'text>, Box<dyn Error + Send + Sync>> {
    let n = match node {
        ASTNode::Boolean(true) => Expression::True,
        ASTNode::Boolean(false) => Expression::False,
        ASTNode::Expression(e) => e,
        ASTNode::FunctionExpression(f) => Expression::FunctionCall(f),
        ASTNode::StringRef(s) => Expression::StringRef(s),
        ASTNode::ColumnRef(c) => Expression::ColumnRef(c),
        ASTNode::TypecastExpression(c) => Expression::Typecast(c),
        _ => return Err(RawError::from(format!("invalid expression node: {:?}", node)).boxed()),
    };
    Ok(n)
}

pub(super) fn read_exprs<'text>(
    nodes: Vec<ASTNode<'text>>,
) -> Result<Vec<Expression<'text>>, Box<dyn Error + Send + Sync>> {
    let mut exprs = Vec::with_capacity(nodes.len());
    for n in nodes {
        exprs.push(read_expr(n)?);
    }
    Ok(exprs)
}

pub(super) fn read_name<'text>(nodes: Vec<ASTNode<'text>>) -> Result<NamePath<'text>, Box<dyn Error + Send + Sync>> {
    let mut path = Vec::with_capacity(nodes.len());
    for n in nodes {
        match n {
            ASTNode::StringRef(s) => path.push(Indirection::Name(s)),
            ASTNode::Indirection(i) => path.push(i),
            _ => unexpected!("name element", n),
        }
    }
    Ok(path)
}

pub(super) fn read_ordering<'text>(
    nodes: Vec<ASTNode<'text>>,
) -> Result<Vec<OrderSpecification<'text>>, Box<dyn Error + Send + Sync>> {
    let mut ordering = Vec::with_capacity(nodes.len());
    for n in nodes {
        match n {
            ASTNode::OrderSpecification(o) => ordering.push(o),
            _ => unexpected!("order specification", n),
        }
    }
    Ok(ordering)
}

pub(super) fn read_array_bounds<'text>(
    nodes: Vec<ASTNode<'text>>,
) -> Result<Vec<ArrayBound<'text>>, Box<dyn Error + Send + Sync>> {
    let mut bounds = Vec::with_capacity(nodes.len());
    for n in nodes {
        match n {
            ASTNode::Null => bounds.push(ArrayBound::Empty),
            ASTNode::StringRef(s) => bounds.push(ArrayBound::Index(s)),
            _ => unexpected!("array bound", n),
        }
    }
    Ok(bounds)
}

pub(super) fn read_dson<'text>(node: ASTNode<'text>) -> Result<DsonValue<'text>, Box<dyn Error + Send + Sync>> {
    let value = match node {
        ASTNode::Dson(value) => value,
        ASTNode::Array(nodes) => {
            let mut elements = Vec::new();
            for node in nodes {
                elements.push(read_dson(node)?);
            }
            DsonValue::Array(elements)
        }
        ASTNode::Expression(e) => DsonValue::Expression(e),
        ASTNode::StringRef(s) => DsonValue::Expression(Expression::StringRef(s)),
        ASTNode::FunctionExpression(f) => DsonValue::Expression(Expression::FunctionCall(f)),
        e => DsonValue::Expression(read_expr(e)?),
    };
    Ok(value)
}
