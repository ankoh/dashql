use super::ast::*;
use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
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

pub fn deserialize_ast<'text, 'ast, 'arena>(
    arena: &'arena bumpalo::Bump,
    text: &'text str,
    buffer: sx::Program<'ast>,
) -> Result<Program<'text, 'arena>, Box<dyn Error + Send + Sync>> {
    let buffer_stmts = buffer.statements().unwrap_or_default();
    let buffer_nodes = buffer.nodes().unwrap_or_default();

    // Translate all nodes from left-to-right
    let mut nodes: Vec<&'arena ASTNode<'text, 'arena>> = Vec::new();
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
                    match (k, &children[i]) {
                        $($matcher => $result),*,
                        (k, c) => err_unexpected_attr!(node_type, k, c),
                    }
                }
            }
        }

        // Helper to unpack nodes
        macro_rules! unpack_nodes_inner {
            ($nodes:expr, $ast_node:ident, $out:expr) => {{
                let mut writer = 0;
                for i in 0..$nodes.len() {
                    match &$nodes[i] {
                        ASTNode::$ast_node(inner) => {
                            unsafe {
                                std::ptr::write($out.as_ptr().add(writer), inner);
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
            ($nodes:expr, $ast_node:ident) => {
                unpack_nodes!($nodes, $ast_node, $ast_node)
            };
            ($nodes:expr, $ast_node:ident, $inner:ident) => {{
                let layout = std::alloc::Layout::array::<&'arena $inner>($nodes.len()).unwrap_or_else(|_| oom());
                let out = arena.alloc_layout(layout).cast::<&'arena $inner>();
                unpack_nodes_inner!($nodes, $ast_node, out)
            }};
        }
        macro_rules! unpack_strings {
            ($nodes:expr, $ast_node:ident) => {{
                let layout = std::alloc::Layout::array::<&'text str>($nodes.len()).unwrap_or_else(|_| oom());
                let out = arena.alloc_layout(layout).cast::<&'text str>();
                unpack_nodes_inner!($nodes, $ast_node, out)
            }};
        }

        // Translate the node
        let translated = match node_type {
            sx::NodeType::NONE => ASTNode::Null,
            sx::NodeType::BOOL => ASTNode::Boolean(node.children_begin_or_value() != 0),
            sx::NodeType::UI32 => ASTNode::UInt32(node.children_begin_or_value()),
            sx::NodeType::UI32_BITMAP => ASTNode::UInt32Bitmap(node.children_begin_or_value()),
            sx::NodeType::STRING_REF => ASTNode::StringRef(
                &text[(node.location().offset() as usize)
                    ..((node.location().offset() + node.location().length()) as usize)],
            ),
            sx::NodeType::ARRAY => ASTNode::Array(arena.alloc_slice_copy(children)),

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

            sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX => {
                let mut val = None;
                let mut lb = None;
                let mut ub = None;
                read_attributes! {
                    (Key::SQL_INDIRECTION_INDEX_VALUE, n) => val = Some(read_expr(n)),
                    (Key::SQL_INDIRECTION_INDEX_LOWER_BOUND, n) => lb = Some(read_expr(n)),
                    (Key::SQL_INDIRECTION_INDEX_UPPER_BOUND, n) => ub = Some(read_expr(n))
                }
                ASTNode::Indirection(if let Some(val) = val {
                    Indirection::Index(IndirectionIndex { value: val })
                } else {
                    Indirection::Bounds(IndirectionBounds {
                        lower_bound: lb.unwrap_or(Expression::Null),
                        upper_bound: ub.unwrap_or(Expression::Null),
                    })
                })
            }

            sx::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                let mut name: Option<&'text str> = None;
                let mut modifiers: &[Expression<'text, 'arena>] = &[];
                read_attributes! {
                    (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s)) => name = Some(s.clone()),
                    (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a)) => modifiers = read_exprs(arena, a)
                }
                ASTNode::GenericTypeInfo(GenericType {
                    name: name.unwrap_or_default(),
                    modifiers,
                })
            }
            sx::NodeType::OBJECT_SQL_ORDER => {
                let mut value = None;
                let mut direction = None;
                let mut null_rule = None;
                read_attributes! {
                    (Key::SQL_ORDER_VALUE, n) => value = Some(read_expr(n)),
                    (Key::SQL_ORDER_DIRECTION, ASTNode::OrderDirection(d)) => direction = Some(d.clone()),
                    (Key::SQL_ORDER_NULLRULE, ASTNode::OrderNullRule(n)) => null_rule = Some(n.clone())
                }
                ASTNode::OrderSpecification(OrderSpecification {
                    value: value.unwrap_or(Expression::Null),
                    direction,
                    null_rule,
                })
            }
            sx::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                let mut ty = None;
                let mut precision = None;
                read_attributes! {
                    (Key::SQL_INTERVAL_TYPE, ASTNode::IntervalType(t)) => ty = Some(t.clone()),
                    (Key::SQL_INTERVAL_PRECISION, ASTNode::StringRef(s)) => precision = Some(s.clone())
                }
                ASTNode::IntervalSpecification(IntervalSpecification::Type {
                    interval_type: ty.unwrap_or_default(),
                    precision: precision,
                })
            }
            sx::NodeType::OBJECT_SQL_RESULT_TARGET => {
                let mut value = None;
                let mut alias = None;
                let mut star = false;
                read_attributes! {
                    (Key::SQL_RESULT_TARGET_STAR, ASTNode::Boolean(true)) => star = true,
                    (Key::SQL_RESULT_TARGET_VALUE, n) => value = Some(read_expr(n)),
                    (Key::SQL_RESULT_TARGET_NAME, ASTNode::StringRef(s)) => alias = Some(s.clone())
                }
                ASTNode::ResultTarget(if star {
                    ResultTarget::Star
                } else {
                    ResultTarget::Value {
                        value: value.unwrap_or(Expression::Null),
                        alias,
                    }
                })
            }
            sx::NodeType::OBJECT_SQL_NARY_EXPRESSION => {
                let args = arena.alloc_slice_fill_default(3);
                let mut operator_name = ExpressionOperatorName::Known(sx::ExpressionOperator::PLUS);
                let mut postfix = false;
                read_attributes! {
                    (Key::SQL_EXPRESSION_ARG0, n) => args[0] = read_expr(n),
                    (Key::SQL_EXPRESSION_ARG1, n) => args[1] = read_expr(n),
                    (Key::SQL_EXPRESSION_ARG2, n) => args[2] = read_expr(n),
                    (Key::SQL_EXPRESSION_POSTFIX, ASTNode::Boolean(p)) => postfix = p.clone(),
                    (Key::SQL_EXPRESSION_OPERATOR, n) => operator_name = read_expression_operator(arena, n)
                }
                ASTNode::Expression(Expression::Nary(arena.alloc(NaryExpression {
                    operator: operator_name,
                    args,
                    postfix,
                })))
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
                    (Key::SQL_TABLEREF_NAME, ASTNode::Array(n)) => name = Some(read_name(arena, n)),
                    (Key::SQL_TABLEREF_INHERIT, ASTNode::Boolean(b)) => inherit = *b,
                    (Key::SQL_TABLEREF_TABLE, ASTNode::SelectStatement(s)) => select = Some(s),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::JoinedTable(t)) => joined = Some(t),
                    (Key::SQL_TABLEREF_TABLE, ASTNode::FunctionTable(t)) => func = Some(t),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::Alias(a)) => alias = Some(a),
                    (Key::SQL_TABLEREF_ALIAS, ASTNode::StringRef(s)) => {
                        alias = Some(arena.alloc(Alias {
                            name: s,
                            column_names: &[],
                            column_definitions: &[],
                        }))
                    },
                    (Key::SQL_TABLEREF_LATERAL, ASTNode::Boolean(b)) => lateral = *b,
                    (Key::SQL_TABLEREF_SAMPLE, ASTNode::TableSample(s)) => sample = Some(s)
                }
                ASTNode::TableRef(if let Some(table) = select {
                    TableRef::Select(SelectStatementRef {
                        table,
                        alias,
                        sample,
                        lateral,
                    })
                } else if let Some(table) = joined {
                    TableRef::Join(JoinedTableRef { table, alias })
                } else if let Some(table) = func {
                    TableRef::Function(FunctionTableRef {
                        table,
                        alias,
                        sample,
                        lateral,
                    })
                } else if let Some(name) = name {
                    TableRef::Relation(RelationRef { name, inherit })
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
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(s)) => function = Some(s.clone()),
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(s)) => repeat = Some(s.clone()),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(s)) => seed = Some(s.clone()),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(v)) => count = Some(v.clone()),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u)) => count_unit = Some(u.clone())
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
                let mut func_args: &[_] = &[];
                let mut func_arg_ordering: &[_] = &[];
                let mut interval = None;
                let mut value = None;
                read_attributes! {
                    (Key::SQL_CONST_CAST_TYPE, ASTNode::StringRef(t)) => cast_type = Some(t.clone()),
                    (Key::SQL_CONST_CAST_VALUE, ASTNode::StringRef(t)) => value = Some(t.clone()),
                    (Key::SQL_CONST_CAST_FUNC_NAME, ASTNode::Array(n)) => func_name = Some(read_name(arena, n)),
                    (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, ASTNode::Array(nodes)) => func_args = read_exprs(arena, nodes),
                    (Key::SQL_CONST_CAST_FUNC_ARGS_ORDER, ASTNode::Array(nodes)) => func_arg_ordering = unpack_nodes!(nodes, OrderSpecification),
                    (Key::SQL_CONST_CAST_INTERVAL, ASTNode::IntervalSpecification(i)) => interval = Some(i),
                    (Key::SQL_CONST_CAST_INTERVAL, ASTNode::StringRef(s)) => interval = Some(arena.alloc(IntervalSpecification::Raw(s)))
                }
                ASTNode::Expression(Expression::ConstCast(arena.alloc(ConstCastExpression {
                    cast_type: cast_type.unwrap_or_default(),
                    func_name,
                    func_args,
                    func_arg_ordering,
                    value: value.unwrap_or_default(),
                    interval,
                })))
            }
            sx::NodeType::OBJECT_SQL_ALIAS => {
                let mut name = "";
                let mut column_names: &[_] = &[];
                let mut column_definitions: &[_] = &[];
                read_attributes! {
                    (Key::SQL_ALIAS_NAME, ASTNode::StringRef(s)) => name = s,
                    (Key::SQL_ALIAS_COLUMN_NAMES, ASTNode::Array(nodes)) => column_names = unpack_strings!(nodes, StringRef),
                    (Key::SQL_ALIAS_COLUMN_DEFS, ASTNode::Array(nodes)) => column_definitions = unpack_nodes!(nodes, ColumnDefinition)
                }
                ASTNode::Alias(Alias {
                    name,
                    column_names,
                    column_definitions,
                })
            }
            sx::NodeType::OBJECT_DASHQL_FETCH => {
                let mut name = NamePath::default();
                let mut method = sx::FetchMethodType::NONE;
                let mut from_uri = None;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a)) => name = read_name(arena, a),
                    (Key::DASHQL_FETCH_METHOD, ASTNode::FetchMethodType(m)) => method = m.clone(),
                    (Key::DASHQL_FETCH_FROM_URI, n) => from_uri = Some(read_expr(n)),
                    (Key::DASHQL_FETCH_EXTRA, n) => extra = Some(read_dson(arena, n))
                }
                ASTNode::FetchStatement(FetchStatement {
                    name,
                    method,
                    from_uri,
                    extra,
                })
            }
            sx::NodeType::OBJECT_DASHQL_LOAD => {
                let mut name = NamePath::default();
                let mut source = NamePath::default();
                let mut method = sx::LoadMethodType::NONE;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a)) => name = read_name(arena, a),
                    (Key::DASHQL_DATA_SOURCE, ASTNode::Array(a)) => source = read_name(arena, a),
                    (Key::DASHQL_LOAD_METHOD, ASTNode::LoadMethodType(m)) => method = m.clone(),
                    (Key::DASHQL_LOAD_EXTRA, n) => extra = Some(read_dson(arena, n))
                }
                ASTNode::LoadStatement(LoadStatement {
                    name,
                    source,
                    method,
                    extra,
                })
            }
            sx::NodeType::OBJECT_SQL_JOINED_TABLE => {
                let mut join = sx::JoinType::NONE;
                let mut qualifier = None;
                let mut input: &[_] = &[];
                read_attributes! {
                    (Key::SQL_JOIN_TYPE, ASTNode::JoinType(t)) => join = t.clone(),
                    (Key::SQL_JOIN_ON, n) => qualifier = Some(JoinQualifier::On(read_expr(n))),
                    (Key::SQL_JOIN_USING, ASTNode::Array(nodes)) => {
                        let using = unpack_strings!(nodes, StringRef);
                        qualifier = Some(JoinQualifier::Using(using));
                    },
                    (Key::SQL_JOIN_INPUT, ASTNode::Array(nodes)) => input = unpack_nodes!(nodes, TableRef)
                }
                ASTNode::JoinedTable(JoinedTable { join, qualifier, input })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_DEF => {
                let mut elem_name = "";
                let mut elem_type = None;
                let mut collate: &[_] = &[];
                let mut options: &[_] = &[];
                read_attributes! {
                    (Key::SQL_COLUMN_DEF_NAME, ASTNode::StringRef(s)) => elem_name = s,
                    (Key::SQL_COLUMN_DEF_TYPE, ASTNode::SQLType(t)) => elem_type = Some(t),
                    (Key::SQL_COLUMN_DEF_OPTIONS, ASTNode::Array(nodes)) => options = unpack_nodes!(nodes, GenericOption),
                    (Key::SQL_COLUMN_DEF_COLLATE, ASTNode::Array(nodes)) => collate = unpack_strings!(nodes, StringRef)
                }
                ASTNode::ColumnDefinition(ColumnDefinition {
                    name: elem_name,
                    sql_type: elem_type.unwrap(),
                    collate,
                })
            }
            sx::NodeType::OBJECT_SQL_ROWSFROM_ITEM => {
                let mut function = None;
                let mut columns: &[_] = &[];
                read_attributes! {
                    (Key::SQL_ROWSFROM_ITEM_FUNCTION, ASTNode::FunctionExpression(f)) => function = Some(f),
                    (Key::SQL_ROWSFROM_ITEM_COLUMNS, ASTNode::Array(nodes)) => columns = unpack_nodes!(nodes, ColumnDefinition)
                }
                ASTNode::RowsFromItem(RowsFromItem {
                    function: function.unwrap(),
                    columns,
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TABLE => {
                let mut function = None;
                let mut ordinality = false;
                let mut rows_from: &[_] = &[];
                read_attributes! {
                    (Key::SQL_FUNCTION_TABLE_FUNCTION, ASTNode::FunctionExpression(f)) => function = Some(f),
                    (Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY, ASTNode::Boolean(b)) => ordinality = *b,
                    (Key::SQL_FUNCTION_TABLE_ROWS_FROM, ASTNode::Array(nodes)) => rows_from = unpack_nodes!(nodes, RowsFromItem)
                }
                ASTNode::FunctionTable(FunctionTable {
                    function,
                    rows_from,
                    with_ordinality: ordinality,
                })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                let mut name: Option<NamePath> = None;
                read_attributes! {
                    (Key::SQL_COLUMN_REF_PATH, ASTNode::Array(a)) => name = Some(read_name(arena, a))
                }
                ASTNode::Expression(Expression::ColumnRef(name.unwrap_or_default()))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_ARG => {
                let mut name = None;
                let mut value = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s)) => name = Some(s.clone()),
                    (Key::SQL_FUNCTION_ARG_VALUE, n) => value = Some(read_expr(n))
                }
                ASTNode::FunctionArgument(FunctionArgument {
                    name: name,
                    value: value.unwrap_or(Expression::Null),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TRIM_ARGS => {
                let mut direction = sx::TrimDirection::LEADING;
                let mut characters = None;
                let mut input: &[_] = &[];
                read_attributes! {
                    (Key::SQL_FUNCTION_TRIM_CHARACTERS, n) => characters = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_TRIM_INPUT, ASTNode::Array(nodes)) => input = read_exprs(arena, nodes),
                    (Key::SQL_FUNCTION_TRIM_DIRECTION, ASTNode::TrimDirection(d)) => direction = *d
                }
                ASTNode::TrimFunctionArguments(TrimFunctionArguments {
                    direction,
                    characters,
                    input,
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_SUBSTRING_ARGS => {
                let mut input = None;
                let mut substr_from = None;
                let mut substr_for = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_SUBSTRING_INPUT, n) => input = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_SUBSTRING_FROM, n) => substr_from = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_SUBSTRING_FOR, n) => substr_for = Some(read_expr(n))
                }
                ASTNode::SubstringFunctionArguments(SubstringFunctionArguments {
                    input: input.unwrap(),
                    substr_for,
                    substr_from,
                })
            }
            sx::NodeType::OBJECT_SQL_GENERIC_OPTION => {
                let mut key = "";
                let mut value = "";
                read_attributes! {
                    (Key::SQL_GENERIC_OPTION_KEY, ASTNode::StringRef(k)) => key = k,
                    (Key::SQL_GENERIC_OPTION_VALUE, ASTNode::StringRef(v)) => value = v
                }
                ASTNode::GenericOption(GenericOption { key, value })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_OVERLAY_ARGS => {
                let mut input = None;
                let mut placing = None;
                let mut substr_from = None;
                let mut substr_for = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_OVERLAY_INPUT, n) => input = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_OVERLAY_PLACING, n) => placing = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_OVERLAY_FROM, n) => substr_from = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_OVERLAY_FOR, n) => substr_for = Some(read_expr(n))
                }
                ASTNode::OverlayFunctionArguments(OverlayFunctionArguments {
                    input: input.unwrap(),
                    placing: placing.unwrap(),
                    substr_from: substr_from.unwrap(),
                    substr_for,
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_POSITION_ARGS => {
                let mut input = None;
                let mut search = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_POSITION_SEARCH, n) => search = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_POSITION_INPUT, n) => input = Some(read_expr(n))
                }
                ASTNode::PositionFunctionArguments(PositionFunctionArguments {
                    input: input.unwrap(),
                    search: search.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_EXTRACT_ARGS => {
                let mut target = ExtractFunctionTarget::Known(sx::ExtractTarget::SECOND);
                let mut input = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::StringRef(s)) => target = ExtractFunctionTarget::Unknown(s),
                    (Key::SQL_FUNCTION_EXTRACT_TARGET, ASTNode::ExtractTarget(t)) => target = ExtractFunctionTarget::Known(*t),
                    (Key::SQL_FUNCTION_EXTRACT_INPUT, n) => input = Some(read_expr(n))
                }
                ASTNode::ExtractFunctionArguments(ExtractFunctionArguments {
                    target,
                    input: input.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_CAST_ARGS => {
                let mut value = None;
                let mut as_type = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_CAST_VALUE, n) => value = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_CAST_TYPE, ASTNode::SQLType(t)) => as_type = Some(t)
                }
                ASTNode::CastFunctionArguments(CastFunctionArguments {
                    value: value.unwrap(),
                    as_type: as_type.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TREAT_ARGS => {
                let mut value = None;
                let mut as_type = None;
                read_attributes! {
                    (Key::SQL_FUNCTION_TREAT_VALUE, n) => value = Some(read_expr(n)),
                    (Key::SQL_FUNCTION_TREAT_TYPE, ASTNode::SQLType(t)) => as_type = Some(t)
                }
                ASTNode::TreatFunctionArguments(TreatFunctionArguments {
                    value: value.unwrap(),
                    as_type: as_type.unwrap(),
                })
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
                read_attributes! {
                    (Key::SQL_FUNCTION_VARIADIC, ASTNode::FunctionArgument(arg)) => variadic = Some(arg),
                    (Key::SQL_FUNCTION_ALL, ASTNode::Boolean(b)) => all = *b,
                    (Key::SQL_FUNCTION_DISTINCT, ASTNode::Boolean(b)) => distinct = *b,
                    (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s)) => func_name = FunctionName::Unknown(s),
                    (Key::SQL_FUNCTION_NAME, ASTNode::KnownFunction(f)) => func_name = FunctionName::Known(f.clone()),
                    (Key::SQL_FUNCTION_ORDER, ASTNode::Array(nodes)) => arg_ordering = unpack_nodes!(nodes, OrderSpecification),
                    (Key::SQL_FUNCTION_WITHIN_GROUP, ASTNode::Array(nodes)) => within_group = unpack_nodes!(nodes, OrderSpecification),
                    (Key::SQL_FUNCTION_FILTER, n) => filter = read_expr(n),
                    (Key::SQL_FUNCTION_ARGUMENTS, ASTNode::Array(nodes)) => {
                        let args = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::FunctionArgument(t) => args[i] = t.clone(),
                                e => args[i] = FunctionArgument {
                                    name: None,
                                    value: read_expr(e),
                                },
                            }
                        }
                        func_args = args;
                    },
                    (Key::SQL_FUNCTION_TRIM_ARGS, ASTNode::TrimFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Trim(a)),
                    (Key::SQL_FUNCTION_OVERLAY_ARGS, ASTNode::OverlayFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Overlay(a)),
                    (Key::SQL_FUNCTION_POSITION_ARGS, ASTNode::PositionFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Position(a)),
                    (Key::SQL_FUNCTION_SUBSTRING_ARGS, ASTNode::SubstringFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Substring(a)),
                    (Key::SQL_FUNCTION_EXTRACT_ARGS, ASTNode::ExtractFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Extract(a)),
                    (Key::SQL_FUNCTION_CAST_ARGS, ASTNode::CastFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Cast(a)),
                    (Key::SQL_FUNCTION_TREAT_ARGS, ASTNode::TreatFunctionArguments(a)) => args_known = Some(KnownFunctionArguments::Treat(a))
                }
                ASTNode::FunctionExpression(FunctionExpression {
                    name: func_name,
                    args: func_args,
                    args_known,
                    arg_ordering,
                    within_group,
                    filter,
                    all,
                    distinct,
                    variadic,
                    over: false,
                })
            }
            sx::NodeType::OBJECT_SQL_TYPECAST_EXPRESSION => {
                let mut value = None;
                let mut typename = None;
                read_attributes! {
                    (Key::SQL_TYPECAST_VALUE, v) => value = Some(read_expr(v)),
                    (Key::SQL_TYPECAST_TYPE, ASTNode::SQLType(t)) => typename = Some(t.clone())
                }
                ASTNode::TypecastExpression(TypecastExpression {
                    value: value.unwrap(),
                    typename: typename.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_SUBQUERY_EXPRESSION => {
                let mut arg0 = Expression::Null;
                let mut arg1 = Expression::Null;
                let mut operator_name = ExpressionOperatorName::Known(sx::ExpressionOperator::PLUS);
                let mut quantifier = sx::SubqueryQuantifier::ALL;
                read_attributes! {
                    (Key::SQL_SUBQUERY_ARG0, v) => arg0 = read_expr(v),
                    (Key::SQL_SUBQUERY_ARG1, v) => arg1 = read_expr(v),
                    (Key::SQL_SUBQUERY_QUANTIFIER, ASTNode::SubqueryQuantifier(quant)) => quantifier = *quant,
                    (Key::SQL_SUBQUERY_OPERATOR, n) => operator_name = read_expression_operator(arena, n)
                }
                ASTNode::SubqueryExpression(SubqueryExpression {
                    operator: operator_name,
                    quantifier,
                    args: [arg0, arg1],
                })
            }
            sx::NodeType::OBJECT_SQL_SELECT_EXPRESSION => {
                let mut stmt = None;
                let mut indirection = None;
                read_attributes! {
                    (Key::SQL_SELECT_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s)) => stmt = Some(s),
                    (Key::SQL_SELECT_EXPRESSION_INDIRECTION, ASTNode::Array(a)) => indirection = Some(read_name(arena, a))
                }
                ASTNode::SelectStatementExpression(SelectStatementExpression {
                    statement: stmt.unwrap(),
                    indirection,
                })
            }
            sx::NodeType::OBJECT_SQL_EXISTS_EXPRESSION => {
                let mut stmt = None;
                read_attributes! {
                    (Key::SQL_EXISTS_EXPRESSION_STATEMENT, ASTNode::SelectStatement(s)) => stmt = Some(s)
                }
                ASTNode::ExistsExpression(ExistsExpression {
                    statement: stmt.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s)) => precision = Some(s.clone()),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz)) => with_timezone = *tz
                }
                ASTNode::TimestampTypeInfo(TimestampType {
                    precision,
                    with_timezone,
                })
            }
            sx::NodeType::OBJECT_SQL_TIME_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                read_attributes! {
                    (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s)) => precision = Some(s.clone()),
                    (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz)) => with_timezone = *tz
                }
                ASTNode::TimeTypeInfo(TimeType {
                    precision,
                    with_timezone,
                })
            }
            sx::NodeType::OBJECT_SQL_GROUP_BY_ITEM => {
                let mut item_type = GroupByItemType::EMPTY;
                let mut expr = None;
                let mut args: &[_] = &[];
                read_attributes! {
                    (Key::SQL_GROUP_BY_ITEM_TYPE, ASTNode::GroupByItemType(t)) => item_type = t.clone(),
                    (Key::SQL_GROUP_BY_ITEM_ARG, n) => expr = Some(read_expr(n)),
                    (Key::SQL_GROUP_BY_ITEM_ARGS, ASTNode::Array(nodes)) => args = nodes
                }
                let item = match item_type {
                    GroupByItemType::EMPTY => GroupByItem::Empty,
                    GroupByItemType::EXPRESSION => GroupByItem::Expression(expr.unwrap()),
                    GroupByItemType::CUBE => GroupByItem::Cube(read_exprs(arena, args)),
                    GroupByItemType::ROLLUP => GroupByItem::Rollup(read_exprs(arena, args)),
                    GroupByItemType::GROUPING_SETS => GroupByItem::GroupingSets(unpack_nodes!(args, GroupByItem)),
                    _ => return Err(RawError::from(format!("invalid group by item type: {:?}", item_type)).boxed()),
                };
                ASTNode::GroupByItem(item)
            }
            sx::NodeType::OBJECT_SQL_TYPENAME => {
                let mut base = None;
                let mut set_of = false;
                let mut array_bounds: &[_] = &[];
                read_attributes! {
                    (Key::SQL_TYPENAME_TYPE, ASTNode::GenericTypeInfo(t)) => base = Some(SQLBaseType::Generic(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericTypeInfo(t)) => base = Some(SQLBaseType::Numeric(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::NumericType(t)) => {
                        base = Some(SQLBaseType::Numeric(NumericType {
                            base: *t,
                            modifiers: &[],
                        }))
                    },
                    (Key::SQL_TYPENAME_TYPE, ASTNode::BitTypeInfo(t)) => base = Some(SQLBaseType::Bit(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::CharacterTypeInfo(t)) => base = Some(SQLBaseType::Character(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::TimestampTypeInfo(t)) => base = Some(SQLBaseType::Timestamp(t.clone())),
                    (Key::SQL_TYPENAME_TYPE, ASTNode::IntervalTypeInfo(t)) => base = Some(SQLBaseType::Interval(t.clone())),
                    (Key::SQL_TYPENAME_SETOF, ASTNode::Boolean(b)) => set_of = *b,
                    (Key::SQL_TYPENAME_ARRAY, ASTNode::Array(n)) => array_bounds = read_array_bounds(arena, n)
                }
                ASTNode::SQLType(SQLType {
                    base_type: base.unwrap_or(SQLBaseType::Invalid),
                    set_of,
                    array_bounds,
                })
            }
            sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT => {
                let mut component_type = None;
                let mut type_modifiers = 0_u32;
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_VIZ_COMPONENT_TYPE, ASTNode::VizComponentType(t)) => component_type = Some(t.clone()),
                    (Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ASTNode::UInt32Bitmap(mods)) => type_modifiers = *mods,
                    (Key::DASHQL_VIZ_COMPONENT_EXTRA, n) => extra = Some(read_dson(arena, n))
                }
                ASTNode::VizComponent(VizComponent {
                    component_type,
                    type_modifiers,
                    extra,
                })
            }
            sx::NodeType::OBJECT_DASHQL_VIZ => {
                let mut target = None;
                let mut components: &[_] = &[];
                read_attributes! {
                    (Key::DASHQL_VIZ_TARGET, ASTNode::TableRef(t)) => target = Some(t),
                    (Key::DASHQL_VIZ_COMPONENTS, ASTNode::Array(ref nodes)) => components = unpack_nodes!(nodes, VizComponent)
                }
                ASTNode::VizStatement(VizStatement {
                    target: target.unwrap(),
                    components,
                })
            }
            sx::NodeType::OBJECT_DASHQL_INPUT => {
                let mut name = NamePath::default();
                let mut value_type = None;
                let mut component_type = Some(sx::InputComponentType::NONE);
                let mut extra = None;
                read_attributes! {
                    (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(n)) => name = read_name(arena, n),
                    (Key::DASHQL_INPUT_VALUE_TYPE, ASTNode::SQLType(t)) => value_type = Some(t),
                    (Key::DASHQL_INPUT_COMPONENT_TYPE, ASTNode::InputComponentType(t)) => component_type = Some(t.clone()),
                    (Key::DASHQL_INPUT_EXTRA, n) => extra = Some(read_dson(arena, n))
                }
                ASTNode::InputStatement(InputStatement {
                    name,
                    value_type: value_type.unwrap(),
                    component_type,
                    extra,
                })
            }
            sx::NodeType::OBJECT_DASHQL_SET => {
                let mut value = None;
                read_attributes! {
                    (Key::DASHQL_SET_FIELDS, n) => value = Some(read_dson(arena, n))
                }
                ASTNode::SetStatement(SetStatement { fields: value.unwrap() })
            }
            sx::NodeType::OBJECT_SQL_CHARACTER_TYPE => {
                let mut base = sx::CharacterType::VARCHAR;
                let mut length = None;
                read_attributes! {
                    (Key::SQL_CHARACTER_TYPE, ASTNode::CharacterType(c)) => base = c.clone(),
                    (Key::SQL_CHARACTER_TYPE_LENGTH, ASTNode::StringRef(l)) => length = Some(l.clone())
                }
                ASTNode::CharacterTypeInfo(CharacterType { base, length })
            }
            sx::NodeType::OBJECT_SQL_INTO => {
                let mut temp_type = sx::TempType::DEFAULT;
                let mut temp_name = NamePath::default();
                read_attributes! {
                    (Key::SQL_TEMP_NAME, ASTNode::Array(nodes)) => temp_name = read_name(arena, nodes),
                    (Key::SQL_TEMP_TYPE, ASTNode::TempType(t)) => temp_type = t.clone()
                }
                ASTNode::Into(Into {
                    temp: temp_type,
                    name: temp_name,
                })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_CONSTRAINT => {
                let mut constraint_name = None;
                let mut constraint_type = None;
                let mut definition: &[_] = &[];
                let mut no_inherit = false;
                read_attributes! {
                    (Key::SQL_COLUMN_CONSTRAINT_TYPE, ASTNode::ColumnConstraint(c)) => constraint_type = Some(c.clone()),
                    (Key::SQL_COLUMN_CONSTRAINT_NAME, ASTNode::StringRef(n)) => constraint_name = Some(n.clone()),
                    (Key::SQL_COLUMN_CONSTRAINT_DEFINITION, ASTNode::Array(nodes)) => definition = unpack_nodes!(nodes, ColumnConstraintDefinition),
                    (Key::SQL_COLUMN_CONSTRAINT_NO_INHERIT, ASTNode::Boolean(b)) => no_inherit = *b
                }
                ASTNode::ColumnConstraintInfo(ColumnConstraint {
                    constraint_name,
                    constraint_type,
                    definition,
                    no_inherit,
                })
            }
            sx::NodeType::OBJECT_SQL_ROW_LOCKING => {
                let mut strength = sx::RowLockingStrength::READ_ONLY;
                let mut of: &[_] = &[];
                let mut block_behavior = None;
                read_attributes! {
                    (Key::SQL_ROW_LOCKING_STRENGTH, ASTNode::RowLockingStrength(s)) => strength = s.clone(),
                    (Key::SQL_ROW_LOCKING_BLOCK_BEHAVIOR, ASTNode::RowLockingBlockBehavior(b)) => {
                        block_behavior = Some(b.clone());
                    },
                    (Key::SQL_ROW_LOCKING_OF, ASTNode::Array(nodes)) => {
                        let names = arena.alloc_slice_fill_default(nodes.len());
                        for (i, node) in nodes.iter().enumerate() {
                            match node {
                                ASTNode::Array(path) => names[i] = read_name(arena, path),
                                _ => err_unexpected_element!(sx::NodeType::OBJECT_SQL_ROW_LOCKING, node),
                            }
                        }
                        of = names;
                    }
                }
                ASTNode::RowLocking(RowLocking {
                    strength,
                    of,
                    block_behavior,
                })
            }
            sx::NodeType::OBJECT_SQL_SELECT_SAMPLE => {
                let mut function = "";
                let mut repeat = None;
                let mut seed = None;
                let mut count_value = None;
                let mut count_unit = sx::SampleCountUnit::ROWS;
                read_attributes! {
                    (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(f)) => function = f,
                    (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(v)) => repeat = Some(v.clone()),
                    (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(v)) => seed = Some(v.clone()),
                    (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u)) => count_unit = u.clone(),
                    (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(s)) => count_value = Some(s)
                }
                ASTNode::Sample(Sample {
                    function,
                    repeat,
                    seed,
                    count: count_value.map(|v| SampleCount {
                        value: v,
                        unit: count_unit,
                    }),
                })
            }
            sx::NodeType::OBJECT_SQL_CREATE_AS => {
                let mut name = NamePath::default();
                let mut select = None;
                let mut with_data = false;
                let mut if_not_exists = false;
                let mut columns: &[_] = &[];
                let mut temp = None;
                let mut on_commit = None;
                read_attributes! {
                    (Key::SQL_CREATE_AS_NAME, ASTNode::Array(n)) => name = read_name(arena, n),
                    (Key::SQL_CREATE_AS_STATEMENT, ASTNode::SelectStatement(s)) => select = Some(s),
                    (Key::SQL_CREATE_AS_WITH_DATA, ASTNode::Boolean(b)) => with_data = *b,
                    (Key::SQL_CREATE_AS_IF_NOT_EXISTS, ASTNode::Boolean(b)) => if_not_exists = *b,
                    (Key::SQL_CREATE_AS_TEMP, ASTNode::TempType(t)) => temp = Some(t.clone()),
                    (Key::SQL_CREATE_AS_ON_COMMIT, ASTNode::OnCommitOption(o)) => on_commit = Some(o.clone()),
                    (Key::SQL_CREATE_AS_COLUMNS, ASTNode::Array(nodes)) => columns = unpack_strings!(nodes, StringRef)
                }
                ASTNode::CreateAs(CreateAsStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    if_not_exists,
                    on_commit,
                    temp,
                    with_data,
                })
            }
            sx::NodeType::OBJECT_SQL_VIEW => {
                let mut name = NamePath::default();
                let mut select = None;
                let mut columns: &[_] = &[];
                let mut temp = None;
                read_attributes! {
                    (Key::SQL_VIEW_NAME, ASTNode::Array(n)) => name = read_name(arena, n),
                    (Key::SQL_VIEW_STATEMENT, ASTNode::SelectStatement(s)) => select = Some(s),
                    (Key::SQL_VIEW_TEMP, ASTNode::TempType(t)) => temp = Some(t.clone()),
                    (Key::SQL_VIEW_COLUMNS, ASTNode::Array(cols)) => columns = unpack_strings!(cols, StringRef)
                }
                ASTNode::CreateView(CreateViewStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    temp,
                })
            }
            sx::NodeType::OBJECT_SQL_CTE => {
                let mut name = &"";
                let mut columns: &[_] = &[];
                let mut stmt = None;
                read_attributes! {
                    (Key::SQL_CTE_NAME, ASTNode::StringRef(s)) => name = s,
                    (Key::SQL_CTE_COLUMNS, ASTNode::Array(nodes)) => columns = unpack_strings!(nodes, StringRef),
                    (Key::SQL_CTE_STATEMENT, ASTNode::SelectStatement(s)) => stmt = Some(s)
                }
                ASTNode::CommonTableExpression(CommonTableExpression {
                    name,
                    columns,
                    statement: stmt.unwrap(),
                })
            }
            sx::NodeType::OBJECT_SQL_SELECT => {
                let mut with_ctes: &[_] = &[];
                let mut with_recursive = false;

                let mut values = None;
                let mut table = None;
                let mut combine_operation = None;
                let mut combine_modifier = sx::CombineModifier::NONE;
                let mut combine_input: &[_] = &[];

                let mut targets: &[_] = &[];
                let mut all = false;
                let mut distinct = false;
                let mut into = None;
                let mut from: &[_] = &[];
                let mut where_clause = None;
                let mut group_by: &[_] = &[];
                let mut having = None;
                let mut sample = None;

                let mut limit = None;
                let mut offset = None;
                let mut order_by: &[_] = &[];
                let mut row_locking: &[_] = &[];

                read_attributes! {
                    (Key::SQL_SELECT_WITH_CTES, ASTNode::Array(nodes)) => with_ctes = unpack_nodes!(nodes, CommonTableExpression),
                    (Key::SQL_SELECT_WITH_RECURSIVE, ASTNode::Boolean(b)) => with_recursive = *b,

                    (Key::SQL_SELECT_TABLE, ASTNode::TableRef(t)) => table = Some(t),
                    (Key::SQL_SELECT_VALUES, ASTNode::Array(tuples)) => {
                        type Tuple<'text, 'arena> = &'arena [Expression<'text, 'arena>];
                        let tuples_layout = std::alloc::Layout::array::<Tuple<'text, 'arena>>(tuples.len()).unwrap_or_else(|_| oom());
                        let tuples_mem = arena.alloc_layout(tuples_layout).cast::<Tuple<'text, 'arena>>();
                        let mut tuples_writer = 0;
                        for i in 0..tuples.len() {
                            match tuples[i] {
                                ASTNode::Array(tuple) => {
                                    let tuple_exprs = read_exprs(arena, tuple);
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
                        values = Some(unsafe { std::slice::from_raw_parts_mut(tuples_mem.as_ptr(), tuples_writer) })
                    },
                    (Key::SQL_COMBINE_OPERATION, ASTNode::CombineOperation(op)) => combine_operation = Some(*op),
                    (Key::SQL_COMBINE_MODIFIER, ASTNode::CombineModifier(m)) => combine_modifier = *m,
                    (Key::SQL_COMBINE_INPUT, ASTNode::Array(nodes)) => combine_input = unpack_nodes!(nodes, SelectStatement),

                    (Key::SQL_SELECT_ALL, ASTNode::Boolean(b)) => all = *b,
                    (Key::SQL_SELECT_DISTINCT, ASTNode::Boolean(b)) => distinct = *b,
                    (Key::SQL_SELECT_TARGETS, ASTNode::Array(nodes)) => targets = unpack_nodes!(nodes, ResultTarget),
                    (Key::SQL_SELECT_INTO, ASTNode::Into(i)) => into = Some(i),
                    (Key::SQL_SELECT_FROM, ASTNode::Array(nodes)) => from = unpack_nodes!(nodes, TableRef),
                    (Key::SQL_SELECT_WHERE, n) => where_clause = Some(read_expr(n)),
                    (Key::SQL_SELECT_GROUPS, ASTNode::Array(nodes)) => group_by = unpack_nodes!(nodes, GroupByItem),
                    (Key::SQL_SELECT_HAVING, n) => having = Some(read_expr(n)),
                    (Key::SQL_SELECT_SAMPLE, ASTNode::Sample(s)) => sample = Some(s),

                    (Key::SQL_SELECT_ORDER, ASTNode::Array(nodes)) => order_by = unpack_nodes!(nodes, OrderSpecification),
                    (Key::SQL_SELECT_LIMIT_ALL, ASTNode::Boolean(true)) => limit = Some(Limit::ALL),
                    (Key::SQL_SELECT_LIMIT, n) => limit = Some(Limit::Expression(read_expr(n))),
                    (Key::SQL_SELECT_OFFSET, n) => offset = Some(read_expr(n)),
                    (Key::SQL_SELECT_ROW_LOCKING, ASTNode::Array(nodes)) => row_locking = unpack_nodes!(nodes, RowLocking)
                }
                ASTNode::SelectStatement(SelectStatement {
                    with_ctes,
                    with_recursive,
                    data: if let Some(values) = values {
                        SelectData::Values(values)
                    } else if let Some(table) = table {
                        SelectData::Table(table)
                    } else if let Some(combine_op) = combine_operation {
                        SelectData::Combine(CombineOperation {
                            operation: combine_op,
                            modifier: combine_modifier,
                            input: combine_input,
                        })
                    } else {
                        SelectData::From(SelectFromStatement {
                            all,
                            distinct,
                            targets,
                            into,
                            from,
                            where_clause,
                            group_by,
                            having,
                            windows: false,
                            sample,
                        })
                    },
                    order_by,
                    limit,
                    offset,
                    row_locking,
                })
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
                        &text[(dson_key.offset() as usize)..((dson_key.offset() + dson_key.length()) as usize)]
                    } else {
                        k.variant_name().unwrap_or_default()
                    };
                    let value = read_dson(arena, c);
                    fields[i] = DsonField { key: ks, value };
                }
                ASTNode::Dson(DsonValue::Object(fields))
            }
            t => return Err(RawError::from(format!("node translation not implemented for: {:?}", t)).boxed()),
        };

        // Remember translated node
        nodes.push(arena.alloc(translated));
    }

    // Do a postorder dfs traversal
    let mut stmts: Vec<Statement<'text, 'arena>> = Vec::new();
    for statement in buffer_stmts.iter() {
        let node = &nodes[statement.root_node() as usize];
        let stmt = match node {
            ASTNode::SelectStatement(s) => Statement::Select(s),
            ASTNode::InputStatement(s) => Statement::Input(s),
            ASTNode::FetchStatement(s) => Statement::Fetch(s),
            ASTNode::VizStatement(s) => Statement::Viz(s),
            ASTNode::LoadStatement(s) => Statement::Load(s),
            ASTNode::CreateAs(s) => Statement::CreateAs(s),
            ASTNode::CreateView(s) => Statement::CreateView(s),
            ASTNode::SetStatement(s) => Statement::Set(s),
            _ => return Err(RawError::from(format!("not a valid statement node: {:?}", &node)).boxed()),
        };
        stmts.push(stmt);
    }
    Ok(Program { statements: stmts })
}

fn read_expr<'text, 'arena>(node: &'arena ASTNode<'text, 'arena>) -> Expression<'text, 'arena> {
    match node {
        ASTNode::Boolean(true) => Expression::True,
        ASTNode::Boolean(false) => Expression::False,
        ASTNode::Expression(ref e) => e.clone(),
        ASTNode::FunctionExpression(ref f) => Expression::FunctionCall(f),
        ASTNode::StringRef(ref s) => Expression::StringRef(s.clone()),
        ASTNode::ColumnRef(ref c) => Expression::ColumnRef(c.clone()),
        ASTNode::TypecastExpression(ref c) => Expression::Typecast(c),
        ASTNode::SubqueryExpression(ref e) => Expression::Subquery(e),
        ASTNode::SelectStatementExpression(ref s) => Expression::SelectStatement(s),
        ASTNode::ExistsExpression(ref e) => Expression::Exists(e),
        _ => {
            log::warn!("invalid expression node: {:?}", node);
            Expression::Null
        }
    }
}

fn read_exprs<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    nodes: &[&'arena ASTNode<'text, 'arena>],
) -> &'arena [Expression<'text, 'arena>] {
    let exprs = alloc.alloc_slice_fill_default(nodes.len());
    for i in 0..nodes.len() {
        exprs[i] = read_expr(&nodes[i]);
    }
    exprs
}

fn read_name<'text, 'arena>(
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

fn read_expression_operator<'text, 'arena>(
    alloc: &'arena bumpalo::Bump,
    node: &'arena ASTNode<'text, 'arena>,
) -> ExpressionOperatorName<'text, 'arena> {
    match &node {
        ASTNode::ExpressionOperator(op) => ExpressionOperatorName::Known(*op),
        ASTNode::Array(elems) => {
            let path = alloc.alloc_slice_fill_default(elems.len());
            for (i, n) in elems.iter().enumerate() {
                path[i] = match n {
                    ASTNode::StringRef(s) => s,
                    ASTNode::ExpressionOperator(op) => op.variant_name().unwrap_or_default(),
                    _ => {
                        log::warn!("invalid expression operator name: {:?}", n);
                        "?"
                    }
                }
            }
            ExpressionOperatorName::Qualified(path)
        }
        n => {
            log::warn!("invalid expression operator name: {:?}", n);
            ExpressionOperatorName::Known(ExpressionOperator::DEFAULT)
        }
    }
}

fn read_array_bounds<'text, 'arena>(
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

fn read_dson<'text, 'arena>(
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
