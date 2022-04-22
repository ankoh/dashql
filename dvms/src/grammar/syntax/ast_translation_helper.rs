use super::ast_node::*;
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
        ASTNode::StringRef(s) => Expression::StringRef(s),
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
            ASTNode::StringRef(s) => path.push(NamePathElement::Component(s)),
            ASTNode::IndirectionIndex(i) => path.push(NamePathElement::IndirectionIndex(i)),
            ASTNode::IndirectionBounds(b) => path.push(NamePathElement::IndirectionBounds(b)),
            _ => unexpected!("name element", n),
        }
    }
    Ok(NamePath { elements: path })
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
