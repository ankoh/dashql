use super::ast_node::*;
use super::dson::DsonValue;
use super::sql_nodes::*;

pub(super) fn read_expr<'text, 'arena>(node: &'arena ASTNode<'text, 'arena>) -> Expression<'text, 'arena> {
    match node {
        ASTNode::Boolean(true) => Expression::True,
        ASTNode::Boolean(false) => Expression::False,
        ASTNode::Expression(ref e) => e.clone(),
        ASTNode::FunctionExpression(ref f) => Expression::FunctionCall(f),
        ASTNode::StringRef(ref s) => Expression::StringRef(s.clone()),
        ASTNode::ColumnRef(ref c) => Expression::ColumnRef(c.clone()),
        ASTNode::TypecastExpression(ref c) => Expression::Typecast(c),
        _ => {
            log::warn!("invalid expression node: {:?}", node);
            Expression::Null
        }
    }
}

pub(super) fn read_exprs<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &[&'arena ASTNode<'text, 'arena>],
) -> &'arena [Expression<'text, 'arena>] {
    let exprs = alloc.alloc_slice_fill_default(nodes.len());
    for i in 0..nodes.len() {
        exprs[i] = read_expr(&nodes[i]);
    }
    exprs
}

pub(super) fn read_name<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &[&'arena ASTNode<'text, 'arena>],
) -> NamePath<'text, 'arena> {
    let path = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        path[i] = match n {
            ASTNode::StringRef(s) => Indirection::Name(s),
            ASTNode::Indirection(indirection) => indirection.clone(),
            _ => {
                log::warn!("invalid name element: {:?}", n);
                Indirection::default()
            }
        }
    }
    path
}

pub(super) fn read_array_bounds<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &[&'arena ASTNode<'text, 'arena>],
) -> &'arena [ArrayBound<'text>] {
    let bounds = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        bounds[i] = match n {
            ASTNode::Null => ArrayBound::Empty,
            ASTNode::StringRef(s) => ArrayBound::Index(s),
            _ => {
                log::warn!("invalid name element: {:?}", n);
                ArrayBound::Empty
            }
        }
    }
    bounds
}

pub(super) fn read_dson<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    node: &'arena ASTNode<'text, 'arena>,
) -> DsonValue<'text, 'arena> {
    match node {
        ASTNode::Dson(value) => value.clone(),
        ASTNode::Array(nodes) => {
            let elements = alloc.alloc_slice_fill_default(nodes.len());
            for (i, n) in nodes.iter().enumerate() {
                elements[i] = read_dson(alloc, n);
            }
            DsonValue::Array(elements)
        }
        ASTNode::Expression(e) => DsonValue::Expression(e.clone()),
        ASTNode::StringRef(s) => DsonValue::Expression(Expression::StringRef(s)),
        ASTNode::FunctionExpression(f) => DsonValue::Expression(Expression::FunctionCall(f)),
        e => DsonValue::Expression(read_expr(e)),
    }
}
