use super::ast_node::*;
use super::ast_translation_helper::*;
use super::dashql_nodes::FetchStatement;
use super::program::*;
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

macro_rules! map_enum {
    ($name:ident, $v:expr) => {
        ASTNode::$name(sx::$name($v as u8))
    };
}

fn translate_statement<'text, 'ast>(
    text: &'text str,
    ast: &'ast [sx::Node],
    ast_statement: sx::Statement<'ast>,
    children: &mut Vec<Vec<(usize, ASTNode<'text>)>>,
) -> Result<Statement<'text>, Box<dyn Error + Send + Sync>> {
    // Do a postorder dfs traversal
    let mut pending: Vec<(usize, bool)> = Vec::new();
    pending.push((ast_statement.root_node() as usize, false));

    let mut last: Option<ASTNode<'text>> = None;
    while !pending.is_empty() {
        let (ti, visited) = pending.last().copied().unwrap();
        let ti = ti as usize;
        let t = ast[ti];
        let v = t.children_begin_or_value();

        // Not visited yet?
        // Mark as visited and push all children to the stack.
        if !visited {
            pending.last_mut().unwrap().1 = true;
            if t.node_type() == sx::NodeType::ARRAY || t.node_type() > sx::NodeType::OBJECT_KEYS_ {
                let end = t.children_begin_or_value() + t.children_count();
                for i in 0..t.children_count() {
                    pending.push(((end - i - 1) as usize, false));
                }
            }
            continue;
        }

        // Translate the node
        let c = match t.node_type() {
            sx::NodeType::NONE => ASTNode::Null,
            sx::NodeType::BOOL => ASTNode::Boolean(t.children_begin_or_value() != 0),
            sx::NodeType::UI32 => ASTNode::UInt32(t.children_begin_or_value()),
            sx::NodeType::UI32_BITMAP => ASTNode::UInt32Bitmap(t.children_begin_or_value()),
            sx::NodeType::STRING_REF => ASTNode::StringRef(
                &text[(t.location().offset() as usize)
                    ..((t.location().offset() + t.location().length()) as usize)],
            ),
            sx::NodeType::ARRAY => {
                let mapped: Vec<ASTNode<'text>> = children[ti].drain(..).map(|(_, n)| n).collect();
                ASTNode::Array(mapped)
            }

            sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => map_enum!(VizComponentType, v),
            sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE => map_enum!(InputComponentType, v),
            sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE => map_enum!(FetchMethodType, v),
            sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => map_enum!(LoadMethodType, v),
            sx::NodeType::ENUM_SQL_TEMP_TYPE => map_enum!(TempType, v),
            sx::NodeType::ENUM_SQL_CONST_TYPE => ASTNode::ConstType(sx::AConstType(v as u8)),
            sx::NodeType::ENUM_SQL_CHARACTER_TYPE => map_enum!(CharacterType, v),
            sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => map_enum!(ExpressionOperator, v),
            sx::NodeType::ENUM_SQL_ORDER_DIRECTION => map_enum!(OrderDirection, v),
            sx::NodeType::ENUM_SQL_ORDER_NULL_RULE => map_enum!(OrderNullRule, v),
            sx::NodeType::ENUM_SQL_COMBINE_MODIFIER => map_enum!(CombineModifier, v),
            sx::NodeType::ENUM_SQL_COMBINE_OPERATION => map_enum!(CombineOperation, v),
            sx::NodeType::ENUM_SQL_NUMERIC_TYPE => map_enum!(NumericType, v),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => map_enum!(WindowBoundMode, v),
            sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => map_enum!(WindowRangeMode, v),
            sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => map_enum!(WindowExclusionMode, v),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => map_enum!(WindowBoundDirection, v),
            sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION => map_enum!(OnCommitOption, v),
            sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => map_enum!(ConstraintAttribute, v),
            sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => map_enum!(ColumnConstraint, v),
            sx::NodeType::ENUM_SQL_INTERVAL_TYPE => map_enum!(IntervalType, v),
            sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => map_enum!(SubqueryQuantifier, v),
            sx::NodeType::ENUM_SQL_TRIM_TARGET => map_enum!(TrimDirection, v),
            sx::NodeType::ENUM_SQL_EXTRACT_TARGET => map_enum!(ExtractTarget, v),
            sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => {
                map_enum!(RowLockingBlockBehavior, v)
            }
            sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => map_enum!(RowLockingStrength, v),
            sx::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => map_enum!(SampleCountUnit, v),
            sx::NodeType::ENUM_SQL_JOIN_TYPE => ASTNode::JoinType(sx::JoinType(v as u8)),

            sx::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                let mut name = None;
                let mut modifiers = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = sx::AttributeKey(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s)) => name = Some(s),
                        (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a)) => {
                            modifiers = read_exprs(a)?
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::GenericType(GenericType {
                    name: name.unwrap_or_default(),
                    modifiers,
                })
            }
            sx::NodeType::OBJECT_SQL_ORDER => {
                let mut value = None;
                let mut direction = None;
                let mut null_rule = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_ORDER_VALUE, n) => value = Some(read_expr(n)?),
                        (Key::SQL_ORDER_DIRECTION, ASTNode::OrderDirection(d)) => {
                            direction = Some(d)
                        }
                        (Key::SQL_ORDER_NULLRULE, ASTNode::OrderNullRule(n)) => null_rule = Some(n),
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::OrderSpecification(OrderSpecification {
                    value: Box::new(value.unwrap_or(Expression::Null)),
                    direction,
                    null_rule,
                })
            }
            sx::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                let mut type_ = None;
                let mut precision = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_INTERVAL_TYPE, ASTNode::IntervalType(t)) => type_ = Some(t),
                        (Key::SQL_INTERVAL_PRECISION, ASTNode::StringRef(s)) => precision = Some(s),
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::IntervalSpecification(IntervalSpecification::Type {
                    type_: type_.unwrap_or_default(),
                    precision: precision,
                })
            }
            sx::NodeType::OBJECT_SQL_RESULT_TARGET => {
                let mut value = None;
                let mut alias = None;
                let mut star = false;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_RESULT_TARGET_STAR, ASTNode::Boolean(true)) => star = true,
                        (Key::SQL_RESULT_TARGET_VALUE, n) => value = Some(read_expr(n)?),
                        (Key::SQL_RESULT_TARGET_NAME, ASTNode::StringRef(s)) => alias = Some(s),
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::ResultTarget(if star {
                    ResultTarget::Star
                } else {
                    ResultTarget::Value {
                        value: Box::new(value.unwrap_or(Expression::Null)),
                        alias,
                    }
                })
            }
            sx::NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                let mut args = Vec::with_capacity(3);
                let mut operator: sx::ExpressionOperator = sx::ExpressionOperator::PLUS;
                let mut postfix = false;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_EXPRESSION_ARG0, n) => args.push(read_expr(n)?),
                        (Key::SQL_EXPRESSION_ARG1, n) => args.push(read_expr(n)?),
                        (Key::SQL_EXPRESSION_ARG2, n) => args.push(read_expr(n)?),
                        (Key::SQL_EXPRESSION_POSTFIX, ASTNode::Boolean(p)) => postfix = p,
                        (Key::SQL_EXPRESSION_OPERATOR, ASTNode::ExpressionOperator(op)) => {
                            operator = op;
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::Expression(Expression::Nary(NaryExpression {
                    operator,
                    args,
                    postfix,
                }))
            }
            sx::NodeType::OBJECT_SQL_TABLEREF_SAMPLE => {
                let mut function = None;
                let mut count = None;
                let mut count_unit = None;
                let mut repeat = None;
                let mut seed = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(s)) => function = Some(s),
                        (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(s)) => repeat = Some(s),
                        (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(s)) => seed = Some(s),
                        (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(v)) => {
                            count = Some(v);
                        }
                        (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u)) => {
                            count_unit = Some(u)
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::TableSample(TableSample {
                    function: function,
                    count: count.unwrap_or_default(),
                    unit: count_unit.unwrap_or(sx::SampleCountUnit::ROWS),
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_CONST_CAST_TYPE, ASTNode::StringRef(t)) => cast_type = Some(t),
                        (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t)) => value = Some(t),
                        (Key::SQL_CONST_CAST_FUNC_NAME, ASTNode::Array(n)) => {
                            func_name = Some(read_name(n));
                        }
                        (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, ASTNode::Array(nodes)) => {
                            func_args = read_exprs(nodes)?;
                        }
                        (Key::SQL_CONST_CAST_FUNC_ARGS_ORDER, ASTNode::Array(nodes)) => {
                            func_arg_ordering = read_ordering(nodes);
                        }
                        (Key::SQL_CONST_CAST_INTERVAL, ASTNode::IntervalSpecification(i)) => {
                            interval = Some(i);
                        }
                        (Key::SQL_CONST_CAST_INTERVAL, ASTNode::StringRef(s)) => {
                            interval = Some(IntervalSpecification::Raw(s));
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::Expression(Expression::ConstCast(ConstCastExpression {
                    cast_type: cast_type.unwrap_or_default(),
                    func_name,
                    func_args,
                    func_arg_ordering,
                    value: value.unwrap_or_default(),
                    interval,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_FETCH => {
                let mut name: Option<NamePath> = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a)) => {
                            name = Some(read_name(a));
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::FetchStatement(FetchStatement {
                    name,
                    fetch_method: None,
                    fetch_from_uri: None,
                })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                let mut name: Option<NamePath> = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_COLUMN_REF_PATH, ASTNode::Array(a)) => {
                            name = Some(read_name(a));
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::ColumnRef(name.unwrap_or_default())
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_ARG => {
                let mut name = None;
                let mut value = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_FUNCTION_ARG_VALUE, ASTNode::StringRef(s)) => name = Some(s),
                        (Key::SQL_FUNCTION_ARG_VALUE, n) => value = Some(read_expr(n)?),
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::FunctionArgument(FunctionArgument {
                    name: name,
                    value: value.unwrap_or(Expression::Null),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let mut func_name = None;
                let mut func_args = Vec::new();
                let mut func_arg_ordering = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s)) => {
                            func_name = Some(s);
                        }
                        (Key::SQL_FUNCTION_ORDER, ASTNode::Array(nodes)) => {
                            func_arg_ordering = read_ordering(nodes);
                        }
                        (Key::SQL_FUNCTION_ARGUMENTS, ASTNode::Array(mut nodes)) => {
                            func_args = nodes
                                .drain(..)
                                .filter_map(|n| match n {
                                    ASTNode::FunctionArgument(t) => Some(t),
                                    _ => None,
                                })
                                .collect();
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::FunctionExpression(FunctionExpression {
                    name: func_name,
                    arguments: func_args,
                    argument_ordering: func_arg_ordering,
                    ..Default::default()
                })
            }
            sx::NodeType::OBJECT_SQL_SELECT => {
                let mut targets = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_SELECT_TARGETS, ASTNode::Array(mut a)) => {
                            targets = a
                                .drain(..)
                                .filter_map(|n| match n {
                                    ASTNode::ResultTarget(t) => Some(t),
                                    _ => None,
                                })
                                .collect();
                        }
                        _ => unexpected_attribute!(k),
                    }
                }
                ASTNode::SelectStatement(SelectStatement {
                    all: false,
                    targets: targets,
                    into: None,
                    from: false,
                    where_clause: false,
                    group_by: false,
                    having: false,
                    order_by: false,
                    windows: false,
                    sample: false,
                    row_locking: false,
                })
            }
            t => {
                return Err(RawError::from(format!(
                    "node translation not implemented for: {:?}",
                    t
                ))
                .boxed())
            }
        };

        // Stack empty?
        // Returned to statement root then, otherwise push as c
        pending.pop();
        if !pending.is_empty() {
            debug_assert!(t.parent() != u32::MAX);
            debug_assert!((t.parent() as usize) < ast.len());
            children[t.parent() as usize].push((ti, c));
            continue;
        }
        last = Some(c);
        break;
    }

    // Push statement
    match last {
        Some(ASTNode::SelectStatement(s)) => Ok(Statement::Select(s)),
        _ => {
            return Err(RawError::from(format!("not a valid statement node: {:?}", &last)).boxed())
        }
    }
}

pub fn translate_ast<'text, 'ast>(
    text: &'text str,
    ast_program: sx::Program<'ast>,
) -> Result<Program<'text>, Box<dyn Error + Send + Sync>> {
    let statements = ast_program.statements().unwrap_or_default();
    let ast = ast_program.nodes().unwrap_or_default();

    // Collect children
    let mut children: Vec<Vec<(usize, ASTNode<'text>)>> = Vec::new();
    children.resize(ast.len(), Vec::new());

    // Do a postorder dfs traversal
    let mut stmts: Vec<Statement<'text>> = Vec::new();
    for statement in statements.iter() {
        let stmt = translate_statement(&text, &ast, statement, &mut children)?;
        stmts.push(stmt);
    }
    Ok(Program { statements: stmts })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test {
    use super::super::program::*;
    use super::super::sql_nodes::*;
    use super::translate_ast;
    use std::error::Error;

    fn test_translation(
        text: &str,
        expected: Program<'static>,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let ast_buffer = crate::grammar::parse(text)?;
        let ast = ast_buffer.get_root();
        let translated = translate_ast(text, ast)?;
        assert_eq!(&format!("{:#?}", &translated), &format!("{:#?}", &expected));
        Ok(())
    }

    #[test]
    fn test_select_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_translation(
            "select 1;",
            Program {
                statements: vec![Statement::Select(SelectStatement {
                    targets: vec![ResultTarget::Value {
                        value: Box::new(Expression::StringRef("1")),
                        alias: None,
                    }],
                    ..Default::default()
                })],
            },
        )
    }
}
