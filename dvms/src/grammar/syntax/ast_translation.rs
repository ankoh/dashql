use super::node::*;
use super::sql_nodes::*;
use crate::proto::syntax as sx;
use sx::AttributeKey as Key;

fn read_expr<'text>(node: Node<'text>) -> Expression<'text> {
    match node {
        Node::StringRef(s) => Expression::StringRef(s),
        _ => Expression::Null,
    }
}

fn read_name<'text>(mut elements: Vec<Node<'text>>) -> NamePath<'text> {
    let mut path = Vec::new();
    for e in elements.drain(..) {
        match e {
            Node::StringRef(s) => path.push(NamePathElement::Component(s)),
            Node::IndirectionIndex(i) => path.push(NamePathElement::IndirectionIndex(i)),
            Node::IndirectionBounds(b) => path.push(NamePathElement::IndirectionBounds(b)),
            _ => continue,
        }
    }
    NamePath { elements: path }
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
                    let mut args = Vec::with_capacity(3);
                    let mut operator: sx::ExpressionOperator = sx::ExpressionOperator::PLUS;
                    let mut postfix = false;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_EXPRESSION_ARG0, n) => args.push(read_expr(n)),
                            (Key::SQL_EXPRESSION_ARG1, n) => args.push(read_expr(n)),
                            (Key::SQL_EXPRESSION_ARG2, n) => args.push(read_expr(n)),
                            (Key::SQL_EXPRESSION_POSTFIX, Node::Boolean(p)) => postfix = p,
                            (Key::SQL_EXPRESSION_OPERATOR, Node::ExpressionOperator(op)) => {
                                operator = op;
                            }
                            _ => {}
                        }
                    }
                    Node::Expression(Expression::Nary(NaryExpression {
                        operator,
                        args,
                        postfix,
                    }))
                }
                sx::NodeType::OBJECT_SQL_CONST_CAST => {
                    let mut cast_type = None;
                    let mut func_name = None;
                    let mut func_args = Vec::new();
                    let mut value = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_CONST_CAST_TYPE, Node::StringRef(t)) => cast_type = Some(t),
                            (Key::SQL_CONST_CAST_VALUE, Node::StringRef(t)) => value = Some(t),
                            (Key::SQL_CONST_CAST_FUNC_NAME, Node::Array(n)) => {
                                func_name = Some(read_name(n));
                            }
                            (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, Node::Array(mut nodes)) => {
                                func_args = nodes.drain(..).map(|n| read_expr(n)).collect();
                            }
                            _ => {}
                        }
                    }
                    Node::Expression(Expression::Cast(CastExpression {
                        cast_type: cast_type.unwrap_or_default(),
                        func_name,
                        func_args,
                        value: value.unwrap_or_default(),
                    }))
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
