use super::ast_node::ASTNode;
use super::sql_nodes::*;
use crate::error::RawError;
use dashql_proto::syntax as sx;
use std::error::Error;
use sx::AttributeKey as Key;

macro_rules! unexpected_attribute {
    ($key:expr) => {
        return Err(RawError::from(format!(
            "unexpected attribute key: {}",
            $key.variant_name().unwrap_or(&format!("{}", $key.0))
        ))
        .boxed())
    };
}

pub trait ASTTranslation<'text, 'ast> {
    fn from_ast(
        ast: &'ast [sx::Node],
        children: &mut Vec<(usize, ASTNode<'text>)>,
    ) -> Result<ASTNode<'text>, Box<dyn Error + Send + Sync>>;
}

impl<'text, 'ast> ASTTranslation<'text, 'ast> for GenericType<'text> {
    fn from_ast(
        ast: &'ast [sx::Node],
        children: &mut Vec<(usize, ASTNode<'text>)>,
    ) -> Result<ASTNode<'text>, Box<dyn Error + Send + Sync>> {
        let mut name = None;
        let mut modifiers = Vec::new();
        for (ci, c) in children.drain(..) {
            let k = sx::AttributeKey(ast[ci].attribute_key());
            match (k, c) {
                (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s)) => name = Some(s),
                (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a)) => modifiers = read_exprs(a)?,
                _ => unexpected_attribute!(k),
            }
        }
        Ok(ASTNode::GenericType(GenericType {
            name: name.unwrap_or_default(),
            modifiers,
        }))
    }
}

fn read_expr<'text>(
    node: ASTNode<'text>,
) -> Result<Expression<'text>, Box<dyn Error + Send + Sync>> {
    let n = match node {
        ASTNode::StringRef(s) => Expression::StringRef(s),
        _ => return Err(RawError::from(format!("invalid expression node: {:?}", node)).boxed()),
    };
    Ok(n)
}

fn read_exprs<'text>(
    nodes: Vec<ASTNode<'text>>,
) -> Result<Vec<Expression<'text>>, Box<dyn Error + Send + Sync>> {
    let mut exprs = Vec::with_capacity(nodes.len());
    for n in nodes {
        exprs.push(read_expr(n)?);
    }
    Ok(exprs)
}
