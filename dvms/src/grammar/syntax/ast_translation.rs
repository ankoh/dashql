use super::ast_cell::*;
use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::program::*;
use crate::error::RawError;
use dashql_proto::syntax as sx;
use dashql_proto::syntax::ExpressionOperator;
use dashql_proto::syntax::GroupByItemType;
use std::error::Error;
use sx::AttributeKey as Key;

#[inline(never)]
#[cold]
fn oom() -> ! {
    panic!("out of memory")
}

pub fn deserialize_ast<'a>(
    arena: &'a bumpalo::Bump,
    text: &'a str,
    buffer: sx::Program<'a>,
) -> Result<Program<'a>, Box<dyn Error + Send + Sync>> {
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

        // Helper to mark an unexpected attribute
        macro_rules! err_unexpected_attr {
            ($node:expr, $key:expr, $child:expr) => {
                return Err(RawError::from(format!(
                    "unexpected attribute: {:?}.{} => {:?}",
                    $node,
                    $key.variant_name().unwrap_or(&format!("{}", $key.0)),
                    $child
                ))
                .boxed())
            };
        }
        // Helper to mark an unexpected array element
        macro_rules! err_unexpected_element {
            ($key:expr, $value:expr) => {
                return Err(RawError::from(format!(
                    "unexpected element: {}[] => {:?}",
                    $key.variant_name().unwrap_or_default(),
                    $value
                ))
                .boxed())
            };
        }
        // Helper to read integer as enum
        macro_rules! as_enum {
            ($name:ident) => {
                ASTNode::$name(sx::$name(value as u8))
            };
        }
        // Helper to read attributes
        macro_rules! read_attributes {
            ($($matcher:pat => $result:expr),*) => {
                for i in 0..children.len() {
                    let k = sx::AttributeKey(buffer_nodes[children_begin + i].attribute_key());
                    match (k, &children[i], children_begin + i) {
                        $($matcher => $result),*,
                        (k, c, _ci) => err_unexpected_attr!(node_type, k, c),
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
            sx::NodeType::NONE => ASTNode::Null,
            sx::NodeType::BOOL => ASTNode::Boolean((node.children_begin_or_value() != 0).into()),
            sx::NodeType::UI32 => ASTNode::UInt32(node.children_begin_or_value()),
            sx::NodeType::UI32_BITMAP => ASTNode::UInt32Bitmap(node.children_begin_or_value()),
            sx::NodeType::STRING_REF => ASTNode::StringRef(
                &text[(node.location().offset() as usize)
                    ..((node.location().offset() + node.location().length()) as usize)],
            ),
            sx::NodeType::ARRAY => ASTNode::Array(arena.alloc_slice_copy(children), children_begin),

            sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => as_enum!(VizComponentType),
            sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE => as_enum!(InputComponentType),
            sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE => as_enum!(FetchMethodType),
            sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => as_enum!(LoadMethodType),
            sx::NodeType::ENUM_SQL_CHARACTER_TYPE => as_enum!(CharacterType),
            sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => as_enum!(ColumnConstraint),
            sx::NodeType::ENUM_SQL_COMBINE_MODIFIER => as_enum!(CombineModifier),
            sx::NodeType::ENUM_SQL_COMBINE_OPERATION => as_enum!(CombineOperation),
            sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => as_enum!(ConstraintAttribute),
            sx::NodeType::ENUM_SQL_CONST_TYPE => ASTNode::ConstType(sx::AConstType(value as u8)),
            sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => as_enum!(ExpressionOperator),
            sx::NodeType::ENUM_SQL_EXTRACT_TARGET => as_enum!(ExtractTarget),
            sx::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE => as_enum!(GroupByItemType),
            sx::NodeType::ENUM_SQL_INTERVAL_TYPE => as_enum!(IntervalType),
            sx::NodeType::ENUM_SQL_KNOWN_FUNCTION => as_enum!(KnownFunction),
            sx::NodeType::ENUM_SQL_NUMERIC_TYPE => as_enum!(NumericType),
            sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION => as_enum!(OnCommitOption),
            sx::NodeType::ENUM_SQL_ORDER_DIRECTION => as_enum!(OrderDirection),
            sx::NodeType::ENUM_SQL_ORDER_NULL_RULE => as_enum!(OrderNullRule),
            sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => as_enum!(SubqueryQuantifier),
            sx::NodeType::ENUM_SQL_TEMP_TYPE => as_enum!(TempType),
            sx::NodeType::ENUM_SQL_TRIM_TARGET => as_enum!(TrimDirection),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => as_enum!(WindowBoundDirection),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => as_enum!(WindowBoundMode),
            sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => as_enum!(WindowExclusionMode),
            sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => as_enum!(WindowRangeMode),
            sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => as_enum!(RowLockingBlockBehavior),
            sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => as_enum!(RowLockingStrength),
            sx::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => as_enum!(SampleCountUnit),
            sx::NodeType::ENUM_SQL_JOIN_TYPE => as_enum!(JoinType),

            sx::NodeType::OBJECT_SQL_INDIRECTION => {
                let mut value = ASTCell::with_value(Expression::Null);
                let mut path = ASTCell::with_value(NamePath::default());
                read_attributes! {
                    (Key::SQL_INDIRECTION_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_INDIRECTION_PATH, ASTNode::Array(nodes, ni), ci) => path = ASTCell::with_node(read_name(arena, nodes, *ni), ci)
                }
                ASTNode::IndirectionExpression(arena.alloc(IndirectionExpression { value, path }))
            }
            sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX => {
                let mut val = None;
                let mut lb = None;
                let mut ub = None;
                read_attributes! {
                    (Key::SQL_INDIRECTION_INDEX_VALUE, n, ci) => val = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_INDIRECTION_INDEX_LOWER_BOUND, n, ci) => lb = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_INDIRECTION_INDEX_UPPER_BOUND, n, ci) => ub = Some(ASTCell::with_node(read_expr!(n), ci))
                }
                ASTNode::Indirection(if let Some(val) = val {
                    Indirection::Index(arena.alloc(IndirectionIndex { value: val }))
                } else {
                    Indirection::Bounds(arena.alloc(IndirectionBounds {
                        lower_bound: lb.unwrap_or(ASTCell::with_value(Expression::Null)),
                        upper_bound: ub.unwrap_or(ASTCell::with_value(Expression::Null)),
                    }))
                })
            }
            sx::NodeType::OBJECT_SQL_NUMERIC_TYPE => {
                let mut base = ASTCell::with_value(sx::NumericType::NUMERIC);
                let mut modifiers: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_NUMERIC_TYPE_BASE, ASTNode::NumericType(t), ci) => base = ASTCell::with_node(*t, ci),
                    (Key::SQL_NUMERIC_TYPE_MODIFIERS, ASTNode::Array(nodes, ni), ci) => modifiers = ASTCell::with_node(read_exprs(arena, nodes, *ni), ci)
                }
                ASTNode::NumericTypeSpec(arena.alloc(NumericType { base, modifiers }))
            }
            sx::NodeType::OBJECT_SQL_BIT_TYPE => {
                let mut varying = false;
                let mut length = None;
                read_attributes! {
                    (Key::SQL_BIT_TYPE_LENGTH, e, _ci) => length = Some(read_expr!(e)),
                    (Key::SQL_BIT_TYPE_VARYING, ASTNode::Boolean(b), _ci) => varying = *b
                }
                ASTNode::BitTypeSpec(arena.alloc(BitType { varying, length }))
            }
            sx::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                let mut name = None;
                let mut modifiers: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s), ci) => name = Some(ASTCell::with_node(s.clone(), ci)),
                    (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a, ni), ci) => modifiers = ASTCell::with_node(read_exprs(arena, a, *ni), ci)
                }
                ASTNode::GenericTypeSpec(arena.alloc(GenericType {
                    name: name.unwrap_or_default(),
                    modifiers,
                }))
            }
            sx::NodeType::OBJECT_SQL_ORDER => {
                let mut value = None;
                let mut direction = None;
                let mut null_rule = None;
                read_attributes! {
                    (Key::SQL_ORDER_VALUE, n, ci) => value = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_ORDER_DIRECTION, ASTNode::OrderDirection(d), ci) => direction = Some(ASTCell::with_node(d.clone(), ci)),
                    (Key::SQL_ORDER_NULLRULE, ASTNode::OrderNullRule(n), ci) => null_rule = Some(ASTCell::with_node(n.clone(), ci))
                }
                ASTNode::OrderSpecification(arena.alloc(OrderSpecification {
                    value: value.unwrap_or(ASTCell::with_value(Expression::Null)),
                    direction,
                    null_rule,
                }))
            }
            sx::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                let mut ty = None;
                let mut precision = None;
                read_attributes! {
                    (Key::SQL_INTERVAL_TYPE, ASTNode::IntervalType(t), ci) => ty = Some(ASTCell::with_node(t.clone(), ci)),
                    (Key::SQL_INTERVAL_PRECISION, ASTNode::StringRef(s), ci) => precision = Some(ASTCell::with_node(s.clone(), ci))
                }
                ASTNode::IntervalSpecification(arena.alloc(IntervalSpecification {
                    interval_type: ty,
                    precision: precision,
                }))
            }
            sx::NodeType::OBJECT_SQL_RESULT_TARGET => {
                let mut value = None;
                let mut alias = None;
                let mut star = false;
                read_attributes! {
                    (Key::SQL_RESULT_TARGET_STAR, ASTNode::Boolean(b), _) => star = *b,
                    (Key::SQL_RESULT_TARGET_VALUE, n, ci) => value = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_RESULT_TARGET_NAME, ASTNode::StringRef(s), ci) => alias = Some(ASTCell::with_node(s.clone(), ci))
                }
                ASTNode::ResultTarget(arena.alloc(if star {
                    ResultTarget::Star
                } else {
                    ResultTarget::Value {
                        value: value.unwrap_or(ASTCell::with_value(Expression::Null)),
                        alias,
                    }
                }))
            }
            sx::NodeType::OBJECT_SQL_PARAMETER_REF => {
                let mut prefix = ASTCell::with_value("");
                let mut name = ASTCell::with_value(NamePath::default());
                read_attributes! {
                    (Key::SQL_PARAMETER_PREFIX, ASTNode::StringRef(p), ci) => prefix = ASTCell::with_node(p, ci),
                    (Key::SQL_PARAMETER_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci)
                }
                ASTNode::ParameterRef(arena.alloc(ParameterRef { prefix, name }))
            }
            sx::NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                let args = arena.alloc_slice_fill_default(3);
                let mut operator_name =
                    ASTCell::with_value(ExpressionOperatorName::Known(sx::ExpressionOperator::PLUS));
                let mut postfix = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_EXPRESSION_ARG0, n, ci) => args[0] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_ARG1, n, ci) => args[1] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_ARG2, n, ci) => args[2] = ASTCell::with_node(read_expr!(n), ci),
                    (Key::SQL_EXPRESSION_POSTFIX, ASTNode::Boolean(v), ci) => postfix = ASTCell::with_node(*v, ci),
                    (Key::SQL_EXPRESSION_OPERATOR, n, ci) => operator_name = ASTCell::with_node(read_expression_operator(arena, n), ci)
                }
                ASTNode::Expression(Expression::Nary(arena.alloc(NaryExpression {
                    operator: operator_name,
                    args,
                    postfix,
                })))
            }
            sx::NodeType::OBJECT_SQL_CASE_CLAUSE => {
                let mut when = ASTCell::with_value(Expression::Null);
                let mut then = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_CASE_CLAUSE_WHEN, e, ci) => when = ASTCell::with_node(read_expr!(e), ci),
                    (Key::SQL_CASE_CLAUSE_THEN, e, ci) => then = ASTCell::with_node(read_expr!(e), ci)
                }
                ASTNode::CaseExpressionClause(arena.alloc(CaseExpressionClause { when, then }))
            }
            sx::NodeType::OBJECT_SQL_CASE => {
                let mut argument = None;
                let mut cases: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut default = None;
                read_attributes! {
                    (Key::SQL_CASE_ARGUMENT, n, ci) => argument = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_CASE_CLAUSES, ASTNode::Array(nodes, ni), ci) => cases = ASTCell::with_node(unpack_nodes!(nodes, ni, CaseExpressionClause), ci),
                    (Key::SQL_CASE_DEFAULT, n, ci) => default = Some(ASTCell::with_node(read_expr!(n), ci))
                }
                ASTNode::CaseExpression(arena.alloc(CaseExpression {
                    argument,
                    cases,
                    default,
                }))
            }
            sx::NodeType::OBJECT_SQL_TABLEREF => {
                let mut name = None;
                let mut inherit = false;
                let mut select = None;
                let mut joined = None;
                let mut func = None;
                let mut alias = None;
                let mut lateral = false;
                let mut sample = None;
                read_attributes! {
                    (Key::SQL_TABLEREF_NAME, ASTNode::Array(n, ni), _ci) => name = Some(read_name(arena, n, *ni)),
                    (Key::SQL_TABLEREF_INHERIT, ASTNode::Boolean(v), _ci) => inherit = *v,
                    (Key::SQL_TABLEREF_TABLE, ASTNode::SelectStatement(s), _ci) => select = Some(s),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::JoinedTable(t), _ci) => joined = Some(t),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::FunctionTable(t), _ci) => func = Some(t),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::Alias(a), _ci) => alias = Some(*a),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::StringRef(s), _ci) => {
                        alias = Some(arena.alloc(Alias {
                            name: s,
                            column_names: &[],
                            column_definitions: &[],
                        }))
                    },
                    (Key::SQL_TABLEREF_LATERAL, ASTNode::Boolean(v), _ci) => lateral = *v,
                    (Key::SQL_TABLEREF_SAMPLE, ASTNode::TableSample(s), _ci) => sample = Some(*s)
                }
                ASTNode::TableRef(if let Some(table) = select {
                    TableRef::Select(arena.alloc(SelectStatementRef {
                        table,
                        alias,
                        sample,
                        lateral,
                    }))
                } else if let Some(table) = joined {
                    TableRef::Join(arena.alloc(JoinedTableRef { table, alias }))
                } else if let Some(table) = func {
                    TableRef::Function(arena.alloc(FunctionTableRef {
                        table,
                        alias,
                        sample,
                        lateral,
                    }))
                } else if let Some(name) = name {
                    TableRef::Relation(arena.alloc(RelationRef { name, inherit, alias }))
                } else {
                    return Err(RawError::from(format!("invalid table ref")).boxed());
                })
            }
            sx::NodeType::OBJECT_SQL_TABLEREF_SAMPLE => {
                let mut function = None;
                let mut count = None;
                let mut count_unit = None;
                let mut repeat = None;
                let mut seed = None;
                read_attributes! {
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(s), _ci) => function = Some(s.clone()),
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(s), _ci) => repeat = Some(s.clone()),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(s), _ci) => seed = Some(s.clone()),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(v), _ci) => count = Some(v.clone()),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u), _ci) => count_unit = Some(u.clone())
                }
                ASTNode::TableSample(arena.alloc(TableSample {
                    function: function,
                    count: count.unwrap_or_default(),
                    unit: count_unit.unwrap_or(sx::SampleCountUnit::ROWS),
                    repeat,
                    seed,
                }))
            }
            sx::NodeType::OBJECT_SQL_CONST_TYPE_CAST => {
                let mut sql_type = None;
                let mut value = None;
                read_attributes! {
                    (Key::SQL_CONST_CAST_TYPE, ASTNode::SQLType(s), ci) => sql_type = Some(ASTCell::with_node(*s, ci)),
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = Some(ASTCell::with_node(t.clone(), ci))
                }
                let cast = arena.alloc(ConstTypeCastExpression {
                    sql_type: sql_type.unwrap(),
                    value: value.unwrap_or_default(),
                });
                ASTNode::ConstCastExpression(ConstCastExpression::Type(cast))
            }
            sx::NodeType::OBJECT_SQL_CONST_INTERVAL_CAST => {
                let mut interval = None;
                let mut value = None;
                read_attributes! {
                    (Key::SQL_CONST_CAST_INTERVAL, ASTNode::IntervalSpecification(t), ci) => interval = Some(ASTCell::with_node(*t, ci)),
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = Some(ASTCell::with_node(t.clone(), ci))
                }
                let cast = arena.alloc(ConstIntervalCastExpression {
                    value: value.unwrap_or_default(),
                    interval: interval.unwrap(),
                });
                ASTNode::ConstCastExpression(ConstCastExpression::Interval(cast))
            }
            sx::NodeType::OBJECT_SQL_CONST_FUNCTION_CAST => {
                let mut func_name = None;
                let mut func_args: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut func_arg_ordering: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut value = None;
                read_attributes! {
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t), ci) => value = Some(ASTCell::with_node(t.clone(), ci)),
                    (Key::SQL_CONST_CAST_FUNC_NAME, ASTNode::Array(n, ni), ci) => func_name = Some(ASTCell::with_node(read_name(arena, n, *ni), ci)),
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
            sx::NodeType::OBJECT_SQL_ALIAS => {
                let mut name = "";
                let mut column_names: &[_] = &[];
                let mut column_definitions: &[_] = &[];
                read_attributes! {
                    (Key::SQL_ALIAS_NAME, ASTNode::StringRef(s), _ci) => name = s,
                    (Key::SQL_ALIAS_COLUMN_NAMES, ASTNode::Array(nodes, ni), _ci) => column_names = unpack_strings!(nodes, ni, StringRef),
                    (Key::SQL_ALIAS_COLUMN_DEFS, ASTNode::Array(nodes, ni), _ci) => column_definitions = unpack_nodes!(nodes, ni, ColumnDefinition)
                }
                ASTNode::Alias(arena.alloc(Alias {
                    name,
                    column_names,
                    column_definitions,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_FETCH => {
                let mut name = NamePath::default();
                let mut method = sx::FetchMethodType::NONE;
                let mut from_uri = None;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a, ni), _ci) => name = read_name(arena, a, *ni),
                    (Key::DASHQL_FETCH_METHOD, ASTNode::FetchMethodType(m), _ci) => method = m.clone(),
                    (Key::DASHQL_FETCH_FROM_URI, n, _ci) => from_uri = Some(read_expr!(n)),
                    (Key::DASHQL_FETCH_EXTRA, n, _ci) => extra = Some(read_dson(arena, n))
                }
                ASTNode::FetchStatement(arena.alloc(FetchStatement {
                    name,
                    method,
                    from_uri,
                    extra,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_LOAD => {
                let mut name = NamePath::default();
                let mut source = NamePath::default();
                let mut method = sx::LoadMethodType::NONE;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a, ni), _ci) => name = read_name(arena, a, *ni),
                    (Key::DASHQL_DATA_SOURCE, ASTNode::Array(a, ni), _ci) => source = read_name(arena, a, *ni),
                    (Key::DASHQL_LOAD_METHOD, ASTNode::LoadMethodType(m), _ci) => method = m.clone(),
                    (Key::DASHQL_LOAD_EXTRA, n, _ci) => extra = Some(read_dson(arena, n))
                }
                ASTNode::LoadStatement(arena.alloc(LoadStatement {
                    name,
                    source,
                    method,
                    extra,
                }))
            }
            sx::NodeType::OBJECT_SQL_JOINED_TABLE => {
                let mut join = sx::JoinType::NONE;
                let mut qualifier = None;
                let mut input: &[_] = &[];
                read_attributes! {
                    (Key::SQL_JOIN_TYPE, ASTNode::JoinType(t), _ci) => join = t.clone(),
                    (Key::SQL_JOIN_ON, n, _ci) => qualifier = Some(JoinQualifier::On(read_expr!(n))),
                    (Key::SQL_JOIN_USING, ASTNode::Array(nodes, ni), _ci) => {
                        let using = unpack_strings!(nodes, ni, StringRef);
                        qualifier = Some(JoinQualifier::Using(using));
                    },
                    (Key::SQL_JOIN_INPUT, ASTNode::Array(nodes, ni), _ci) => input = unpack_nodes!(nodes, ni, TableRef)
                }
                ASTNode::JoinedTable(arena.alloc(JoinedTable { join, qualifier, input }))
            }
            sx::NodeType::OBJECT_SQL_ROWSFROM_ITEM => {
                let mut function = None;
                let mut columns: &[_] = &[];
                read_attributes! {
                    (Key::SQL_ROWSFROM_ITEM_FUNCTION, ASTNode::FunctionExpression(f), _ci) => function = Some(f),
                    (Key::SQL_ROWSFROM_ITEM_COLUMNS, ASTNode::Array(nodes, ni), _ci) => columns = unpack_nodes!(nodes, ni, ColumnDefinition)
                }
                ASTNode::RowsFromItem(arena.alloc(RowsFromItem {
                    function: function.unwrap(),
                    columns,
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TABLE => {
                let mut function = None;
                let mut ordinality = false;
                let mut rows_from: &[_] = &[];
                read_attributes! {
                    (Key::SQL_FUNCTION_TABLE_FUNCTION, ASTNode::FunctionExpression(f), _ci) => function = Some(*f),
                    (Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY, ASTNode::Boolean(v), _ci) => ordinality = *v,
                    (Key::SQL_FUNCTION_TABLE_ROWS_FROM, ASTNode::Array(nodes, ni), _ci) => rows_from = unpack_nodes!(nodes, ni, RowsFromItem)
                }
                ASTNode::FunctionTable(arena.alloc(FunctionTable {
                    function,
                    rows_from,
                    with_ordinality: ordinality,
                }))
            }
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                let mut name: Option<NamePath> = None;
                read_attributes! {
                    (Key::SQL_COLUMN_REF_PATH, ASTNode::Array(a, ni), _ci) => name = Some(read_name(arena, a, *ni))
                }
                ASTNode::ColumnRef(name.unwrap_or_default())
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_ARG => {
                let mut name = None;
                let mut value = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s), _ci) => name = Some(s.clone()),
                    (Key::SQL_FUNCTION_ARG_VALUE, n, _ci) => value = Some(read_expr!(n))
                }
                ASTNode::FunctionArgument(arena.alloc(FunctionArgument {
                    name: name,
                    value: value.unwrap_or(Expression::Null),
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TRIM_ARGS => {
                let mut direction = sx::TrimDirection::LEADING;
                let mut characters = None;
                let mut input: &[_] = &[];
                read_attributes! {
                    (Key::SQL_FUNCTION_TRIM_CHARACTERS, n, _ci) => characters = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_TRIM_INPUT, ASTNode::Array(nodes, ni), _ci) => input = read_exprs(arena, nodes, *ni),
                    (Key::SQL_FUNCTION_TRIM_DIRECTION, ASTNode::TrimDirection(d), _ci) => direction = *d
                }
                ASTNode::TrimFunctionArguments(arena.alloc(TrimFunctionArguments {
                    direction,
                    characters,
                    input,
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_SUBSTRING_ARGS => {
                let mut input = None;
                let mut substr_from = None;
                let mut substr_for = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_SUBSTRING_INPUT, n, _ci) => input = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_SUBSTRING_FROM, n, _ci) => substr_from = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_SUBSTRING_FOR, n, _ci) => substr_for = Some(read_expr!(n))
                }
                ASTNode::SubstringFunctionArguments(arena.alloc(SubstringFunctionArguments {
                    input: input.unwrap(),
                    substr_for,
                    substr_from,
                }))
            }
            sx::NodeType::OBJECT_SQL_GENERIC_OPTION => {
                let mut key = ASTCell::with_value("");
                let mut value = ASTCell::with_value("");
                read_attributes! {
                    (Key::SQL_GENERIC_OPTION_KEY, ASTNode::StringRef(k), ci) => key = ASTCell::with_node(k, ci),
                    (Key::SQL_GENERIC_OPTION_VALUE, ASTNode::StringRef(v), ci) => value = ASTCell::with_node(v, ci)
                }
                ASTNode::GenericOption(arena.alloc(GenericOption { key, value }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_OVERLAY_ARGS => {
                let mut input = None;
                let mut placing = None;
                let mut substr_from = None;
                let mut substr_for = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_OVERLAY_INPUT, n, _ci) => input = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_OVERLAY_PLACING, n, _ci) => placing = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_OVERLAY_FROM, n, _ci) => substr_from = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_OVERLAY_FOR, n, _ci) => substr_for = Some(read_expr!(n))
                }
                ASTNode::OverlayFunctionArguments(arena.alloc(OverlayFunctionArguments {
                    input: input.unwrap(),
                    placing: placing.unwrap(),
                    substr_from: substr_from.unwrap(),
                    substr_for,
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_POSITION_ARGS => {
                let mut input = None;
                let mut search = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_POSITION_SEARCH, n, _ci) => search = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_POSITION_INPUT, n, _ci) => input = Some(read_expr!(n))
                }
                ASTNode::PositionFunctionArguments(arena.alloc(PositionFunctionArguments {
                    input: input.unwrap(),
                    search: search.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_EXTRACT_ARGS => {
                let mut target = ExtractFunctionTarget::Known(sx::ExtractTarget::SECOND);
                let mut input = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::StringRef(s), _ci) => target = ExtractFunctionTarget::Unknown(s),
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::ExtractTarget(t), _ci) => target = ExtractFunctionTarget::Known(*t),
                    (Key::SQL_FUNCTION_EXTRACT_INPUT, n, _ci) => input = Some(read_expr!(n))
                }
                ASTNode::ExtractFunctionArguments(arena.alloc(ExtractFunctionArguments {
                    target,
                    input: input.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_CAST_ARGS => {
                let mut value = None;
                let mut as_type = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_CAST_VALUE, n, _ci) => value = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_CAST_TYPE, ASTNode::SQLType(t), _ci) => as_type = Some(t)
                }
                ASTNode::CastFunctionArguments(arena.alloc(CastFunctionArguments {
                    value: value.unwrap(),
                    as_type: as_type.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TREAT_ARGS => {
                let mut value = None;
                let mut as_type = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_TREAT_VALUE, n, _ci) => value = Some(read_expr!(n)),
                    (Key::SQL_FUNCTION_TREAT_TYPE, ASTNode::SQLType(t), _ci) => as_type = Some(t)
                }
                ASTNode::TreatFunctionArguments(arena.alloc(TreatFunctionArguments {
                    value: value.unwrap(),
                    as_type: as_type.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let mut func_name = FunctionName::default();
                let mut func_args: &[_] = &[];
                let mut arg_ordering: &[_] = &[];
                let mut args_known = None;
                let mut within_group: &[_] = &[];
                let mut filter = Expression::Null;
                let mut all = false;
                let mut distinct = false;
                let mut variadic = None;
                let mut over = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_VARIADIC, ASTNode::FunctionArgument(arg), _ci) => variadic = Some(*arg),
                    (Key::SQL_FUNCTION_ALL, ASTNode::Boolean(b), _ci) => all = *b,
                    (Key::SQL_FUNCTION_DISTINCT, ASTNode::Boolean(b), _ci) => distinct = *b,
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s), _ci) => func_name = FunctionName::Unknown(s),
                    (Key::SQL_FUNCTION_NAME, ASTNode::KnownFunction(f), _ci) => func_name = FunctionName::Known(f.clone()),
                    (Key::SQL_FUNCTION_ORDER, ASTNode::Array(nodes, ni), _ci) => arg_ordering = unpack_nodes!(nodes, ni, OrderSpecification),
                    (Key::SQL_FUNCTION_WITHIN_GROUP, ASTNode::Array(nodes, ni), _ci) => within_group = unpack_nodes!(nodes, ni, OrderSpecification),
                    (Key::SQL_FUNCTION_FILTER, n, _ci) => filter = read_expr!(n),
                    (Key::SQL_FUNCTION_OVER, ASTNode::WindowFrame(f), _ci) => over = Some(*f),
                    (Key::SQL_FUNCTION_ARGUMENTS, ASTNode::Array(nodes, ni), _ci) => {
                        type Arg<'a> = ASTCell<&'a FunctionArgument<'a>>;
                        let args_layout = std::alloc::Layout::array::<Arg<'a>>(nodes.len()).unwrap_or_else(|_| oom());
                        let args_mem = arena.alloc_layout(args_layout).cast::<Arg<'a>>();
                        for (i, node) in nodes.iter().enumerate() {
                            let arg = match node {
                                ASTNode::FunctionArgument(t) => ASTCell::with_node(t.clone(), ni + i),
                                e => {
                                    let arg: &'a FunctionArgument = arena.alloc(FunctionArgument {
                                        name: None,
                                        value: read_expr!(e),
                                    });
                                    ASTCell::with_node(arg, ni + i)
                                },
                            };
                            unsafe {
                                std::ptr::write(args_mem.as_ptr().add(i), arg);
                            }
                        }
                        func_args = unsafe { std::slice::from_raw_parts(args_mem.as_ptr(), nodes.len()) };
                    },
                    (Key::SQL_FUNCTION_TRIM_ARGS, ASTNode::TrimFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Trim(a)),
                    (Key::SQL_FUNCTION_OVERLAY_ARGS, ASTNode::OverlayFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Overlay(a)),
                    (Key::SQL_FUNCTION_POSITION_ARGS, ASTNode::PositionFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Position(a)),
                    (Key::SQL_FUNCTION_SUBSTRING_ARGS, ASTNode::SubstringFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Substring(a)),
                    (Key::SQL_FUNCTION_EXTRACT_ARGS, ASTNode::ExtractFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Extract(a)),
                    (Key::SQL_FUNCTION_CAST_ARGS, ASTNode::CastFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Cast(a)),
                    (Key::SQL_FUNCTION_TREAT_ARGS, ASTNode::TreatFunctionArguments(a), _ci) => args_known = Some(KnownFunctionArguments::Treat(a))
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
            sx::NodeType::OBJECT_SQL_TYPECAST_EXPRESSION => {
                let mut value = None;
                let mut typename = None;
                read_attributes! {
                    (Key::SQL_TYPECAST_VALUE, v, ci) => value = Some(ASTCell::with_node(read_expr!(v), ci)),
                    (Key::SQL_TYPECAST_TYPE, ASTNode::SQLType(t), ci) => typename = Some(ASTCell::with_node(t.clone(), ci))
                }
                ASTNode::TypeCastExpression(arena.alloc(TypeCastExpression {
                    sql_type: typename.unwrap(),
                    value: value.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_SUBQUERY_EXPRESSION => {
                let mut arg0 = ASTCell::with_value(Expression::Null);
                let mut arg1 = ASTCell::with_value(Expression::Null);
                let mut operator_name =
                    ASTCell::with_value(ExpressionOperatorName::Known(sx::ExpressionOperator::PLUS));
                let mut quantifier = ASTCell::with_value(sx::SubqueryQuantifier::ALL);
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
            sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION => {
                let mut stmt = None;
                let mut indirection = None;
                read_attributes! {
                    (Key::SQL_SELECT_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = Some(ASTCell::with_node(*s, ci)),
                    (Key::SQL_SELECT_EXPRESSION_INDIRECTION, ASTNode::Array(a, ni), ci) => indirection = Some(ASTCell::with_node(read_name(arena, a, *ni), ci))
                }
                ASTNode::SelectStatementExpression(arena.alloc(SelectStatementExpression {
                    statement: stmt.unwrap(),
                    indirection,
                }))
            }
            sx::NodeType::OBJECT_SQL_EXISTS_EXPRESSION => {
                let mut stmt = None;
                read_attributes! {
                    (Key::SQL_EXISTS_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = Some(ASTCell::with_node(*s, ci))
                }
                ASTNode::ExistsExpression(arena.alloc(ExistsExpression {
                    statement: stmt.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s), _ci) => precision = Some(s.clone()),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz), _ci) => with_timezone = *tz
                }
                ASTNode::TimestampTypeSpec(arena.alloc(TimestampType {
                    precision,
                    with_timezone,
                }))
            }
            sx::NodeType::OBJECT_SQL_TIME_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s), _ci) => precision = Some(s.clone()),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz), _ci) => with_timezone = *tz
                }
                ASTNode::TimeTypeSpec(arena.alloc(TimeType {
                    precision,
                    with_timezone,
                }))
            }
            sx::NodeType::OBJECT_SQL_GROUP_BY_ITEM => {
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
                    _ => return Err(RawError::from(format!("invalid group by item type: {:?}", item_type)).boxed()),
                };
                ASTNode::GroupByItem(item)
            }
            sx::NodeType::OBJECT_SQL_TYPENAME => {
                let mut base = None;
                let mut set_of = false;
                let mut array_bounds: &[_] = &[];
                read_attributes! {
                    (Key::SQL_TYPENAME_TYPE, ASTNode::GenericTypeSpec(t), _ci) => base = Some(SQLBaseType::Generic(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericTypeSpec(t), _ci) => base = Some(SQLBaseType::Numeric(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericType(t), ci) => {
                        base = Some(SQLBaseType::Numeric(arena.alloc(NumericType {
                            base: ASTCell::with_node(*t, ci),
                            modifiers: ASTCell::with_value(&[]),
                        })))
                    },
                    (Key::SQL_TYPENAME_TYPE, ASTNode::TimeTypeSpec(t), _ci) => base = Some(SQLBaseType::Time(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::BitTypeSpec(t), _ci) => base = Some(SQLBaseType::Bit(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::CharacterTypeSpec(t), _ci) => base = Some(SQLBaseType::Character(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::TimestampTypeSpec(t), _ci) => base = Some(SQLBaseType::Timestamp(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::IntervalSpecification(t), _ci) => base = Some(SQLBaseType::Interval(t.clone())),
                    (Key::SQL_TYPENAME_SETOF, ASTNode::Boolean(b), _ci) => set_of = *b,
                    (Key::SQL_TYPENAME_ARRAY, ASTNode::Array(n, _ni), _ci) => array_bounds = read_array_bounds(arena, n)
                }
                ASTNode::SQLType(arena.alloc(SQLType {
                    base_type: base.unwrap_or(SQLBaseType::Invalid),
                    set_of,
                    array_bounds,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT => {
                let mut component_type = None;
                let mut type_modifiers = 0_u32;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_VIZ_COMPONENT_TYPE, ASTNode::VizComponentType(t), _ci) => component_type = Some(t.clone()),
                    (Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ASTNode::UInt32Bitmap(mods), _ci) => type_modifiers = *mods,
                    (Key::DASHQL_VIZ_COMPONENT_EXTRA, n, _ci) => extra = Some(read_dson(arena, n))
                }
                ASTNode::VizComponent(arena.alloc(VizComponent {
                    component_type,
                    type_modifiers,
                    extra,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_VIZ => {
                let mut target = None;
                let mut components: &[_] = &[];
                read_attributes! {
                    (Key::DASHQL_VIZ_TARGET, ASTNode::TableRef(t), _ci) => target = Some(t.clone()),
                    (Key::DASHQL_VIZ_COMPONENTS, ASTNode::Array(nodes, ni), _ci) => components = unpack_nodes!(nodes, ni, VizComponent)
                }
                ASTNode::VizStatement(arena.alloc(VizStatement {
                    target: target.unwrap(),
                    components,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_INPUT => {
                let mut name = NamePath::default();
                let mut value_type = None;
                let mut component_type = Some(sx::InputComponentType::NONE);
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(n, ni), _ci) => name = read_name(arena, n, *ni),
                    (Key::DASHQL_INPUT_VALUE_TYPE, ASTNode::SQLType(t), _ci) => value_type = Some(t),
                    (Key::DASHQL_INPUT_COMPONENT_TYPE, ASTNode::InputComponentType(t), _ci) => component_type = Some(t.clone()),
                    (Key::DASHQL_INPUT_EXTRA, n, _ci) => extra = Some(read_dson(arena, n))
                }
                ASTNode::InputStatement(arena.alloc(InputStatement {
                    name,
                    value_type: value_type.unwrap(),
                    component_type,
                    extra,
                }))
            }
            sx::NodeType::OBJECT_DASHQL_SET => {
                let mut value = None;
                read_attributes! {
                    (Key::DASHQL_SET_FIELDS, n, _ci) => value = Some(read_dson(arena, n))
                }
                ASTNode::SetStatement(arena.alloc(SetStatement { fields: value.unwrap() }))
            }
            sx::NodeType::OBJECT_SQL_CHARACTER_TYPE => {
                let mut base = sx::CharacterType::VARCHAR;
                let mut length = None;
                read_attributes! {
                    (Key::SQL_CHARACTER_TYPE, ASTNode::CharacterType(c), _ci) => base = c.clone(),
                    (Key::SQL_CHARACTER_TYPE_LENGTH, ASTNode::StringRef(l), _ci) => length = Some(l.clone())
                }
                ASTNode::CharacterTypeSpec(arena.alloc(CharacterType { base, length }))
            }
            sx::NodeType::OBJECT_SQL_INTO => {
                let mut temp_type = sx::TempType::DEFAULT;
                let mut temp_name = NamePath::default();
                read_attributes! {
                    (Key::SQL_TEMP_NAME, ASTNode::Array(nodes, ni), _ci) => temp_name = read_name(arena, nodes, *ni),
                    (Key::SQL_TEMP_TYPE, ASTNode::TempType(t), _ci) => temp_type = t.clone()
                }
                ASTNode::Into(arena.alloc(Into {
                    temp: temp_type,
                    name: temp_name,
                }))
            }
            sx::NodeType::OBJECT_SQL_DEF_ARG => {
                let mut name = ASTCell::with_value("");
                let mut value = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_DEFINITION_ARG_KEY, ASTNode::StringRef(n), ci) => name = ASTCell::with_node(n, ci),
                    (Key::SQL_DEFINITION_ARG_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::ColumnConstraintArgument(arena.alloc(ColumnConstraintArgument { name, value }))
            }
            sx::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT => {
                let mut constraint_name = None;
                let mut constraint_type = None;
                let mut arguments: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut value = None;
                let mut no_inherit = ASTCell::with_value(false);
                read_attributes! {
                    (Key::SQL_COLUMN_CONSTRAINT_TYPE, ASTNode::ColumnConstraint(c), ci) => constraint_type = Some(ASTCell::with_node(c.clone(), ci)),
                    (Key::SQL_COLUMN_CONSTRAINT_NAME, ASTNode::StringRef(n), ci) => constraint_name = Some(ASTCell::with_node(n.clone(), ci)),
                    (Key::SQL_COLUMN_CONSTRAINT_VALUE, n, ci) => value = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_COLUMN_CONSTRAINT_DEFINITION, ASTNode::Array(nodes, ni), ci) => arguments = ASTCell::with_node(unpack_nodes!(nodes, ni, ColumnConstraintArgument), ci),
                    (Key::SQL_COLUMN_CONSTRAINT_NO_INHERIT, ASTNode::Boolean(b), ci) => no_inherit = ASTCell::with_node(*b, ci)
                }
                ASTNode::ColumnConstraintInfo(arena.alloc(ColumnConstraint {
                    constraint_name,
                    constraint_type,
                    value,
                    arguments,
                    no_inherit,
                }))
            }
            sx::NodeType::OBJECT_SQL_ROW_LOCKING => {
                let mut strength = sx::RowLockingStrength::READ_ONLY;
                let mut of: &[_] = &[];
                let mut block_behavior = None;
                read_attributes! {
                    (Key::SQL_ROW_LOCKING_STRENGTH, ASTNode::RowLockingStrength(s), _ci) => strength = s.clone(),
                    (Key::SQL_ROW_LOCKING_BLOCK_BEHAVIOR, ASTNode::RowLockingBlockBehavior(b), _ci) => {
                        block_behavior = Some(b.clone());
                    },
                    (Key::SQL_ROW_LOCKING_OF, ASTNode::Array(nodes, _ni), _ci) => {
                        let names = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::Array(path, ni) => names[i] = read_name(arena, path, *ni),
                                _ => err_unexpected_element!(sx::NodeType::OBJECT_SQL_ROW_LOCKING, node),
                            }
                        }
                        of = names;
                    }
                }
                ASTNode::RowLocking(arena.alloc(RowLocking {
                    strength,
                    of,
                    block_behavior,
                }))
            }
            sx::NodeType::OBJECT_SQL_SELECT_SAMPLE => {
                let mut function = "";
                let mut repeat = None;
                let mut seed = None;
                let mut count_value = None;
                let mut count_unit = sx::SampleCountUnit::ROWS;
                read_attributes! {
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(f), _ci) => function = f,
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(v), _ci) => repeat = Some(v.clone()),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(v), _ci) => seed = Some(v.clone()),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u), _ci) => count_unit = u.clone(),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(s), _ci) => count_value = Some(s)
                }
                ASTNode::Sample(arena.alloc(Sample {
                    function,
                    repeat,
                    seed,
                    count: count_value.map(|v| SampleCount {
                        value: v,
                        unit: count_unit,
                    }),
                }))
            }
            sx::NodeType::OBJECT_SQL_CREATE => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut elements: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut temp = None;
                let mut on_commit = None;
                read_attributes! {
                    (Key::SQL_CREATE_TABLE_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_CREATE_TABLE_TEMP, ASTNode::TempType(t), ci) => temp = Some(ASTCell::with_node(t.clone(), ci)),
                    (Key::SQL_CREATE_TABLE_ON_COMMIT, ASTNode::OnCommitOption(o), ci) => on_commit = Some(ASTCell::with_node(o.clone(), ci)),
                    (Key::SQL_CREATE_TABLE_ELEMENTS, ASTNode::Array(nodes, ni), ci) => elements = ASTCell::with_node(unpack_nodes!(nodes, ni, ColumnDefinition), ci)
                }
                ASTNode::Create(arena.alloc(CreateStatement {
                    name,
                    elements,
                    on_commit,
                    temp,
                }))
            }
            sx::NodeType::OBJECT_SQL_COLUMN_DEF => {
                let mut name = "";
                let mut sql_type = None;
                let mut collate: &[_] = &[];
                let mut options: &[_] = &[];
                let mut constraints: &[_] = &[];
                read_attributes! {
                    (Key::SQL_COLUMN_DEF_NAME, ASTNode::StringRef(n), _ci) => name = n,
                    (Key::SQL_COLUMN_DEF_TYPE, ASTNode::SQLType(t), _ci) => sql_type = Some(t),
                    (Key::SQL_COLUMN_DEF_COLLATE, ASTNode::Array(nodes, ni), _ci) => collate = unpack_strings!(nodes, ni, StringRef),
                    (Key::SQL_COLUMN_DEF_OPTIONS, ASTNode::Array(nodes, ni), _ci) => options = unpack_nodes!(nodes, ni, GenericOption),
                    (Key::SQL_COLUMN_DEF_CONSTRAINTS, ASTNode::Array(nodes, _ni), _ci) => {
                        let cs = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::ColumnConstraintInfo(c) => cs[i] = ColumnConstraintVariant::Constraint(c),
                                ASTNode::ConstraintAttribute(c) => cs[i] = ColumnConstraintVariant::Attribute(c.clone()),
                                _ => return Err(RawError::from(format!("invalid colum constraint: {:?}", node)).boxed()),
                            }
                        }
                        constraints = cs;
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
            sx::NodeType::OBJECT_SQL_CREATE_AS => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut select = None;
                let mut with_data = ASTCell::with_value(false);
                let mut if_not_exists = ASTCell::with_value(false);
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut temp = None;
                let mut on_commit = None;
                read_attributes! {
                    (Key::SQL_CREATE_AS_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_CREATE_AS_STATEMENT, ASTNode::SelectStatement(s), ci) => select = Some(ASTCell::with_node(*s, ci)),
                    (Key::SQL_CREATE_AS_WITH_DATA, ASTNode::Boolean(b), ci) => with_data = ASTCell::with_node(*b, ci),
                    (Key::SQL_CREATE_AS_IF_NOT_EXISTS, ASTNode::Boolean(b), ci) => if_not_exists = ASTCell::with_node(*b, ci),
                    (Key::SQL_CREATE_AS_TEMP, ASTNode::TempType(t), ci) => temp = Some(ASTCell::with_node(t.clone(), ci)),
                    (Key::SQL_CREATE_AS_ON_COMMIT, ASTNode::OnCommitOption(o), ci) => on_commit = Some(ASTCell::with_node(o.clone(), ci)),
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
            sx::NodeType::OBJECT_SQL_VIEW => {
                let mut name = ASTCell::with_value(NamePath::default());
                let mut select = None;
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut temp = None;
                read_attributes! {
                    (Key::SQL_VIEW_NAME, ASTNode::Array(n, ni), ci) => name = ASTCell::with_node(read_name(arena, n, *ni), ci),
                    (Key::SQL_VIEW_STATEMENT, ASTNode::SelectStatement(s), ci) => select = Some(ASTCell::with_node(*s, ci)),
                    (Key::SQL_VIEW_TEMP, ASTNode::TempType(t), ci) => temp = Some(ASTCell::with_node(t.clone(), ci)),
                    (Key::SQL_VIEW_COLUMNS, ASTNode::Array(cols, ni), ci) => columns = ASTCell::with_node(unpack_strings!(cols, ni, StringRef), ci)
                }
                ASTNode::CreateView(arena.alloc(CreateViewStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    temp,
                }))
            }
            sx::NodeType::OBJECT_SQL_CTE => {
                let mut name = ASTCell::with_value("");
                let mut columns: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut stmt = None;
                read_attributes! {
                    (Key::SQL_CTE_NAME, ASTNode::StringRef(s), ci) => name = ASTCell::with_node(s, ci),
                    (Key::SQL_CTE_COLUMNS, ASTNode::Array(nodes, ni), ci) => columns = ASTCell::with_node(unpack_strings!(nodes, ni, StringRef), ci),
                    (Key::SQL_CTE_STATEMENT, ASTNode::SelectStatement(s), ci) => stmt = Some(ASTCell::with_node(*s, ci))
                }
                ASTNode::CommonTableExpression(arena.alloc(CommonTableExpression {
                    name,
                    columns,
                    statement: stmt.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_WINDOW_BOUND => {
                let mut mode = ASTCell::with_value(sx::WindowBoundMode::UNBOUNDED);
                let mut direction = None;
                let mut value = ASTCell::with_value(Expression::Null);
                read_attributes! {
                    (Key::SQL_WINDOW_BOUND_MODE, ASTNode::WindowBoundMode(m), ci) => mode = ASTCell::with_node(*m, ci),
                    (Key::SQL_WINDOW_BOUND_DIRECTION, ASTNode::WindowBoundDirection(d), ci) => direction = Some(ASTCell::with_node(*d, ci)),
                    (Key::SQL_WINDOW_BOUND_VALUE, n, ci) => value = ASTCell::with_node(read_expr!(n), ci)
                }
                ASTNode::WindowFrameBound(arena.alloc(WindowFrameBound { mode, direction, value }))
            }
            sx::NodeType::OBJECT_SQL_WINDOW_FRAME => {
                let mut name = None;
                let mut partition_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut order_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut frame_mode = None;
                let mut frame_bounds: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_WINDOW_FRAME_NAME, ASTNode::StringRef(n), ci) => name = Some(ASTCell::with_node(n.clone(), ci)),
                    (Key::SQL_WINDOW_FRAME_PARTITION, ASTNode::Array(nodes, ni), ci) => partition_by = ASTCell::with_node(read_exprs(arena, nodes, *ni), ci),
                    (Key::SQL_WINDOW_FRAME_ORDER, ASTNode::Array(nodes, ni), ci) => order_by = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_WINDOW_FRAME_MODE, ASTNode::WindowRangeMode(m), ci) => frame_mode = Some(ASTCell::with_node(*m, ci)),
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
            sx::NodeType::OBJECT_SQL_WINDOW_DEF => {
                let mut name = None;
                let mut frame = None;
                read_attributes! {
                    (Key::SQL_WINDOW_DEF_NAME, ASTNode::StringRef(n), ci) => name = Some(ASTCell::with_node(n.clone(), ci)),
                    (Key::SQL_WINDOW_DEF_FRAME, ASTNode::WindowFrame(f), ci) => frame = Some(ASTCell::with_node(*f, ci))
                }
                ASTNode::WindowDefinition(arena.alloc(WindowDefinition {
                    name: name.unwrap(),
                    frame: frame.unwrap(),
                }))
            }
            sx::NodeType::OBJECT_SQL_TYPETEST_EXPRESSION => {
                let mut negate = ASTCell::with_value(false);
                let mut value = None;
                let mut of_types: ASTCell<&[_]> = ASTCell::with_value(&[]);
                read_attributes! {
                    (Key::SQL_TYPETEST_NEGATE, ASTNode::Boolean(neg), ci) => negate = ASTCell::with_node(*neg, ci),
                    (Key::SQL_TYPETEST_VALUE, n, ci) => value = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_TYPETEST_TYPES, ASTNode::Array(nodes, ni), ci) => of_types = ASTCell::with_node(unpack_nodes!(nodes, ni, SQLType), ci)
                }
                ASTNode::TypeTestExpression(arena.alloc(TypeTestExpression {
                    negate,
                    value: value.unwrap(),
                    of_types,
                }))
            }
            sx::NodeType::OBJECT_SQL_SELECT => {
                let mut with_ctes: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut with_recursive = ASTCell::with_value(false);

                let mut values: Option<ASTCell<&'a [ASTCell<&'a [ASTCell<Expression<'a>>]>]>> = None;
                let mut table = None;
                let mut combine_operation = None;
                let mut combine_modifier = ASTCell::with_value(sx::CombineModifier::NONE);
                let mut combine_input: ASTCell<&[_]> = ASTCell::with_value(&[]);

                let mut targets: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut all = ASTCell::with_value(false);
                let mut distinct = None;
                let mut into = None;
                let mut from: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut where_clause = None;
                let mut group_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut having = None;
                let mut windows: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut sample = None;

                let mut limit = None;
                let mut offset = None;
                let mut order_by: ASTCell<&[_]> = ASTCell::with_value(&[]);
                let mut row_locking: ASTCell<&[_]> = ASTCell::with_value(&[]);

                read_attributes! {
                    (Key::SQL_SELECT_WITH_CTES, ASTNode::Array(nodes, ni), ci) => with_ctes = ASTCell::with_node(unpack_nodes!(nodes, ni, CommonTableExpression), ci),
                    (Key::SQL_SELECT_WITH_RECURSIVE, ASTNode::Boolean(b), ci) => with_recursive = ASTCell::with_node(*b, ci),

                    (Key::SQL_SELECT_TABLE, ASTNode::TableRef(t), ci) => table = Some(ASTCell::with_node(t.clone(), ci)),
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
                        values = Some(ASTCell::with_node(slice, ci));
                    },
                    (Key::SQL_COMBINE_OPERATION, ASTNode::CombineOperation(op), ci) => combine_operation = Some(ASTCell::with_node(*op, ci)),
                    (Key::SQL_COMBINE_MODIFIER, ASTNode::CombineModifier(m), ci) => combine_modifier = ASTCell::with_node(*m, ci),
                    (Key::SQL_COMBINE_INPUT, ASTNode::Array(nodes, ni), ci) => combine_input = ASTCell::with_node(unpack_nodes!(nodes, ni, SelectStatement), ci),

                    (Key::SQL_SELECT_ALL, ASTNode::Boolean(b), ci) => all = ASTCell::with_node(*b, ci),
                    (Key::SQL_SELECT_DISTINCT, ASTNode::Array(n, ni), ci) => distinct = Some(ASTCell::with_node(read_exprs(arena, n, *ni), ci)),
                    (Key::SQL_SELECT_TARGETS, ASTNode::Array(nodes, ni), ci) => targets = ASTCell::with_node(unpack_nodes!(nodes, ni, ResultTarget), ci),
                    (Key::SQL_SELECT_INTO, ASTNode::Into(i), ci) => into = Some(ASTCell::with_node(*i, ci)),
                    (Key::SQL_SELECT_FROM, ASTNode::Array(nodes, ni), ci) => from = ASTCell::with_node(unpack_nodes!(nodes, ni, TableRef), ci),
                    (Key::SQL_SELECT_WHERE, n, ci) => where_clause = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_SELECT_GROUPS, ASTNode::Array(nodes, ni), ci) => group_by = ASTCell::with_node(unpack_nodes!(nodes, ni, GroupByItem), ci),
                    (Key::SQL_SELECT_HAVING, n, ci) => having = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_SELECT_SAMPLE, ASTNode::Sample(s), ci) => sample = Some(ASTCell::with_node(*s, ci)),
                    (Key::SQL_SELECT_WINDOWS, ASTNode::Array(nodes, ni), ci) => windows = ASTCell::with_node(unpack_nodes!(nodes, ni, WindowDefinition), ci),

                    (Key::SQL_SELECT_ORDER, ASTNode::Array(nodes, ni), ci) => order_by = ASTCell::with_node(unpack_nodes!(nodes, ni, OrderSpecification), ci),
                    (Key::SQL_SELECT_LIMIT_ALL, ASTNode::Boolean(v), ci) => if *v { limit = Some(ASTCell::with_node(Limit::ALL, ci)) },
                    (Key::SQL_SELECT_LIMIT, n, ci) => limit = Some(ASTCell::with_node(Limit::Expression(read_expr!(n)), ci)),
                    (Key::SQL_SELECT_OFFSET, n, ci) => offset = Some(ASTCell::with_node(read_expr!(n), ci)),
                    (Key::SQL_SELECT_ROW_LOCKING, ASTNode::Array(nodes, ni), ci) => row_locking = ASTCell::with_node(unpack_nodes!(nodes, ni, RowLocking), ci)
                }
                let data = if let Some(values) = values {
                    SelectData::Values(values)
                } else if let Some(table) = table {
                    SelectData::Table(table)
                } else if let Some(combine_op) = combine_operation {
                    SelectData::Combine(arena.alloc(CombineOperation {
                        operation: combine_op,
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
            sx::NodeType::OBJECT_DSON => {
                let fields = arena.alloc_slice_fill_default(children.len());
                for i in 0..children.len() {
                    let c = &children[i];
                    let k = sx::AttributeKey(buffer_nodes[children_begin + i].attribute_key());
                    let ks = if k.0 >= sx::AttributeKey::DSON_DYNAMIC_KEYS_.0 {
                        let ki = k.0 - sx::AttributeKey::DSON_DYNAMIC_KEYS_.0;
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
            t => return Err(RawError::from(format!("node translation not implemented for: {:?}", t)).boxed()),
        };

        // Remember translated node
        nodes.push(translated);
    }

    // Do a postorder dfs traversal
    let mut stmts: Vec<Statement<'a>> = Vec::new();
    for statement in buffer_stmts.iter() {
        let node = &nodes[statement.root_node() as usize];
        let stmt = match node {
            ASTNode::SelectStatement(s) => Statement::Select(s),
            ASTNode::InputStatement(s) => Statement::Input(s),
            ASTNode::FetchStatement(s) => Statement::Fetch(s),
            ASTNode::VizStatement(s) => Statement::Viz(s),
            ASTNode::LoadStatement(s) => Statement::Load(s),
            ASTNode::Create(s) => Statement::Create(s),
            ASTNode::CreateAs(s) => Statement::CreateAs(s),
            ASTNode::CreateView(s) => Statement::CreateView(s),
            ASTNode::SetStatement(s) => Statement::Set(s),
            _ => return Err(RawError::from(format!("not a valid statement node: {:?}", &node)).boxed()),
        };
        stmts.push(stmt);
    }
    Ok(Program {
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

fn read_name<'a>(alloc: &'a bumpalo::Bump, nodes: &[ASTNode<'a>], ni: usize) -> NamePath<'a> {
    let path = alloc.alloc_slice_fill_default(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        path[i] = match n {
            ASTNode::StringRef(s) => ASTCell::with_node(Indirection::Name(s), ni + i),
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
