use super::node::*;
use super::sql_nodes::*;
use crate::proto::syntax as sx;

fn as_expr<'text>(node: Node<'text>) -> Expression<'text> {
    match node {
        Node::StringRef(s) => Expression::Constant(ConstantExpression::String(s)),
        _ => Expression::Constant(ConstantExpression::Null),
    }
}

pub fn translate_ast<'text, 'ast>(text: &'text str, ast: sx::Program<'ast>) {
    let statements = ast.statements().unwrap_or_default();
    let ast_nodes = ast.nodes().unwrap_or_default();

    // Collect children
    let mut children: Vec<Vec<(usize, Node<'text>)>> = Vec::new();
    children.resize(ast_nodes.len(), Vec::new());

    // Do a postorder dfs traversal
    let mut out: Vec<Node<'text>> = Vec::new();
    let mut pending: Vec<(usize, bool)> = Vec::new();
    for statement in statements.iter() {
        pending.push((statement.root_node() as usize, false));

        while !pending.is_empty() {
            let (ti, visited) = pending.last().copied().unwrap();
            let t = ast_nodes[ti as usize];

            // Not visited yet?
            // Mark as visited and push all children to the stack.
            if !visited {
                pending.last_mut().unwrap().1 = true;
                if t.node_type() == sx::NodeType::ARRAY
                    || t.node_type() > sx::NodeType::OBJECT_KEYS_
                {
                    for i in 0..t.children_count() {
                        pending.push(((t.children_begin_or_value() + i) as usize, false));
                    }
                }
                continue;
            }

            // Translate the node
            let translated = match t.node_type() {
                sx::NodeType::NONE => Node::Null,
                sx::NodeType::BOOL => Node::Boolean(t.children_begin_or_value() != 0),
                sx::NodeType::UI32 => Node::UInt32(t.children_begin_or_value()),
                sx::NodeType::UI32_BITMAP => Node::UInt32Bitmap(t.children_begin_or_value()),
                sx::NodeType::STRING_REF => Node::StringRef(
                    &text[(t.location().offset() as usize)
                        ..((t.location().offset() + t.location().length()) as usize)],
                ),
                sx::NodeType::ARRAY => {
                    let mapped: Vec<Node<'text>> =
                        children[ti as usize].drain(..).map(|(_, n)| n).collect();
                    Node::Array(mapped)
                }
                sx::NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                    let mut operator: sx::ExpressionOperator = sx::ExpressionOperator::PLUS;
                    let mut args = Vec::new();
                    let mut postfix = false;
                    for (child_node_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_node_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (sx::AttributeKey::SQL_EXPRESSION_ARG0, n) => args.push(as_expr(n)),
                            (sx::AttributeKey::SQL_EXPRESSION_ARG1, n) => args.push(as_expr(n)),
                            (sx::AttributeKey::SQL_EXPRESSION_ARG2, n) => args.push(as_expr(n)),
                            (sx::AttributeKey::SQL_EXPRESSION_POSTFIX, Node::Boolean(p)) => {
                                postfix = p
                            }
                            (
                                sx::AttributeKey::SQL_EXPRESSION_OPERATOR,
                                Node::ExpressionOperator(op),
                            ) => {
                                operator = op;
                            }
                            _ => {}
                        }
                    }
                    let exp = Expression::NaryExpression(NaryExpression {
                        operator,
                        args,
                        postfix,
                    });
                    Node::Expression(exp)
                }
                _ => panic!("node translation not implemented"),
            };

            // Stack empty?
            // Returned to statement root then, otherwise push as child
            pending.pop();
            if pending.is_empty() {
                out.push(translated);
            } else {
                debug_assert!(t.parent() != u32::MAX);
                debug_assert!((t.parent() as usize) < ast_nodes.len());
                children[t.parent() as usize].push((ti, translated));
            }
        }
    }
}
