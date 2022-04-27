use super::ast_node::*;
use super::dson::DsonValue;
use super::sql_nodes::*;
use std::error::Error;

pub(super) fn read_expr<'text, 'arena>(node: &'arena ASTNode<'text, 'arena>) -> Expression<'text, 'arena> {
    match node {
        ASTNode::Boolean(true) => Expression::True,
        ASTNode::Boolean(false) => Expression::False,
        ASTNode::Expression(e) => e.clone(),
        ASTNode::FunctionExpression(f) => Expression::FunctionCall(f),
        ASTNode::StringRef(s) => Expression::StringRef(s),
        ASTNode::ColumnRef(c) => Expression::ColumnRef(c),
        ASTNode::TypecastExpression(ref c) => Expression::Typecast(c),
        _ => {
            debug_assert!(false, format!("invalid expression node: {:?}", node));
            Expression::Null
        }
    }
}

pub(super) fn read_exprs<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &'arena [ASTNode<'text, 'arena>],
) -> &'arena [Expression<'text, 'arena>] {
    let mut exprs = alloc.alloc_slice_fill_default(nodes.len());
    for i in 0..nodes.len() {
        exprs[i] = read_expr(&nodes[i]);
    }
    exprs
}

pub(super) fn read_name<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &'arena [ASTNode<'text, 'arena>],
) -> NamePath<'text, 'arena> {
    let mut path = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        path[i] = match n {
            ASTNode::StringRef(s) => Indirection::Name(s),
            ASTNode::Indirection(indirection) => indirection.clone(),
            _ => {
                debug_assert!(false, format!("invalid name element: {:?}", n));
                Indirection::default()
            }
        }
    }
    path
}

pub(super) fn read_ordering<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &'arena [ASTNode<'text, 'arena>],
) -> &'arena [OrderSpecification<'text, 'arena>] {
    let mut ordering = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        ordering[i] = match n {
            ASTNode::OrderSpecification(o) => o.clone(),
            _ => {
                debug_assert!(false, format!("invalid order specification: {:?}", n));
                OrderSpecification::default()
            }
        }
    }
    ordering
}

pub(super) fn read_array_bounds<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &'arena [ASTNode<'text, 'arena>],
) -> &'arena [ArrayBound<'text>] {
    let mut bounds = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        bounds[i] = match n {
            ASTNode::Null => ArrayBound::Empty,
            ASTNode::StringRef(s) => ArrayBound::Index(s),
            _ => {
                debug_assert!(false, format!("invalid array bounds: {:?}", n));
                ArrayBound::default()
            }
        }
    }
    bounds
}

pub(super) fn read_dson<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    node: &'arena ASTNode<'text, 'arena>,
) -> Result<DsonValue<'text, 'arena>, Box<dyn Error + Send + Sync>> {
    let value = match node {
        ASTNode::Dson(value) => value.clone(),
        ASTNode::Array(nodes) => {
            let mut elements = alloc.alloc_slice_fill_default(nodes.len());
            for (i, n) in nodes.iter().enumerate() {
                elements[i] = read_dson(alloc, node)?;
            }
            DsonValue::Array(elements)
        }
        ASTNode::Expression(e) => DsonValue::Expression(e.clone()),
        ASTNode::StringRef(s) => DsonValue::Expression(Expression::StringRef(s)),
        ASTNode::FunctionExpression(f) => DsonValue::Expression(Expression::FunctionCall(f)),
        e => DsonValue::Expression(read_expr(e)),
    };
    Ok(value)
}
