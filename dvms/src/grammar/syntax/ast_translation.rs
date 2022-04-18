use super::node::*;
use super::sql_nodes::*;
use crate::proto::syntax as sx;
use sx::AttributeKey as Key;

pub fn translate_ast<'text, 'ast>(text: &'text str, ast: sx::Program<'ast>) -> Vec<Node<'text>> {
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
            let v = t.children_begin_or_value();

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

                sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => {
                    Node::VizComponentType(sx::VizComponentType(v as u8))
                }
                sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE => {
                    Node::InputComponentType(sx::InputComponentType(v as u8))
                }
                sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE => {
                    Node::FetchMethodType(sx::FetchMethodType(v as u8))
                }
                sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => {
                    Node::LoadMethodType(sx::LoadMethodType(v as u8))
                }
                sx::NodeType::ENUM_SQL_TEMP_TYPE => Node::TempType(sx::TempType(v as u8)),
                sx::NodeType::ENUM_SQL_CONST_TYPE => Node::ConstType(sx::AConstType(v as u8)),
                sx::NodeType::ENUM_SQL_CHARACTER_TYPE => {
                    Node::CharacterType(sx::CharacterType(v as u8))
                }
                sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => {
                    Node::ExpressionOperator(sx::ExpressionOperator(v as u8))
                }
                sx::NodeType::ENUM_SQL_ORDER_DIRECTION => {
                    Node::OrderDirection(sx::OrderDirection(v as u8))
                }
                sx::NodeType::ENUM_SQL_ORDER_NULL_RULE => {
                    Node::OrderNullRule(sx::OrderNullRule(v as u8))
                }
                sx::NodeType::ENUM_SQL_COMBINE_MODIFIER => {
                    Node::CombineModifier(sx::CombineModifier(v as u8))
                }
                sx::NodeType::ENUM_SQL_COMBINE_OPERATION => {
                    Node::CombineOperation(sx::CombineOperation(v as u8))
                }
                sx::NodeType::ENUM_SQL_NUMERIC_TYPE => Node::NumericType(sx::NumericType(v as u8)),
                sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => {
                    Node::WindowBoundMode(sx::WindowBoundMode(v as u8))
                }
                sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => {
                    Node::WindowRangeMode(sx::WindowRangeMode(v as u8))
                }
                sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => {
                    Node::WindowExclusionMode(sx::WindowExclusionMode(v as u8))
                }
                sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => {
                    Node::WindowBoundDirection(sx::WindowBoundDirection(v as u8))
                }
                sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION => {
                    Node::OnCommitOption(sx::OnCommitOption(v as u8))
                }
                sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => {
                    Node::ConstraintAttribute(sx::ConstraintAttribute(v as u8))
                }
                sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => {
                    Node::ColumnConstraint(sx::ColumnConstraint(v as u8))
                }
                sx::NodeType::ENUM_SQL_INTERVAL_TYPE => {
                    Node::IntervalType(sx::IntervalType(v as u8))
                }
                sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => {
                    Node::SubqueryQuantifier(sx::SubqueryQuantifier(v as u8))
                }
                sx::NodeType::ENUM_SQL_TRIM_TARGET => {
                    Node::TrimDirection(sx::TrimDirection(v as u8))
                }
                sx::NodeType::ENUM_SQL_EXTRACT_TARGET => {
                    Node::ExtractTarget(sx::ExtractTarget(v as u8))
                }
                sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => {
                    Node::RowLockingBlockBehavior(sx::RowLockingBlockBehavior(v as u8))
                }
                sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => {
                    Node::RowLockingStrength(sx::RowLockingStrength(v as u8))
                }

                sx::NodeType::ENUM_SQL_JOIN_TYPE => Node::JoinType(sx::JoinType(v as u8)),

                sx::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                    let mut name = None;
                    let mut modifiers = Vec::new();
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_GENERIC_TYPE_NAME, Node::StringRef(s)) => name = Some(s),
                            (Key::SQL_GENERIC_TYPE_MODIFIERS, Node::Array(a)) => {
                                modifiers = read_exprs(a)
                            }
                            _ => unexpected(key),
                        }
                    }
                    Node::GenericType(GenericType {
                        name: name.unwrap_or_default(),
                        modifiers,
                    })
                }
                sx::NodeType::OBJECT_SQL_ORDER => {
                    let mut value = None;
                    let mut direction = None;
                    let mut null_rule = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_ORDER_VALUE, n) => value = Some(read_expr(n)),
                            (Key::SQL_ORDER_DIRECTION, Node::OrderDirection(d)) => {
                                direction = Some(d)
                            }
                            (Key::SQL_ORDER_NULLRULE, Node::OrderNullRule(n)) => {
                                null_rule = Some(n)
                            }
                            _ => unexpected(key),
                        }
                    }
                    Node::OrderSpecification(OrderSpecification {
                        value: Box::new(value.unwrap_or(Expression::Null)),
                        direction,
                        null_rule,
                    })
                }
                sx::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                    let mut type_ = None;
                    let mut precision = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_INTERVAL_TYPE, Node::IntervalType(t)) => type_ = Some(t),
                            (Key::SQL_INTERVAL_PRECISION, Node::StringRef(s)) => {
                                precision = Some(s)
                            }
                            _ => unexpected(key),
                        }
                    }
                    Node::IntervalSpecification(IntervalSpecification::Type {
                        type_: type_.unwrap_or_default(),
                        precision: precision,
                    })
                }
                sx::NodeType::OBJECT_SQL_RESULT_TARGET => {
                    let mut value = None;
                    let mut alias = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_RESULT_TARGET_VALUE, n) => value = Some(read_expr(n)),
                            (Key::SQL_RESULT_TARGET_NAME, Node::StringRef(s)) => alias = Some(s),
                            _ => unexpected(key),
                        }
                    }
                    Node::ResultTarget(ResultTarget::Value {
                        value: Box::new(value.unwrap_or(Expression::Null)),
                        alias,
                    })
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
                            _ => unexpected(key),
                        }
                    }
                    Node::Expression(Expression::Nary(NaryExpression {
                        operator,
                        args,
                        postfix,
                    }))
                }
                sx::NodeType::OBJECT_SQL_TABLE_SAMPLE => {
                    let mut function = None;
                    let mut count = None;
                    let mut repeat = None;
                    let mut seed = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_SAMPLE_FUNCTION, Node::StringRef(s)) => function = Some(s),
                            (Key::SQL_SAMPLE_REPEAT, Node::StringRef(s)) => repeat = Some(s),
                            (Key::SQL_SAMPLE_SEED, Node::StringRef(s)) => seed = Some(s),
                            (Key::SQL_SAMPLE_COUNT, Node::StringRef(s)) => count = Some(s),
                            _ => unexpected(key),
                        }
                    }
                    Node::TableSample(TableSample {
                        function,
                        count,
                        repeat,
                        seed,
                    })
                }
                sx::NodeType::OBJECT_SQL_CONST_CAST => {
                    let mut cast_type = None;
                    let mut func_name = None;
                    let mut func_args = Vec::new();
                    let mut func_arg_ordering = Vec::new();
                    let mut interval = None;
                    let mut value = None;
                    for (child_id, translated) in children[ti as usize].drain(..) {
                        let key = ast_nodes[child_id].attribute_key();
                        match (sx::AttributeKey(key), translated) {
                            (Key::SQL_CONST_CAST_TYPE, Node::StringRef(t)) => cast_type = Some(t),
                            (Key::SQL_CONST_CAST_VALUE, Node::StringRef(t)) => value = Some(t),
                            (Key::SQL_CONST_CAST_FUNC_NAME, Node::Array(n)) => {
                                func_name = Some(read_name(n));
                            }
                            (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, Node::Array(nodes)) => {
                                func_args = read_exprs(nodes);
                            }
                            (Key::SQL_CONST_CAST_FUNC_ARGS_ORDER, Node::Array(nodes)) => {
                                func_arg_ordering = read_ordering(nodes);
                            }
                            (Key::SQL_CONST_CAST_INTERVAL, Node::IntervalSpecification(i)) => {
                                interval = Some(i);
                            }
                            (Key::SQL_CONST_CAST_INTERVAL, Node::StringRef(s)) => {
                                interval = Some(IntervalSpecification::Raw(s));
                            }
                            _ => unexpected(key),
                        }
                    }
                    Node::Expression(Expression::ConstCast(ConstCastExpression {
                        cast_type: cast_type.unwrap_or_default(),
                        func_name,
                        func_args,
                        func_arg_ordering,
                        value: value.unwrap_or_default(),
                        interval,
                    }))
                }
                sx::NodeType::OBJECT_SQL_SELECT => {}
                t => panic!("node translation not implemented for: {:?}", t),
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
    out
}

fn read_expr<'text>(node: Node<'text>) -> Expression<'text> {
    match node {
        Node::StringRef(s) => Expression::StringRef(s),
        _ => Expression::Null,
    }
}

fn read_exprs<'text>(nodes: Vec<Node<'text>>) -> Vec<Expression<'text>> {
    let mut exprs = Vec::with_capacity(nodes.len());
    for n in nodes {
        exprs.push(read_expr(n));
    }
    exprs
}

fn read_name<'text>(elements: Vec<Node<'text>>) -> NamePath<'text> {
    let mut path = Vec::with_capacity(elements.len());
    for e in elements {
        match e {
            Node::StringRef(s) => path.push(NamePathElement::Component(s)),
            Node::IndirectionIndex(i) => path.push(NamePathElement::IndirectionIndex(i)),
            Node::IndirectionBounds(b) => path.push(NamePathElement::IndirectionBounds(b)),
            _ => continue,
        }
    }
    NamePath { elements: path }
}

fn unexpected(key: u16) {}

fn read_ordering<'text>(specs: Vec<Node<'text>>) -> Vec<OrderSpecification<'text>> {
    let mut ordering = Vec::with_capacity(specs.len());
    for n in specs {
        match n {
            Node::OrderSpecification(o) => ordering.push(o),
            _ => continue,
        }
    }
    ordering
}
