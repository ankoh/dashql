use super::ast_node::*;
use super::sql_nodes::*;
use crate::error::RawError;
use std::error::Error;

pub(super) fn read_expr<'text>(
    node: ASTNode<'text>,
) -> Result<Expression<'text>, Box<dyn Error + Send + Sync>> {
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

pub(super) fn read_name<'text>(elements: Vec<ASTNode<'text>>) -> NamePath<'text> {
    let mut path = Vec::with_capacity(elements.len());
    for e in elements {
        match e {
            ASTNode::StringRef(s) => path.push(NamePathElement::Component(s)),
            ASTNode::IndirectionIndex(i) => path.push(NamePathElement::IndirectionIndex(i)),
            ASTNode::IndirectionBounds(b) => path.push(NamePathElement::IndirectionBounds(b)),
            _ => continue,
        }
    }
    NamePath { elements: path }
}

pub(super) fn read_ordering<'text>(specs: Vec<ASTNode<'text>>) -> Vec<OrderSpecification<'text>> {
    let mut ordering = Vec::with_capacity(specs.len());
    for n in specs {
        match n {
            ASTNode::OrderSpecification(o) => ordering.push(o),
            _ => continue,
        }
    }
    ordering
}
