use super::ast_cell::*;
use super::ast_list::*;
use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::program::*;
use crate::error::SystemError;
use crate::grammar::ast_nodes_sql::ConstraintAttribute;
use dashql_proto as proto;
use dashql_proto::ExpressionOperator;
use dashql_proto::GroupByItemType;
use proto::AttributeKey as Key;

#[inline(never)]
#[cold]
fn oom() -> ! {
    panic!("out of memory")
}

pub fn deserialize_ast<'a>(
    arena: &'a bumpalo::Bump,
    text: &'a str,
    buffer: proto::Program<'a>,
) -> Result<Program<'a>, SystemError> {
    let buffer_stmts = buffer.statements().unwrap_or_default();
    let buffer_nodes = buffer.nodes().unwrap_or_default();

    // Translate all nodes from left-to-right
    let mut nodes: Vec<ASTNode<'a>> = Vec::new();
    nodes.reserve(buffer_nodes.len());
    for node_id in 0..buffer_nodes.len() {
        let node = buffer_nodes[node_id];
        let node_type = node.node_type();

        // Unpack value and children
        let value = node.children_begin_or_value();
        let children_begin = node.children_begin_or_value() as usize;
        let children_end = children_begin + node.children_count() as usize;
        let children = if children_end <= nodes.len() {
            &nodes[children_begin..children_end]
        } else {
            &[]
        };

        // Helper to read integer as enum
        macro_rules! as_enum {
            ($name:ident) => {
                ASTNode::$name(proto::$name(value as u8))
            };
        }
        // Helper to read attributes
        macro_rules! read_attributes {
            ($($matcher:pat => $result:expr),*) => {
                for i in 0..children.len() {
                    let k = proto::AttributeKey(buffer_nodes[children_begin + i].attribute_key());
                    match (k, &children[i], children_begin + i) {
                        $($matcher => $result),*,
                        (k, _c, ci) => return Err(SystemError::UnexpectedAttribute(Some(ci), node_type, k)),
                    }
                }
            }
        }

        // Helper to unpack nodes
        macro_rules! unpack_nodes_inner {
            ($nodes:expr, $node_id:expr, $ast_node:ident, $out:expr) => {{
                let mut writer = 0;
                for i in 0..$nodes.len() {
                    match &$nodes[i] {
                        ASTNode::$ast_node(inner) => {
                            unsafe {
                                std::ptr::write($out.as_ptr().add(writer), ASTCell::with_node(inner, $node_id + i));
                            }
                            writer += 1;
                        }
                        _ => {
                            debug_assert!(false, "unexpected node: {:?}", &$nodes[i]);
                        }
                    };
                }
                unsafe { std::slice::from_raw_parts_mut($out.as_ptr(), writer) }
            }};
        }
        macro_rules! unpack_nodes {
            ($nodes:expr, $node_id:expr, $ast_node:ident) => {
                unpack_nodes!($nodes, $node_id, $ast_node, $ast_node)
            };
            ($nodes:expr, $node_id:expr, $ast_node:ident, $inner:ident) => {{
                let layout = std::alloc::Layout::array::<ASTCell<&'a $inner>>($nodes.len()).unwrap_or_else(|_| oom());
                let out = arena.alloc_layout(layout).cast::<ASTCell<&'a $inner>>();
                unpack_nodes_inner!($nodes, $node_id, $ast_node, out)
            }};
        }
        macro_rules! unpack_strings {
            ($nodes:expr, $node_id:expr, $ast_node:ident) => {{
                let layout = std::alloc::Layout::array::<ASTCell<&'a str>>($nodes.len()).unwrap_or_else(|_| oom());
                let out = arena.alloc_layout(layout).cast::<ASTCell<&'a str>>();
                unpack_nodes_inner!($nodes, $node_id, $ast_node, out)
            }};
        }
        macro_rules! read_expr {
            ($node:expr) => {{
                read_expr(arena, $node)
            }};
        }

        // Translate the node
        let translated = match node_type {
            proto::NodeType::NONE => ASTNode::Null,
            proto::NodeType::BOOL => ASTNode::Boolean((node.children_begin_or_value() != 0).into()),
            proto::NodeType::UI32 => ASTNode::UInt32(node.children_begin_or_value()),
            proto::NodeType::UI32_BITMAP => ASTNode::UInt32Bitmap(node.children_begin_or_value()),
            proto::NodeType::STRING_REF => ASTNode::StringRef(
                &text[(node.location().offset() as usize)
                    ..((node.location().offset() + node.location().length()) as usize)],
            ),
            proto::NodeType::ARRAY => ASTNode::Array(arena.alloc_slice_copy(children), children_begin),

            proto::NodeType::ENUM_DASHQL_IMPORT_METHOD_TYPE => as_enum!(ImportMethodType),
            proto::NodeType::ENUM_DASHQL_DECLARE_COMPONENT_TYPE => as_enum!(InputComponentType),
            proto::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => as_enum!(LoadMethodType),
            proto::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => as_enum!(VizComponentType),
            proto::NodeType::ENUM_SQL_CHARACTER_TYPE => as_enum!(CharacterType),
            proto::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => as_enum!(ColumnConstraint),
            proto::NodeType::ENUM_SQL_COMBINE_MODIFIER => as_enum!(CombineModifier),
            proto::NodeType::ENUM_SQL_COMBINE_OPERATION => as_enum!(CombineOperation),
            proto::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => as_enum!(ConstraintAttribute),
            proto::NodeType::ENUM_SQL_CONST_TYPE => ASTNode::ConstType(proto::AConstType(value as u8)),
            proto::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => as_enum!(ExpressionOperator),
            proto::NodeType::ENUM_SQL_EXTRACT_TARGET => as_enum!(ExtractTarget),
            proto::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE => as_enum!(GroupByItemType),
            proto::NodeType::ENUM_SQL_INTERVAL_TYPE => as_enum!(IntervalType),
            proto::NodeType::ENUM_SQL_JOIN_TYPE => as_enum!(JoinType),
            proto::NodeType::ENUM_SQL_KEY_ACTION_COMMAND => as_enum!(KeyActionCommand),
            proto::NodeType::ENUM_SQL_KEY_ACTION_TRIGGER => as_enum!(KeyActionTrigger),
            proto::NodeType::ENUM_SQL_KEY_MATCH => as_enum!(KeyMatch),
            proto::NodeType::ENUM_SQL_KNOWN_FUNCTION => as_enum!(KnownFunction),
            proto::NodeType::ENUM_SQL_NUMERIC_TYPE => as_enum!(NumericType),
            proto::NodeType::ENUM_SQL_ON_COMMIT_OPTION => as_enum!(OnCommitOption),
            proto::NodeType::ENUM_SQL_ORDER_DIRECTION => as_enum!(OrderDirection),
            proto::NodeType::ENUM_SQL_ORDER_NULL_RULE => as_enum!(OrderNullRule),
            proto::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => as_enum!(RowLockingBlockBehavior),
            proto::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => as_enum!(RowLockingStrength),
            proto::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => as_enum!(SampleCountUnit),
            proto::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => as_enum!(SubqueryQuantifier),
            proto::NodeType::ENUM_SQL_TABLE_CONSTRAINT => as_enum!(TableConstraint),
            proto::NodeType::ENUM_SQL_TEMP_TYPE => as_enum!(TempType),
            proto::NodeType::ENUM_SQL_TRIM_TARGET => as_enum!(TrimDirection),
            proto::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => as_enum!(WindowBoundDirection),
            proto::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => as_enum!(WindowBoundMode),
            proto::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => as_enum!(WindowExclusionMode),
            proto::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => as_enum!(WindowRangeMode),

            proto::NodeType::OBJECT_SQL_INDIRECTION => {
                let mut value = ASTCell::with_value(Expression::Null);
                let mut path = ASTCell::with_value(NamePath::default());
                read_attributes! {
                    (Key::SQL_INDIRECTION_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_INDIRECTION_PATH, ASTNode::Array(nodes, ni), ci) => path = ASTCell::with_node(read_name(arena, nodes, *ni), ci)
                }
                ASTNode::IndirectionExpression(arena.alloc(IndirectionExpression { value, path }))
            }
            proto::NodeType::OBJECT_SQL_INDIRECTION_INDEX => {
                let mut val = ASTCell::default();
                let mut lb = ASTCell::default();
                let mut ub = ASTCell::default();
                read_attributes! {
                    (Key::SQL_INDIRECTION_INDEX_VALUE, n, ci) => val = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_INDIRECTION_INDEX_LOWER_BOUND, n, ci) => lb = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_INDIRECTION_INDEX_UPPER_BOUND, n, ci) => ub = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::Indirection(if val.get() != Expression::Null {
                    Indirection::Index(arena.alloc(IndirectionIndex { value: val }))
                } else {
                    Indirection::Bounds(arena.alloc(IndirectionBounds {
                        lower_bound: lb,
                        upper_bound: ub,
                    }))
                })
            }
            proto::NodeType::OBJECT_SQL_NUMERIC_TYPE => {
                let mut base = ASTCell::with_value(proto::NumericType::NUMERIC);
                let mut modifiers: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_NUMERIC_TYPE_BASE, ASTNode::NumericType(t), ci) => base = ASTCell::with_node(*t, ci),
                    (Key::SQL_NUMERIC_TYPE_MODIFIERS, ASTNode::Array(nodes, ni), ci) => modifiers = ASTCell::with_node(read_exprs(arena, nodes, *ni), ci)
                }
                ASTNode::NumericTypeSpec(arena.alloc(NumericType { base, modifiers }))
            }
            proto::NodeType::OBJECT_SQL_BIT_TYPE => {
                let mut varying = ASTCell::with_value(false);
                let mut length = ASTCell::default();
                read_attributes! {
                    (Key::SQL_BIT_TYPE_LENGTH, e, ci) => length = ASTCell::with_node(Some(read_expr!(e)), ci),
                    (Key::SQL_BIT_TYPE_VARYING, ASTNode::Boolean(b), ci) => varying = ASTCell::with_node(*b, ci)
                }
                ASTNode::BitTypeSpec(arena.alloc(BitType { varying, length }))
            }
            proto::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                let mut name = ASTCell::default();
                let mut modifiers: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s), ci) => name = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a, ni), ci) => modifiers = ASTCell::with_node(read_exprs(arena, a, *ni), ci)
                }
                ASTNode::GenericTypeSpec(arena.alloc(GenericType {
                    name: name.unwrap_or_default(),
                    modifiers,
                }))
            }
            proto::NodeType::OBJECT_SQL_ORDER => {
                let mut value = ASTCell::default();
                let mut direction = ASTCell::default();
                let mut null_rule = ASTCell::default();
                read_attributes! {
                    (Key::SQL_ORDER_VALUE, n, ci) => value = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::SQL_ORDER_DIRECTION, ASTNode::OrderDirection(d), ci) => direction = ASTCell::with_node(Some(d.clone()), ci),
                    (Key::SQL_ORDER_NULLRULE, ASTNode::OrderNullRule(n), ci) => null_rule = ASTCell::with_node(Some(n.clone()), ci)
                }
                ASTNode::OrderSpecification(arena.alloc(OrderSpecification {
                    value: value.unwrap_or(Expression::Null),
                    direction,
                    null_rule,
                }))
            }
            proto::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                let mut ty = ASTCell::default();
                let mut precision = ASTCell::default();
                read_attributes! {
                    (Key::SQL_INTERVAL_TYPE, ASTNode::IntervalType(t), ci) => ty = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_INTERVAL_PRECISION, ASTNode::StringRef(s), ci) => precision = ASTCell::with_node(Some(s.clone()), ci)
                }
                ASTNode::IntervalSpecification(arena.alloc(IntervalSpecification {
                    interval_type: ty,
                    precision: precision,
                }))
            }
            proto::NodeType::OBJECT_SQL_RESULT_TARGET => {
                let mut value = ASTCell::default();
                let mut alias = ASTCell::default();
                let mut star = false;
                read_attributes! {
                    (Key::SQL_RESULT_TARGET_STAR, ASTNode::Boolean(b), _) => star = *b,
                    (Key::SQL_RESULT_TARGET_VALUE, n, ci) => value = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::SQL_RESULT_TARGET_NAME, ASTNode::StringRef(s), ci) => alias = ASTCell::with_node(Some(s.clone()), ci)
                }
                ASTNode::ResultTarget(arena.alloc(if star {
                    ResultTarget::Star
                } else {
                    ResultTarget::Value {
                        value: value.unwrap_or(Expression::Null),
                        alias,
                    }
                }))
            }
            proto::NodeType::OBJECT_SQL_PARAMETER_REF => {
                let mut prefix = ASTCell::with_value("");
                let mut name = ASTCell::with_value(NamePath::default());
                read_attributes! {
                    (Key::SQL_PARAMETER_PREFIX, ASTNode::StringRef(p), ci) => prefix = ASTCell::with_node(p, ci),
                    (Key::SQL_PARAMETER_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci)
                }
                ASTNode::ParameterRef(arena.alloc(ParameterRef { prefix, name }))
            }
            proto::NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                let mut args: [ASTCell<Expression>; 3] = [
                    ASTCell::with_value(Expression::Null),
                    ASTCell::with_value(Expression::Null),
                    ASTCell::with_value(Expression::Null),
                ];
                let mut operator_name =
                    ASTCell::with_value(ExpressionOperatorName::Known(proto::ExpressionOperator::PLUS));
                let mut postfix = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_EXPRESSION_ARG0, n, ci) => args[0] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_ARG1, n, ci) => args[1] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_ARG2, n, ci) => args[2] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_POSTFIX, ASTNode::Boolean(v), ci) => postfix = ASTCell::with_node(*v, ci),
                    (Key::SQL_EXPRESSION_OPERATOR, n, ci) => operator_name = ASTCell::with_node(read_expression_operator(arena, n), ci)
                }
                let expr = match operator_name.get() {
                    ExpressionOperatorName::Known(proto::ExpressionOperator::AND) => {
                        let list = match (args[0].get(), args[1].get()) {
                            (Expression::Conjunction(left), Expression::Conjunction(right)) => {
                                ASTList::merge(left, right)
                            }
                            (Expression::Conjunction(left), _) => left.append(args[1].clone(), arena),
                            (_, Expression::Conjunction(right)) => right.prepend(args[0].clone(), arena),
                            (_, _) => ASTList::new(args[0].clone(), args[1].clone(), arena),
                        };
                        Expression::Conjunction(arena.alloc(list))
                    }
                    ExpressionOperatorName::Known(proto::ExpressionOperator::OR) => {
                        let list = match (args[0].get(), args[1].get()) {
                            (Expression::Disjunction(left), Expression::Disjunction(right)) => {
                                ASTList::merge(left, right)
                            }
                            (Expression::Disjunction(left), _) => left.append(args[1].clone(), arena),
                            (_, Expression::Disjunction(right)) => right.prepend(args[0].clone(), arena),
                            (_, _) => ASTList::new(args[0].clone(), args[1].clone(), arena),
                        };
                        Expression::Disjunction(arena.alloc(list))
                    }
                    _ => {
                        let iter = args.iter().take_while(|exp| exp.get() != Expression::Null);
                        let arg_count = iter.clone().count();
                        let args = arena.alloc_slice_fill_default(arg_count);
                        for (i, arg) in iter.enumerate() {
                            args[i] = arg.clone();
                        }
                        Expression::Nary(arena.alloc(NaryExpression {
                            operator: operator_name,
                            args,
                            postfix,
                        }))
                    }
                };
                ASTNode::Expression(expr)
            }
            proto::NodeType::OBJECT_SQL_CASE_CLAUSE => {
                let mut when = ASTCell::with_value(Expression::Null);
                let mut then = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_CASE_CLAUSE_WHEN, e, ci) => when = ASTCell::with_node(read_expr!(e), ci),
                    (Key::SQL_CASE_CLAUSE_THEN, e, ci) => then = ASTCell::with_node(read_expr!(e), ci)
                }
                ASTNode::CaseExpressionClause(arena.alloc(CaseExpressionClause { when, then }))
            }
            proto::NodeType::OBJECT_SQL_CASE => {
                let mut argument = ASTCell::default();
                let mut cases: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut default = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CASE_ARGUMENT, n, ci) => argument = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_CASE_CLAUSES, ASTNode::Array(nodes, ni), ci) => cases = ASTCell::with_node(unpack_nodes!(nodes, ni, CaseExpressionClause), ci),
                    (Key::SQL_CASE_DEFAULT, n, ci) => default = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::CaseExpression(arena.alloc(CaseExpression {
                    argument,
                    cases,
                    default,
                }))
            }
            proto::NodeType::OBJECT_SQL_TABLEREF => {
                let mut name = ASTCell::default();
                let mut inherit = ASTCell::with_value(false);
                let mut select = ASTCell::default();
                let mut joined = ASTCell::default();
                let mut func = ASTCell::default();
                let mut alias = ASTCell::default();
                let mut lateral = ASTCell::with_value(false);
                let mut sample = ASTCell::default();
                read_attributes! {
                    (Key::SQL_TABLEREF_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(Some(read_name(arena, n, *ni)), ci),
                    (Key::SQL_TABLEREF_INHERIT, ASTNode::Boolean(v), ci) => inherit = ASTCell::with_node(*v, ci),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::SelectStatement(s), ci) => select = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::JoinedTable(t), ci) => joined = ASTCell::with_node(Some(*t), ci),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::FunctionTable(t), ci) => func = ASTCell::with_node(Some(*t), ci),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::Alias(a), ci) => alias = ASTCell::with_node(Some(*a), ci),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::StringRef(s), ci) => {
                        alias = ASTCell::with_node(Some(arena.alloc(Alias {
                            name: ASTCell::with_node(*s, ci),
                            column_names: ASTCell::with_value(&[]),
                            column_definitions: ASTCell::with_value(&[]),
                        })), ci)
                    },
                    (Key::SQL_TABLEREF_LATERAL, ASTNode::Boolean(v), ci) => lateral = ASTCell::with_node(*v, ci),
                    (Key::SQL_TABLEREF_SAMPLE, ASTNode::TableSample(s), ci) => sample = ASTCell::with_node(Some(*s), ci)
                }
                ASTNode::TableRef(if let Some(_) = select.get() {
                    TableRef::Select(arena.alloc(SelectStatementRef {
                        table: select.unwrap(),
                        alias,
                        sample,
                        lateral,
                    }))
                } else if let Some(_) = joined.get() {
                    TableRef::Join(arena.alloc(JoinedTableRef {
                        table: joined.unwrap(),
                        alias,
                    }))
                } else if let Some(_) = func.get() {
                    TableRef::Function(arena.alloc(FunctionTableRef {
                        table: func.unwrap(),
                        alias,
                        sample,
                        lateral,
                    }))
                } else if let Some(_) = name.get() {
                    TableRef::Relation(arena.alloc(RelationRef {
                        name: name.unwrap(),
                        inherit,
                        alias,
                    }))
                } else {
                    return Err(SystemError::InvalidTableRef(Some(node_id)));
                })
            }
            proto::NodeType::OBJECT_SQL_TABLEREF_SAMPLE => {
                let mut function = ASTCell::default();
                let mut count = ASTCell::default();
                let mut count_unit = ASTCell::default();
                let mut repeat = ASTCell::default();
                let mut seed = ASTCell::default();
                read_attributes! {
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(s), ci) => function = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(s), ci) => repeat = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(s), ci) => seed = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(v), ci) => count = ASTCell::with_node(Some(v.clone()), ci),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u), ci) => count_unit = ASTCell::with_node(Some(u.clone()), ci)
                }
                ASTNode::TableSample(arena.alloc(TableSample {
                    function: function,
                    count: count.unwrap_or_default(),
                    unit: count_unit.unwrap_or(proto::SampleCountUnit::ROWS),
                    repeat,
                    seed,
                }))
            }
            proto::NodeType::OBJECT_SQL_CONST_TYPE_CAST => {
                let mut sql_type = ASTCell::default();
                let mut value = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CONST_CAST_TYPE, ASTNode::SQLType(s), ci) => sql_type = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = ASTCell::with_node(Some(t.clone()), ci)
                }
                let cast = arena.alloc(ConstTypeCastExpression {
                    sql_type: sql_type.unwrap(),
                    value: value.unwrap_or_default(),
                });
                ASTNode::ConstCastExpression(ConstCastExpression::Type(cast))
            }
            proto::NodeType::OBJECT_SQL_CONST_INTERVAL_CAST => {
                let mut interval = ASTCell::default();
                let mut value = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CONST_CAST_INTERVAL, ASTNode::IntervalSpecification(t), ci) => interval = ASTCell::with_node(Some(*t), ci),
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = ASTCell::with_node(Some(t.clone()), ci)
                }
                let cast = arena.alloc(ConstIntervalCastExpression {
                    value: value.unwrap_or_default(),
                    interval: interval.unwrap(),
                });
                ASTNode::ConstCastExpression(ConstCastExpression::Interval(cast))
            }
            proto::NodeType::OBJECT_SQL_CONST_FUNCTION_CAST => {
                let mut func_name = ASTCell::default();
                let mut func_args: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut func_arg_ordering: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut value = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_CONST_CAST_FUNC_NAME, ASTNode::Array(n, ni), ci) => func_name = ASTCell::with_node(Some(read_name(arena, n, *ni)), ci),
                    (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, ASTNode::Array(nodes, ni), ci) => func_args = ASTCell::with_node(unpack_nodes!(nodes, ni, FunctionArgument), ci),
                    (Key::SQL_CONST_CAST_FUNC_ARGS_ORDER, ASTNode::Array(nodes, ni), ci) => func_arg_ordering = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci)
                }
                let cast = arena.alloc(ConstFunctionCastExpression {
                    value: value.unwrap_or_default(),
                    func_name,
                    func_args,
                    func_arg_ordering,
                });
                ASTNode::ConstCastExpression(ConstCastExpression::Function(cast))
            }
            proto::NodeType::OBJECT_SQL_ALIAS => {
                let mut name = ASTCell::with_value("");
                let mut column_names: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut column_definitions: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_ALIAS_NAME, ASTNode::StringRef(s), ci) => name = ASTCell::with_node(s, ci),
                    (Key::SQL_ALIAS_COLUMN_NAMES, ASTNode::Array(nodes, ni), ci) => column_names = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_ALIAS_COLUMN_DEFS, ASTNode::Array(nodes, ni), ci) => column_definitions = ASTCell::with_node(unpack_nodes!(nodes, ni, ColumnDefinition), ci)
                }
                ASTNode::Alias(arena.alloc(Alias {
                    name,
                    column_names,
                    column_definitions,
                }))
            }
            proto::NodeType::OBJECT_DASHQL_IMPORT => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut method = ASTCell::with_value(proto::ImportMethodType::NONE);
                let mut from_uri = ASTCell::default();
                let mut extra = ASTCell::default();
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a, ni), ci) => name = ASTCell::with_node(read_name(arena, a, *ni), ci),
                    (Key::DASHQL_IMPORT_METHOD, ASTNode::ImportMethodType(m), ci) => method = ASTCell::with_node(m.clone(), ci),
                    (Key::DASHQL_IMPORT_FROM_URI, n, ci) => from_uri = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::DASHQL_IMPORT_EXTRA, n, ci) => extra = ASTCell::with_node(Some(read_dson(arena, n)), ci)
                }
                ASTNode::ImportStatement(arena.alloc(ImportStatement {
                    name,
                    method,
                    from_uri,
                    extra,
                }))
            }
            proto::NodeType::OBJECT_DASHQL_LOAD => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut source = ASTCell::with_value(NamePath::default());
                let mut method = ASTCell::with_value(proto::LoadMethodType::NONE);
                let mut extra = ASTCell::default();
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a, ni), ci) => name = ASTCell::with_node(read_name(arena, a, *ni), ci),
                    (Key::DASHQL_DATA_SOURCE, ASTNode::Array(a, ni), ci) => source = ASTCell::with_node(read_name(arena, a, *ni), ci),
                    (Key::DASHQL_LOAD_METHOD, ASTNode::LoadMethodType(m), ci) => method = ASTCell::with_node(m.clone(), ci),
                    (Key::DASHQL_LOAD_EXTRA, n, ci) => extra = ASTCell::with_node(Some(read_dson(arena, n)), ci)
                }
                ASTNode::LoadStatement(arena.alloc(LoadStatement {
                    name,
                    source,
                    method,
                    extra,
                }))
            }
            proto::NodeType::OBJECT_SQL_JOINED_TABLE => {
                let mut join = ASTCell::with_value(proto::JoinType::NONE);
                let mut qualifier = ASTCell::default();
                let mut input: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_JOIN_TYPE, ASTNode::JoinType(t), ci) => join = ASTCell::with_node(t.clone(), ci),
                    (Key::SQL_JOIN_ON, n, ci) => qualifier = ASTCell::with_node(Some(JoinQualifier::On(read_expr!(n))), ci),
                    (Key::SQL_JOIN_USING, ASTNode::Array(nodes, ni), ci) => {
                        let using = unpack_strings!(nodes, ni, StringRef);
                        qualifier = ASTCell::with_node(Some(JoinQualifier::Using(using)), ci);
                    },
                    (Key::SQL_JOIN_INPUT, ASTNode::Array(nodes, ni), ci) => input = ASTCell::with_node(unpack_nodes!(nodes, ni, TableRef), ci)
                }
                ASTNode::JoinedTable(arena.alloc(JoinedTable { join, qualifier, input }))
            }
            proto::NodeType::OBJECT_SQL_ROWSFROM_ITEM => {
                let mut function = ASTCell::default();
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_ROWSFROM_ITEM_FUNCTION, ASTNode::FunctionExpression(f), ci) => function = ASTCell::with_node(Some(*f), ci),
                    (Key::SQL_ROWSFROM_ITEM_COLUMNS, ASTNode::Array(nodes, ni), ci) => columns = ASTCell::with_node(unpack_nodes!(nodes, ni, ColumnDefinition), ci)
                }
                ASTNode::RowsFromItem(arena.alloc(RowsFromItem {
                    function: function.unwrap(),
                    columns,
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_TABLE => {
                let mut function = ASTCell::default();
                let mut ordinality = ASTCell::default();
                let mut rows_from: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_FUNCTION_TABLE_FUNCTION, ASTNode::FunctionExpression(f), ci) => function = ASTCell::with_node(Some(*f), ci),
                    (Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY, ASTNode::Boolean(v), ci) => ordinality = ASTCell::with_node(*v, ci),
                    (Key::SQL_FUNCTION_TABLE_ROWS_FROM, ASTNode::Array(nodes, ni), ci) => rows_from = ASTCell::with_node(unpack_nodes!(nodes, ni, RowsFromItem), ci)
                }
                ASTNode::FunctionTable(arena.alloc(FunctionTable {
                    function,
                    rows_from,
                    with_ordinality: ordinality,
                }))
            }
            proto::NodeType::OBJECT_SQL_COLUMN_REF => {
                let mut name: Option<NamePath> = None;
                read_attributes! {
                    (Key::SQL_COLUMN_REF_PATH, ASTNode::Array(a, ni), _ci) => name = Some(read_name(arena, a, *ni))
                }
                ASTNode::ColumnRef(name.unwrap_or_default())
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_ARG => {
                let mut name = ASTCell::default();
                let mut value = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s), ci) => name = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_FUNCTION_ARG_VALUE, n, ci) => value = ASTCell::with_node(Some(read_expr!(n)), ci)
                }
                ASTNode::FunctionArgument(arena.alloc(FunctionArgument {
                    name: name,
                    value: value.unwrap_or(Expression::Null),
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_TRIM_ARGS => {
                let mut direction = ASTCell::with_value(proto::TrimDirection::LEADING);
                let mut characters = ASTCell::default();
                let mut input: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_FUNCTION_TRIM_CHARACTERS, n, ci) => characters = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_TRIM_INPUT, ASTNode::Array(nodes, ni), ci) => input = ASTCell::with_node(read_exprs(arena, nodes, *ni), ci),
                    (Key::SQL_FUNCTION_TRIM_DIRECTION, ASTNode::TrimDirection(d), ci) => direction = ASTCell::with_node(*d, ci)
                }
                ASTNode::TrimFunctionArguments(arena.alloc(TrimFunctionArguments {
                    direction,
                    characters,
                    input,
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_SUBSTRING_ARGS => {
                let mut input = ASTCell::default();
                let mut substr_from = ASTCell::default();
                let mut substr_for = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_SUBSTRING_INPUT, n, ci) => input = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_SUBSTRING_FROM, n, ci) => substr_from = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_SUBSTRING_FOR, n, ci) => substr_for = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::SubstringFunctionArguments(arena.alloc(SubstringFunctionArguments {
                    input: input,
                    substr_for,
                    substr_from,
                }))
            }
            proto::NodeType::OBJECT_SQL_GENERIC_OPTION => {
                let mut key = ASTCell::with_value("");
                let mut value = ASTCell::with_value("");
                read_attributes! {
                    (Key::SQL_GENERIC_OPTION_KEY, ASTNode::StringRef(k), ci) => key = ASTCell::with_node(k, ci),
                    (Key::SQL_GENERIC_OPTION_VALUE, ASTNode::StringRef(v), ci) => value = ASTCell::with_node(v, ci)
                }
                ASTNode::GenericOption(arena.alloc(GenericOption { key, value }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_OVERLAY_ARGS => {
                let mut input = ASTCell::default();
                let mut placing = ASTCell::default();
                let mut substr_from = ASTCell::default();
                let mut substr_for = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_OVERLAY_INPUT, n, ci) => input = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_OVERLAY_PLACING, n, ci) => placing = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_OVERLAY_FROM, n, ci) => substr_from = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_OVERLAY_FOR, n, ci) => substr_for = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::OverlayFunctionArguments(arena.alloc(OverlayFunctionArguments {
                    input: input,
                    placing: placing,
                    substr_from: substr_from,
                    substr_for,
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_POSITION_ARGS => {
                let mut input = ASTCell::default();
                let mut search = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_POSITION_SEARCH, n, ci) => search = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::SQL_FUNCTION_POSITION_INPUT, n, ci) => input = ASTCell::with_node(Some(read_expr!(n)), ci)
                }
                ASTNode::PositionFunctionArguments(arena.alloc(PositionFunctionArguments {
                    input: input.unwrap(),
                    search: search.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_EXTRACT_ARGS => {
                let mut target = ASTCell::with_value(ExtractFunctionTarget::Known(proto::ExtractTarget::SECOND));
                let mut input = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::StringRef(s), ci) => target = ASTCell::with_node(ExtractFunctionTarget::Unknown(s), ci),
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::ExtractTarget(t), ci) => target = ASTCell::with_node(ExtractFunctionTarget::Known(*t), ci),
                    (Key::SQL_FUNCTION_EXTRACT_INPUT, n, ci) => input = ASTCell::with_node(Some(read_expr!(n)), ci)
                }
                ASTNode::ExtractFunctionArguments(arena.alloc(ExtractFunctionArguments {
                    target,
                    input: input.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_CAST_ARGS => {
                let mut value = ASTCell::default();
                let mut as_type = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_CAST_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_CAST_TYPE, ASTNode::SQLType(t), ci) => as_type = ASTCell::with_node(Some(*t), ci)
                }
                ASTNode::CastFunctionArguments(arena.alloc(CastFunctionArguments {
                    value: value,
                    as_type: as_type.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_TREAT_ARGS => {
                let mut value = ASTCell::default();
                let mut as_type = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_TREAT_VALUE, n, ci) => value = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::SQL_FUNCTION_TREAT_TYPE, ASTNode::SQLType(t), ci) => as_type = ASTCell::with_node(Some(*t), ci)
                }
                ASTNode::TreatFunctionArguments(arena.alloc(TreatFunctionArguments {
                    value: value.unwrap(),
                    as_type: as_type.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let mut func_name = ASTCell::with_value(FunctionName::default());
                let mut func_args: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut arg_ordering: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut args_known = ASTCell::default();
                let mut within_group: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut filter = ASTCell::with_value(Expression::Null);
                let mut all = ASTCell::with_value(false);
                let mut distinct = ASTCell::with_value(false);
                let mut variadic = ASTCell::default();
                let mut over = ASTCell::default();
                read_attributes! {
                    (Key::SQL_FUNCTION_VARIADIC, ASTNode::FunctionArgument(arg), ci) => variadic = ASTCell::with_node(Some(*arg), ci),
                    (Key::SQL_FUNCTION_ALL, ASTNode::Boolean(b), ci) => all = ASTCell::with_node(*b, ci),
                    (Key::SQL_FUNCTION_DISTINCT, ASTNode::Boolean(b), ci) => distinct = ASTCell::with_node(*b, ci),
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s), ci) => func_name = ASTCell::with_node(FunctionName::Unknown(s), ci),
                    (Key::SQL_FUNCTION_NAME, ASTNode::KnownFunction(f), ci) => func_name = ASTCell::with_node(FunctionName::Known(f.clone()), ci),
                    (Key::SQL_FUNCTION_ORDER, ASTNode::Array(nodes, ni), ci) => arg_ordering = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_FUNCTION_WITHIN_GROUP, ASTNode::Array(nodes, ni), ci) => within_group = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_FUNCTION_FILTER, n, ci) => filter = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_FUNCTION_OVER, ASTNode::WindowFrame(f), ci) => over = ASTCell::with_node(Some(*f), ci),
                    (Key::SQL_FUNCTION_ARGUMENTS, ASTNode::Array(nodes, ni), ci) => {
                        type Arg<'a> = ASTCell<&'a FunctionArgument<'a>>;
                        let args_layout = std::alloc::Layout::array::<Arg<'a>>(nodes.len()).unwrap_or_else(|_| oom());
                        let args_mem = arena.alloc_layout(args_layout).cast::<Arg<'a>>();
                        for (i, node) in nodes.iter().enumerate() {
                            let arg = match node {
                                ASTNode::FunctionArgument(t) => ASTCell::with_node(t.clone(), ni + i),
                                e => {
                                    let arg: &'a FunctionArgument = arena.alloc(FunctionArgument {
                                        name: ASTCell::default(),
                                        value: ASTCell::with_node(read_expr!(e), ni + i),
                                    });
                                    ASTCell::with_node(arg, ni + i)
                                },
                            };
                            unsafe {
                                std::ptr::write(args_mem.as_ptr().add(i), arg);
                            }
                        }
                        func_args = ASTCell::with_node(unsafe { std::slice::from_raw_parts(args_mem.as_ptr(), nodes.len()) }, ci);
                    },
                    (Key::SQL_FUNCTION_TRIM_ARGS, ASTNode::TrimFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Trim(a)), ci),
                    (Key::SQL_FUNCTION_OVERLAY_ARGS, ASTNode::OverlayFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Overlay(a)), ci),
                    (Key::SQL_FUNCTION_POSITION_ARGS, ASTNode::PositionFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Position(a)), ci),
                    (Key::SQL_FUNCTION_SUBSTRING_ARGS, ASTNode::SubstringFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Substring(a)), ci),
                    (Key::SQL_FUNCTION_EXTRACT_ARGS, ASTNode::ExtractFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Extract(a)), ci),
                    (Key::SQL_FUNCTION_CAST_ARGS, ASTNode::CastFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Cast(a)), ci),
                    (Key::SQL_FUNCTION_TREAT_ARGS, ASTNode::TreatFunctionArguments(a), ci) => args_known = ASTCell::with_node(Some(KnownFunctionArguments::Treat(a)), ci)
                }
                ASTNode::FunctionExpression(arena.alloc(FunctionExpression {
                    name: func_name,
                    args: func_args,
                    args_known,
                    arg_ordering,
                    within_group,
                    filter,
                    all,
                    distinct,
                    variadic,
                    over,
                }))
            }
            proto::NodeType::OBJECT_SQL_TYPECAST_EXPRESSION => {
                let mut value = ASTCell::default();
                let mut typename = ASTCell::default();
                read_attributes! {
                    (Key::SQL_TYPECAST_VALUE, v, ci) => value = ASTCell::with_node(Some(read_expr!(v)), ci),
                    (Key::SQL_TYPECAST_TYPE, ASTNode::SQLType(t), ci) => typename = ASTCell::with_node(Some(t.clone()), ci)
                }
                ASTNode::TypeCastExpression(arena.alloc(TypeCastExpression {
                    sql_type: typename.unwrap(),
                    value: value.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_SUBQUERY_EXPRESSION => {
                let mut arg0 = ASTCell::with_value(Expression::Null);
                let mut arg1 = ASTCell::with_value(Expression::Null);
                let mut operator_name =
                    ASTCell::with_value(ExpressionOperatorName::Known(proto::ExpressionOperator::PLUS));
                let mut quantifier = ASTCell::with_value(proto::SubqueryQuantifier::ALL);
                read_attributes! {
                    (Key::SQL_SUBQUERY_ARG0, v, ci) => arg0 = ASTCell::with_node(read_expr!(v), ci),
                    (Key::SQL_SUBQUERY_ARG1, v, ci) => arg1 = ASTCell::with_node(read_expr!(v), ci),
                    (Key::SQL_SUBQUERY_QUANTIFIER, ASTNode::SubqueryQuantifier(quant), ci) => quantifier = ASTCell::with_node(*quant, ci),
                    (Key::SQL_SUBQUERY_OPERATOR, n, ci) => operator_name = ASTCell::with_node(read_expression_operator(arena, n), ci)
                }
                ASTNode::SubqueryExpression(arena.alloc(SubqueryExpression {
                    operator: operator_name,
                    quantifier,
                    args: [arg0, arg1],
                }))
            }
            proto::NodeType::OBJECT_SQL_SELECT_EXPRESSION => {
                let mut stmt = ASTCell::default();
                let mut indirection = ASTCell::default();
                read_attributes! {
                    (Key::SQL_SELECT_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_SELECT_EXPRESSION_INDIRECTION, ASTNode::Array(a, ni), ci) => indirection = ASTCell::with_node(Some(read_name(arena, a, *ni)), ci)
                }
                ASTNode::SelectStatementExpression(arena.alloc(SelectStatementExpression {
                    statement: stmt.unwrap(),
                    indirection,
                }))
            }
            proto::NodeType::OBJECT_SQL_EXISTS_EXPRESSION => {
                let mut stmt = ASTCell::default();
                read_attributes! {
                    (Key::SQL_EXISTS_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = ASTCell::with_node(Some(*s), ci)
                }
                ASTNode::ExistsExpression(arena.alloc(ExistsExpression {
                    statement: stmt.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_TIMESTAMP_TYPE => {
                let mut precision = ASTCell::default();
                let mut with_timezone = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s), ci) => precision = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz), ci) => with_timezone = ASTCell::with_node(*tz, ci)
                }
                ASTNode::TimestampTypeSpec(arena.alloc(TimestampType {
                    precision,
                    with_timezone,
                }))
            }
            proto::NodeType::OBJECT_SQL_TIME_TYPE => {
                let mut precision = ASTCell::default();
                let mut with_timezone = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s), ci) => precision = ASTCell::with_node(Some(s.clone()), ci),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz), ci) => with_timezone = ASTCell::with_node(*tz, ci)
                }
                ASTNode::TimeTypeSpec(arena.alloc(TimeType {
                    precision,
                    with_timezone,
                }))
            }
            proto::NodeType::OBJECT_SQL_GROUP_BY_ITEM => {
                let mut item_type = GroupByItemType::EMPTY;
                let mut expr = None;
                let mut args: &[_] = &[];
                let mut args_ofs: usize = 0;
                read_attributes! {
                    (Key::SQL_GROUP_BY_ITEM_TYPE, ASTNode::GroupByItemType(t), _ci) => item_type = t.clone(),
                    (Key::SQL_GROUP_BY_ITEM_ARG, n, _ci) => expr = Some(read_expr!(n)),
                    (Key::SQL_GROUP_BY_ITEM_ARGS, ASTNode::Array(nodes, ni), _ci) => {
                        args = nodes;
                        args_ofs = *ni;
                    }
                }
                let item = match item_type {
                    GroupByItemType::EMPTY => GroupByItem::Empty,
                    GroupByItemType::EXPRESSION => GroupByItem::Expression(expr.unwrap()),
                    GroupByItemType::CUBE => GroupByItem::Cube(read_exprs(arena, args, args_ofs)),
                    GroupByItemType::ROLLUP => GroupByItem::Rollup(read_exprs(arena, args, args_ofs)),
                    GroupByItemType::GROUPING_SETS => {
                        GroupByItem::GroupingSets(unpack_nodes!(args, args_ofs, GroupByItem))
                    }
                    _ => return Err(SystemError::InvalidGroupByItem(Some(node_id))),
                };
                ASTNode::GroupByItem(item)
            }
            proto::NodeType::OBJECT_SQL_TYPENAME => {
                let mut base = ASTCell::default();
                let mut set_of = ASTCell::with_value(false);
                let mut array_bounds: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_TYPENAME_TYPE, ASTNode::GenericTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Generic(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Numeric(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericType(t), ci) => {
                        base = ASTCell::with_node(Some(SQLBaseType::Numeric(arena.alloc(NumericType {
                            base: ASTCell::with_node(*t, ci),
                            modifiers: ASTCell::with_value(&[]),
                        }))), ci)
                    },
                    (Key::SQL_TYPENAME_TYPE, ASTNode::TimeTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Time(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::BitTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Bit(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::CharacterTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Character(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::TimestampTypeSpec(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Timestamp(t.clone())), ci),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::IntervalSpecification(t), ci) => base = ASTCell::with_node(Some(SQLBaseType::Interval(t.clone())), ci),
                    (Key::SQL_TYPENAME_SETOF, ASTNode::Boolean(b), ci) => set_of = ASTCell::with_node(*b, ci),
                    (Key::SQL_TYPENAME_ARRAY, ASTNode::Array(n, _ni), ci) => array_bounds = ASTCell::with_node(read_array_bounds(arena, n), ci)
                }
                ASTNode::SQLType(arena.alloc(SQLType {
                    base_type: base.unwrap_or(SQLBaseType::Invalid),
                    set_of,
                    array_bounds,
                }))
            }
            proto::NodeType::OBJECT_DASHQL_VIZ => {
                let mut target = ASTCell::default();
                let mut component_type = ASTCell::default();
                let mut type_modifiers = ASTCell::with_value(0_u32);
                let mut extra = ASTCell::default();
                read_attributes! {
                    (Key::DASHQL_VIZ_TARGET, ASTNode::TableRef(t), ci) => target = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::DASHQL_VIZ_COMPONENT_TYPE, ASTNode::VizComponentType(t), ci) => component_type = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ASTNode::UInt32Bitmap(mods), ci) => type_modifiers = ASTCell::with_node(*mods, ci),
                    (Key::DASHQL_VIZ_COMPONENT_EXTRA, n, ci) => extra = ASTCell::with_node(Some(read_dson(arena, n)), ci)
                }
                ASTNode::VizStatement(arena.alloc(VizStatement {
                    target: target.unwrap(),
                    component_type,
                    type_modifiers,
                    extra,
                }))
            }
            proto::NodeType::OBJECT_DASHQL_DECLARE => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut value_type = ASTCell::default();
                let mut component_type = ASTCell::with_value(Some(proto::InputComponentType::NONE));
                let mut extra = ASTCell::default();
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::DASHQL_DECLARE_VALUE_TYPE, ASTNode::SQLType(t), ci) => value_type = ASTCell::with_node(Some(*t), ci),
                    (Key::DASHQL_DECLARE_COMPONENT_TYPE, ASTNode::InputComponentType(t), ci) => component_type = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::DASHQL_DECLARE_EXTRA, n, ci) => extra = ASTCell::with_node(Some(read_dson(arena, n)), ci)
                }
                ASTNode::DeclareStatement(arena.alloc(DeclareStatement {
                    name,
                    value_type: value_type.unwrap(),
                    component_type,
                    extra,
                }))
            }
            proto::NodeType::OBJECT_DASHQL_SET => {
                let mut value = ASTCell::default();
                read_attributes! {
                    (Key::DASHQL_SET_FIELDS, n, ci) => value = ASTCell::with_node(Some(read_dson(arena, n)), ci)
                }
                ASTNode::SetStatement(arena.alloc(SetStatement { fields: value.unwrap() }))
            }
            proto::NodeType::OBJECT_SQL_CHARACTER_TYPE => {
                let mut base = ASTCell::with_value(proto::CharacterType::VARCHAR);
                let mut length = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CHARACTER_TYPE, ASTNode::CharacterType(c), ci) => base = ASTCell::with_node(c.clone(), ci),
                    (Key::SQL_CHARACTER_TYPE_LENGTH, l, ci) => length = ASTCell::with_node(Some(read_expr!(l)), ci)
                }
                ASTNode::CharacterTypeSpec(arena.alloc(CharacterType { base, length }))
            }
            proto::NodeType::OBJECT_SQL_INTO => {
                let mut temp_type = ASTCell::with_value(proto::TempType::DEFAULT);
                let mut temp_name = ASTCell::with_value(NamePath::default());
                read_attributes! {
                    (Key::SQL_TEMP_NAME, ASTNode::Array(nodes, ni), ci) => temp_name = ASTCell::with_node(read_name(arena, nodes, *ni), ci),
                    (Key::SQL_TEMP_TYPE, ASTNode::TempType(t), ci) => temp_type = ASTCell::with_node(t.clone(), ci)
                }
                ASTNode::Into(arena.alloc(Into {
                    temp: temp_type,
                    name: temp_name,
                }))
            }
            proto::NodeType::OBJECT_SQL_DEF_ARG => {
                let mut key = ASTCell::with_value("");
                let mut value = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_DEFINITION_ARG_KEY, ASTNode::StringRef(n), ci) => key = ASTCell::with_node(n, ci),
                    (Key::SQL_DEFINITION_ARG_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::GenericDefinition(arena.alloc(GenericDefinition { key, value }))
            }
            proto::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT => {
                let mut constraint_name = ASTCell::default();
                let mut constraint_type = ASTCell::with_value(proto::ColumnConstraint::NULL_);
                let mut definition: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut value = ASTCell::default();
                let mut no_inherit = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_COLUMN_CONSTRAINT_TYPE, ASTNode::ColumnConstraint(c), ci) => constraint_type = ASTCell::with_node(c.clone(), ci),
                    (Key::SQL_COLUMN_CONSTRAINT_NAME, ASTNode::StringRef(n), ci) => constraint_name = ASTCell::with_node(Some(n.clone()), ci),
                    (Key::SQL_COLUMN_CONSTRAINT_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_COLUMN_CONSTRAINT_DEFINITION, ASTNode::Array(nodes, ni), ci) => definition = ASTCell::with_node(unpack_nodes!(nodes, ni, GenericDefinition), ci),
                    (Key::SQL_COLUMN_CONSTRAINT_NO_INHERIT, ASTNode::Boolean(b), ci) => no_inherit = ASTCell::with_node(*b, ci)
                }
                ASTNode::ColumnConstraintSpec(arena.alloc(ColumnConstraintSpec {
                    constraint_name,
                    constraint_type,
                    value,
                    definition,
                    no_inherit,
                }))
            }
            proto::NodeType::OBJECT_SQL_KEY_ACTION => {
                let mut trigger = ASTCell::with_value(proto::KeyActionTrigger::UPDATE);
                let mut command = ASTCell::with_value(proto::KeyActionCommand::NO_ACTION);
                read_attributes! {
                    (Key::SQL_KEY_ACTION_TRIGGER, ASTNode::KeyActionTrigger(t), ci) => trigger = ASTCell::with_node(*t, ci),
                    (Key::SQL_KEY_ACTION_COMMAND, ASTNode::KeyActionCommand(c), ci) => command = ASTCell::with_node(*c, ci)
                }
                ASTNode::KeyAction(arena.alloc(KeyAction { trigger, command }))
            }
            proto::NodeType::OBJECT_SQL_TABLE_CONSTRAINT => {
                let mut constraint_name = ASTCell::default();
                let mut constraint_type = ASTCell::default();
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut definition: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut attributes: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut argument = ASTCell::with_value(None);
                let mut ref_name = ASTCell::with_value(NamePath::default());
                let mut ref_columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut key_match = ASTCell::default();
                let mut key_actions: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut using_index = ASTCell::default();
                read_attributes! {
                    (Key::SQL_TABLE_CONSTRAINT_ARGUMENT, arg, ci) => argument = ASTCell::with_node(Some(read_expr!(arg)), ci),
                    (Key::SQL_TABLE_CONSTRAINT_ATTRIBUTES, ASTNode::Array(nodes, ni), ci) => {
                        let constraints = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::ConstraintAttribute(ca) => constraints[i] = ASTCell::with_node(ConstraintAttribute(*ca), ni + i),
                                _ => return Err(SystemError::UnexpectedElement(Some(ni + i), Key::SQL_TABLE_CONSTRAINT_ATTRIBUTES, buffer_nodes[ni+i].node_type())),
                            }
                        }
                        attributes = ASTCell::with_node(constraints, ci);
                    },
                    (Key::SQL_TABLE_CONSTRAINT_COLUMNS, ASTNode::Array(nodes, ni), ci) => columns = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_TABLE_CONSTRAINT_DEFINITION, ASTNode::Array(nodes, ni), ci) => definition = ASTCell::with_node(unpack_nodes!(nodes, ni, GenericDefinition), ci),
                    (Key::SQL_TABLE_CONSTRAINT_INDEX, ASTNode::StringRef(s), ci) => using_index = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_TABLE_CONSTRAINT_KEY_ACTIONS, ASTNode::Array(nodes, ni), ci) => key_actions = ASTCell::with_node(unpack_nodes!(nodes, ni, KeyAction), ci),
                    (Key::SQL_TABLE_CONSTRAINT_KEY_MATCH, ASTNode::KeyMatch(m), ci) => key_match = ASTCell::with_node(Some(*m), ci),
                    (Key::SQL_TABLE_CONSTRAINT_NAME, ASTNode::StringRef(n), ci) => constraint_name = ASTCell::with_node(Some(n.clone()), ci),
                    (Key::SQL_TABLE_CONSTRAINT_REFERENCES_COLUMNS, ASTNode::Array(nodes, ni), ci) => ref_columns = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_TABLE_CONSTRAINT_REFERENCES_NAME, ASTNode::Array(name, ni), ci) => ref_name = ASTCell::with_node(read_name(arena, name, *ni), ci),
                    (Key::SQL_TABLE_CONSTRAINT_TYPE, ASTNode::TableConstraint(c), ci) => constraint_type = ASTCell::with_node(c.clone(), ci)
                }
                ASTNode::TableConstraintSpec(arena.alloc(TableConstraintSpec {
                    constraint_name,
                    constraint_type,
                    columns,
                    using_index,
                    definition,
                    argument,
                    attributes,
                    references_name: ref_name,
                    references_columns: ref_columns,
                    key_match,
                    key_actions,
                }))
            }
            proto::NodeType::OBJECT_SQL_ROW_LOCKING => {
                let mut strength = ASTCell::with_value(proto::RowLockingStrength::READ_ONLY);
                let mut of: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut block_behavior = ASTCell::default();
                read_attributes! {
                    (Key::SQL_ROW_LOCKING_STRENGTH, ASTNode::RowLockingStrength(s), ci) => strength = ASTCell::with_node(s.clone(), ci),
                    (Key::SQL_ROW_LOCKING_BLOCK_BEHAVIOR, ASTNode::RowLockingBlockBehavior(b), ci) => {
                        block_behavior = ASTCell::with_node(Some(b.clone()), ci);
                    },
                    (Key::SQL_ROW_LOCKING_OF, ASTNode::Array(nodes, ni), ci) => {
                        let names = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::Array(path, ni) => names[i] = read_name(arena, path, *ni),
                                _ => return Err(SystemError::UnexpectedElement(Some(ni + i), Key::SQL_ROW_LOCKING_OF, buffer_nodes[ni+i].node_type())),
                            }
                        }
                        of = ASTCell::with_node(names, ci);
                    }
                }
                ASTNode::RowLocking(arena.alloc(RowLocking {
                    strength,
                    of,
                    block_behavior,
                }))
            }
            proto::NodeType::OBJECT_SQL_SELECT_SAMPLE => {
                let mut function = ASTCell::with_value("");
                let mut repeat = ASTCell::default();
                let mut seed = ASTCell::default();
                let mut count_value = None;
                let mut count_unit = ASTCell::with_value(proto::SampleCountUnit::ROWS);
                read_attributes! {
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(f), ci) => function = ASTCell::with_node(f, ci),
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(v), ci) => repeat = ASTCell::with_node(Some(v.clone()), ci),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(v), ci) => seed = ASTCell::with_node(Some(v.clone()), ci),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u), ci) => count_unit = ASTCell::with_node(u.clone(), ci),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(s), ci) => count_value = Some(ASTCell::with_node(*s, ci))
                }
                ASTNode::Sample(arena.alloc(Sample {
                    function,
                    repeat,
                    seed,
                    count: ASTCell::with_value(count_value.map(|v| {
                        let s: &'a SampleCount<'a> = arena.alloc(SampleCount {
                            value: v,
                            unit: count_unit,
                        });
                        s
                    })),
                }))
            }
            proto::NodeType::OBJECT_SQL_CREATE => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut temp = ASTCell::default();
                let mut on_commit = ASTCell::default();
                let mut columns = Vec::new();
                let mut constraints = Vec::new();
                read_attributes! {
                    (Key::SQL_CREATE_TABLE_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_CREATE_TABLE_TEMP, ASTNode::TempType(t), ci) => temp = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_CREATE_TABLE_ON_COMMIT, ASTNode::OnCommitOption(o), ci) => on_commit = ASTCell::with_node(Some(o.clone()), ci),
                    (Key::SQL_CREATE_TABLE_ELEMENTS, ASTNode::Array(nodes, ni), _ci) => {
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::ColumnDefinition(col) => { columns.push(ASTCell::with_node(*col, ni + i)) },
                                ASTNode::TableConstraintSpec(tbl) => { constraints.push(ASTCell::with_node(*tbl, ni + i)) },
                                _ => return Err(SystemError::UnexpectedElement(Some(ni + i), Key::SQL_CREATE_TABLE_ELEMENTS, buffer_nodes[ni+i].node_type())),
                            }
                        }
                    }
                }
                ASTNode::Create(arena.alloc(CreateStatement {
                    name,
                    columns: ASTCell::with_value(arena.alloc_slice_clone(&columns)),
                    constraints: ASTCell::with_value(arena.alloc_slice_clone(&constraints)),
                    on_commit,
                    temp,
                }))
            }
            proto::NodeType::OBJECT_SQL_COLUMN_DEF => {
                let mut name = ASTCell::with_value("");
                let mut sql_type = ASTCell::default();
                let mut collate: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut options: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut constraints: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_COLUMN_DEF_NAME, ASTNode::StringRef(n), ci) => name = ASTCell::with_node(n, ci),
                    (Key::SQL_COLUMN_DEF_TYPE, ASTNode::SQLType(t), ci) => sql_type = ASTCell::with_node(Some(*t), ci),
                    (Key::SQL_COLUMN_DEF_COLLATE, ASTNode::Array(nodes, ni), ci) => collate = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_COLUMN_DEF_OPTIONS, ASTNode::Array(nodes, ni), ci) => options = ASTCell::with_node(unpack_nodes!(nodes, ni, GenericOption), ci),
                    (Key::SQL_COLUMN_DEF_CONSTRAINTS, ASTNode::Array(nodes, ni), ci) => {
                        let cs = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::ColumnConstraintSpec(c) => cs[i] = ASTCell::with_node(ColumnConstraintVariant::Constraint(c), ni + i),
                                ASTNode::ConstraintAttribute(c) => cs[i] = ASTCell::with_node(ColumnConstraintVariant::Attribute(c.clone()), ni + i),
                                _ => return Err(SystemError::UnexpectedElement(Some(ni + i), Key::SQL_COLUMN_DEF_CONSTRAINTS, buffer_nodes[ni+i].node_type())),
                            }
                        }
                        constraints = ASTCell::with_node(cs, ci);
                    }
                }
                ASTNode::ColumnDefinition(arena.alloc(ColumnDefinition {
                    name,
                    sql_type: sql_type.unwrap(),
                    collate,
                    options,
                    constraints,
                }))
            }
            proto::NodeType::OBJECT_SQL_CREATE_AS => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut select = ASTCell::default();
                let mut with_data = ASTCell::with_value(false);
                let mut if_not_exists = ASTCell::with_value(false);
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut temp = ASTCell::default();
                let mut on_commit = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CREATE_AS_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_CREATE_AS_STATEMENT, ASTNode::SelectStatement(s), ci) => select = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_CREATE_AS_WITH_DATA, ASTNode::Boolean(b), ci) => with_data = ASTCell::with_node(*b, ci),
                    (Key::SQL_CREATE_AS_IF_NOT_EXISTS, ASTNode::Boolean(b), ci) => if_not_exists = ASTCell::with_node(*b, ci),
                    (Key::SQL_CREATE_AS_TEMP, ASTNode::TempType(t), ci) => temp = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_CREATE_AS_ON_COMMIT, ASTNode::OnCommitOption(o), ci) => on_commit = ASTCell::with_node(Some(o.clone()), ci),
                    (Key::SQL_CREATE_AS_COLUMNS, ASTNode::Array(nodes, ni), ci) => columns = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci)
                }
                ASTNode::CreateAs(arena.alloc(CreateAsStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    if_not_exists,
                    on_commit,
                    temp,
                    with_data,
                }))
            }
            proto::NodeType::OBJECT_SQL_VIEW => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut select = ASTCell::default();
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut temp = ASTCell::default();
                read_attributes! {
                    (Key::SQL_VIEW_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_VIEW_STATEMENT, ASTNode::SelectStatement(s), ci) => select = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_VIEW_TEMP, ASTNode::TempType(t), ci) => temp = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_VIEW_COLUMNS, ASTNode::Array(cols, ni), ci) => columns = ASTCell::with_node(unpack_strings!(cols, ni, StringRef), ci)
                }
                ASTNode::CreateView(arena.alloc(CreateViewStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    temp,
                }))
            }
            proto::NodeType::OBJECT_SQL_CTE => {
                let mut name = ASTCell::with_value("");
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut stmt = ASTCell::default();
                read_attributes! {
                    (Key::SQL_CTE_NAME, ASTNode::StringRef(s), ci) => name = ASTCell::with_node(s, ci),
                    (Key::SQL_CTE_COLUMNS, ASTNode::Array(nodes, ni), ci) => columns = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_CTE_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = ASTCell::with_node(Some(*s), ci)
                }
                ASTNode::CommonTableExpression(arena.alloc(CommonTableExpression {
                    name,
                    columns,
                    statement: stmt.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_WINDOW_BOUND => {
                let mut mode = ASTCell::with_value(proto::WindowBoundMode::UNBOUNDED);
                let mut direction = ASTCell::default();
                let mut value = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_WINDOW_BOUND_MODE, ASTNode::WindowBoundMode(m), ci) => mode = ASTCell::with_node(*m, ci),
                    (Key::SQL_WINDOW_BOUND_DIRECTION, ASTNode::WindowBoundDirection(d), ci) => direction = ASTCell::with_node(Some(*d), ci),
                    (Key::SQL_WINDOW_BOUND_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::WindowFrameBound(arena.alloc(WindowFrameBound { mode, direction, value }))
            }
            proto::NodeType::OBJECT_SQL_WINDOW_FRAME => {
                let mut name = ASTCell::default();
                let mut partition_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut order_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut frame_mode = ASTCell::default();
                let mut frame_bounds: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_WINDOW_FRAME_NAME, ASTNode::StringRef(n), ci) => name = ASTCell::with_node(Some(n.clone()), ci),
                    (Key::SQL_WINDOW_FRAME_PARTITION, ASTNode::Array(nodes, ni), ci) => partition_by = ASTCell::with_node(read_exprs(arena, nodes, *ni), ci),
                    (Key::SQL_WINDOW_FRAME_ORDER, ASTNode::Array(nodes, ni), ci) => order_by = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_WINDOW_FRAME_MODE, ASTNode::WindowRangeMode(m), ci) => frame_mode = ASTCell::with_node(Some(*m), ci),
                    (Key::SQL_WINDOW_FRAME_BOUNDS, ASTNode::Array(nodes, ni), ci) => frame_bounds = ASTCell::with_node(unpack_nodes!(nodes, ni, WindowFrameBound), ci)
                }
                ASTNode::WindowFrame(arena.alloc(WindowFrame {
                    name,
                    partition_by,
                    order_by,
                    frame_mode,
                    frame_bounds,
                }))
            }
            proto::NodeType::OBJECT_SQL_WINDOW_DEF => {
                let mut name = ASTCell::default();
                let mut frame = ASTCell::default();
                read_attributes! {
                    (Key::SQL_WINDOW_DEF_NAME, ASTNode::StringRef(n), ci) => name = ASTCell::with_node(Some(n.clone()), ci),
                    (Key::SQL_WINDOW_DEF_FRAME, ASTNode::WindowFrame(f), ci) => frame = ASTCell::with_node(Some(*f), ci)
                }
                ASTNode::WindowDefinition(arena.alloc(WindowDefinition {
                    name: name.unwrap(),
                    frame: frame.unwrap(),
                }))
            }
            proto::NodeType::OBJECT_SQL_TYPETEST_EXPRESSION => {
                let mut negate = ASTCell::with_value(false);
                let mut value = ASTCell::default();
                let mut of_types: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_TYPETEST_NEGATE, ASTNode::Boolean(neg), ci) => negate = ASTCell::with_node(*neg, ci),
                    (Key::SQL_TYPETEST_VALUE, n, ci) => value = ASTCell::with_node(Some(read_expr!(n)), ci),
                    (Key::SQL_TYPETEST_TYPES, ASTNode::Array(nodes, ni), ci) => of_types = ASTCell::with_node(unpack_nodes!(nodes, ni, SQLType), ci)
                }
                ASTNode::TypeTestExpression(arena.alloc(TypeTestExpression {
                    negate,
                    value: value.unwrap(),
                    of_types,
                }))
            }
            proto::NodeType::OBJECT_SQL_SELECT => {
                let mut with_ctes: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut with_recursive = ASTCell::with_value(false);

                let mut values: ASTCell<Option<&'a [ASTCell<&'a [ASTCell<Expression<'a>>]>]>> = ASTCell::default();
                let mut table = ASTCell::default();
                let mut combine_operation = ASTCell::default();
                let mut combine_modifier = ASTCell::with_value(proto::CombineModifier::NONE);
                let mut combine_input: ASTCell<&[_]> = ASTCell::with_value(&[]);

                let mut targets: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut all = ASTCell::with_value(false);
                let mut distinct = ASTCell::default();
                let mut into = ASTCell::default();
                let mut from: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut where_clause = ASTCell::default();
                let mut group_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut having = ASTCell::default();
                let mut windows: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut sample = ASTCell::default();

                let mut limit = ASTCell::default();
                let mut offset = ASTCell::default();
                let mut order_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut row_locking: ASTCell<&[_]> = ASTCell::with_value(&[]);

                read_attributes! {
                    (Key::SQL_SELECT_WITH_CTES, ASTNode::Array(nodes, ni), ci) => with_ctes = ASTCell::with_node(unpack_nodes!(nodes, ni, CommonTableExpression), ci),
                    (Key::SQL_SELECT_WITH_RECURSIVE, ASTNode::Boolean(b), ci) => with_recursive = ASTCell::with_node(*b, ci),

                    (Key::SQL_SELECT_TABLE, ASTNode::TableRef(t), ci) => table = ASTCell::with_node(Some(t.clone()), ci),
                    (Key::SQL_SELECT_VALUES, ASTNode::Array(tuples, ni), ci) => {
                        type Tuple<'a> = ASTCell<&'a [ASTCell<Expression<'a>>]>;
                        let tuples_layout = std::alloc::Layout::array::<Tuple<'a>>(tuples.len()).unwrap_or_else(|_| oom());
                        let tuples_mem = arena.alloc_layout(tuples_layout).cast::<Tuple<'a>>();
                        let mut tuples_writer = 0;
                        for i in 0..tuples.len() {
                            match tuples[i] {
                                ASTNode::Array(tuple, ofs) => {
                                    let tuple_exprs = ASTCell::with_node(read_exprs(arena, tuple, ofs), ni + i);
                                    unsafe {
                                        std::ptr::write(tuples_mem.as_ptr().add(tuples_writer), tuple_exprs);
                                    }
                                    tuples_writer += 1;
                                }
                                _ => {
                                    debug_assert!(false, "unexpected node: {:?}", &tuples[i]);
                                }
                            };
                        }
                        let slice: &'a [Tuple<'a>] = unsafe { std::slice::from_raw_parts_mut(tuples_mem.as_ptr(), tuples_writer) };
                        values = ASTCell::with_node(Some(slice), ci);
                    },
                    (Key::SQL_COMBINE_OPERATION, ASTNode::CombineOperation(op), ci) => combine_operation = ASTCell::with_node(Some(*op), ci),
                    (Key::SQL_COMBINE_MODIFIER, ASTNode::CombineModifier(m), ci) => combine_modifier = ASTCell::with_node(*m, ci),
                    (Key::SQL_COMBINE_INPUT, ASTNode::Array(nodes, ni), ci) => combine_input = ASTCell::with_node(unpack_nodes!(nodes, ni, SelectStatement), ci),

                    (Key::SQL_SELECT_ALL, ASTNode::Boolean(b), ci) => all = ASTCell::with_node(*b, ci),
                    (Key::SQL_SELECT_DISTINCT, ASTNode::Array(n, ni), ci) => distinct = ASTCell::with_node(Some(read_exprs(arena, n, *ni)), ci),
                    (Key::SQL_SELECT_TARGETS, ASTNode::Array(nodes, ni), ci) => targets = ASTCell::with_node(unpack_nodes!(nodes, ni, ResultTarget), ci),
                    (Key::SQL_SELECT_INTO, ASTNode::Into(i), ci) => into = ASTCell::with_node(Some(*i), ci),
                    (Key::SQL_SELECT_FROM, ASTNode::Array(nodes, ni), ci) => from = ASTCell::with_node(unpack_nodes!(nodes, ni, TableRef), ci),
                    (Key::SQL_SELECT_WHERE, n, ci) => where_clause = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_SELECT_GROUPS, ASTNode::Array(nodes, ni), ci) => group_by = ASTCell::with_node(unpack_nodes!(nodes, ni, GroupByItem), ci),
                    (Key::SQL_SELECT_HAVING, n, ci) => having = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_SELECT_SAMPLE, ASTNode::Sample(s), ci) => sample = ASTCell::with_node(Some(*s), ci),
                    (Key::SQL_SELECT_WINDOWS, ASTNode::Array(nodes, ni), ci) => windows = ASTCell::with_node(unpack_nodes!(nodes, ni, WindowDefinition), ci),

                    (Key::SQL_SELECT_ORDER, ASTNode::Array(nodes, ni), ci) => order_by = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_SELECT_LIMIT_ALL, ASTNode::Boolean(v), ci) => if *v { limit = ASTCell::with_node(Some(Limit::ALL), ci) },
                    (Key::SQL_SELECT_LIMIT, n, ci) => limit = ASTCell::with_node(Some(Limit::Expression(read_expr!(n))), ci),
                    (Key::SQL_SELECT_OFFSET, n, ci) => offset = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_SELECT_ROW_LOCKING, ASTNode::Array(nodes, ni), ci) => row_locking = ASTCell::with_node(unpack_nodes!(nodes, ni, RowLocking), ci)
                }
                let data = if values.get().is_some() {
                    SelectData::Values(values.unwrap())
                } else if table.get().is_some() {
                    SelectData::Table(table.unwrap())
                } else if combine_operation.get().is_some() {
                    SelectData::Combine(arena.alloc(CombineOperation {
                        operation: combine_operation.unwrap(),
                        modifier: combine_modifier,
                        input: combine_input,
                    }))
                } else {
                    SelectData::From(arena.alloc(SelectFromStatement {
                        all,
                        distinct,
                        targets,
                        into,
                        from,
                        where_clause,
                        group_by,
                        having,
                        windows,
                        sample,
                    }))
                };
                ASTNode::SelectStatement(arena.alloc(SelectStatement {
                    with_ctes,
                    with_recursive,
                    data,
                    order_by,
                    limit,
                    offset,
                    row_locking,
                }))
            }
            proto::NodeType::OBJECT_DSON => {
                let fields = arena.alloc_slice_fill_default(children.len());
                for i in 0..children.len() {
                    let c = &children[i];
                    let k = proto::AttributeKey(buffer_nodes[children_begin + i].attribute_key());
                    let ks = if k.0 >= proto::AttributeKey::DSON_DYNAMIC_KEYS_.0 {
                        let ki = k.0 - proto::AttributeKey::DSON_DYNAMIC_KEYS_.0;
                        let dson_keys = buffer.dson_keys().unwrap_or_default();
                        let dson_key = dson_keys[ki as usize];
                        DsonKey::Unknown(
                            &text[(dson_key.offset() as usize)..((dson_key.offset() + dson_key.length()) as usize)],
                        )
                    } else {
                        DsonKey::Known(k)
                    };
                    let value = read_dson(arena, c);
                    fields[i] = DsonField { key: ks, value };
                }
                ASTNode::Dson(DsonValue::Object(fields))
            }
            t => return Err(SystemError::TranslationNotImplemented(Some(node_id), t)),
        };

        // Remember translated node
        nodes.push(translated);
    }

    // Do a postorder dfs traversal
    let mut stmts: Vec<Statement<'a>> = Vec::new();
    for (stmt_id, statement) in buffer_stmts.iter().enumerate() {
        let node = &nodes[statement.root_node() as usize];
        let stmt = match node {
            ASTNode::SelectStatement(s) => Statement::Select(s),
            ASTNode::DeclareStatement(s) => Statement::Declare(s),
            ASTNode::ImportStatement(s) => Statement::Import(s),
            ASTNode::VizStatement(s) => Statement::Viz(s),
            ASTNode::LoadStatement(s) => Statement::Load(s),
            ASTNode::Create(s) => Statement::Create(s),
            ASTNode::CreateAs(s) => Statement::CreateAs(s),
            ASTNode::CreateView(s) => Statement::CreateView(s),
            ASTNode::SetStatement(s) => Statement::Set(s),
            _ => {
                return Err(SystemError::InvalidStatementRoot(
                    stmt_id,
                    statement.root_node() as usize,
                ))
            }
        };
        stmts.push(stmt);
    }
    Ok(Program {
        buffer,
        nodes,
        statements: stmts,
    })
}

fn read_expr<'a, 'b>(arena: &'a bumpalo::Bump, node: &ASTNode<'a>) -> Expression<'a> {
    match node {
        ASTNode::Array(nodes, ni) => Expression::Array(read_exprs(arena, nodes, *ni)),
        ASTNode::Boolean(b) => Expression::Boolean(*b),
        ASTNode::CaseExpression(c) => Expression::Case(c),
        ASTNode::ColumnRef(s) => Expression::ColumnRef(s.clone()),
        ASTNode::ConstCastExpression(c) => Expression::ConstCast(c.clone()),
        ASTNode::ExistsExpression(e) => Expression::Exists(e),
        ASTNode::Expression(e) => e.clone(),
        ASTNode::FunctionExpression(f) => Expression::FunctionCall(f),
        ASTNode::IndirectionExpression(c) => Expression::Indirection(c),
        ASTNode::ParameterRef(p) => Expression::ParameterRef(p),
        ASTNode::SelectStatementExpression(s) => Expression::SelectStatement(s),
        ASTNode::StringRef(s) => Expression::StringRef(s.clone()),
        ASTNode::SubqueryExpression(e) => Expression::Subquery(e),
        ASTNode::TypeCastExpression(c) => Expression::TypeCast(c),
        ASTNode::TypeTestExpression(t) => Expression::TypeTest(t),
        _ => {
            log::warn!("invalid expression node: {:?}", node);
            Expression::Null
        }
    }
}

fn read_exprs<'a>(alloc: &'a bumpalo::Bump, nodes: &[ASTNode<'a>], ni: usize) -> &'a [ASTCell<Expression<'a>>] {
    let exprs = alloc.alloc_slice_fill_default(nodes.len());
    for i in 0..nodes.len() {
        exprs[i] = ASTCell::with_node(read_expr(alloc, &nodes[i]), ni + i);
    }
    exprs
}

const NAME_TRIMMING: &'static [char] = &['"', ' ', '\''];
fn read_name<'a>(alloc: &'a bumpalo::Bump, nodes: &[ASTNode<'a>], ni: usize) -> NamePath<'a> {
    let path = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        path[i] = match n {
            ASTNode::StringRef(s) => ASTCell::with_node(Indirection::Name(s.trim_matches(NAME_TRIMMING)), ni + i),
            ASTNode::Indirection(indirection) => ASTCell::with_node(indirection.clone(), ni + i),
            _ => {
                log::warn!("invalid name element: {:?}", n);
                ASTCell::with_node(Indirection::default(), ni + i)
            }
        }
    }
    path
}

fn read_expression_operator<'a>(alloc: &'a bumpalo::Bump, node: &ASTNode<'a>) -> ExpressionOperatorName<'a> {
    match &node {
        ASTNode::ExpressionOperator(op) => ExpressionOperatorName::Known(*op),
        ASTNode::Array(elems, ni) => {
            let path = alloc.alloc_slice_fill_default(elems.len());
            for (i, n) in elems.iter().enumerate() {
                path[i] = ASTCell::with_node(
                    match n {
                        ASTNode::StringRef(s) => *s,
                        ASTNode::ExpressionOperator(op) => op.variant_name().unwrap_or_default(),
                        _ => {
                            log::warn!("invalid expression operator name: {:?}", n);
                            "?"
                        }
                    },
                    ni + i,
                )
            }
            ExpressionOperatorName::Qualified(path)
        }
        n => {
            log::warn!("invalid expression operator name: {:?}", n);
            ExpressionOperatorName::Known(ExpressionOperator::DEFAULT)
        }
    }
}

fn read_array_bounds<'a>(alloc: &'a bumpalo::Bump, nodes: &[ASTNode<'a>]) -> &'a [ArrayBound<'a>] {
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

fn read_dson<'a>(alloc: &'a bumpalo::Bump, node: &ASTNode<'a>) -> DsonValue<'a> {
    match node {
        ASTNode::Dson(value) => value.clone(),
        ASTNode::Array(nodes, _ni) => {
            let elements = alloc.alloc_slice_fill_default(nodes.len());
            for (i, n) in nodes.iter().enumerate() {
                elements[i] = read_dson(alloc, n);
            }
            DsonValue::Array(elements)
        }
        ASTNode::Expression(e) => DsonValue::Expression(e.clone()),
        ASTNode::StringRef(s) => DsonValue::Expression(Expression::StringRef(s)),
        ASTNode::FunctionExpression(f) => DsonValue::Expression(Expression::FunctionCall(f)),
        e => DsonValue::Expression(read_expr(alloc, e)),
    }
}
