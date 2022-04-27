use super::ast_node::*;
use super::ast_translation_helper::*;
use super::dashql_nodes::*;
use super::dson::*;
use super::program::*;
use super::sql_nodes::*;
use crate::error::RawError;
use dashql_proto::syntax as sx;
use dashql_proto::syntax::GroupByItemType;
use std::error::Error;
use sx::AttributeKey as Key;

macro_rules! unexpected_attr {
    ($key:expr, $child:expr) => {
        return Err(RawError::from(format!(
            "unexpected attribute: {} => {:?}",
            $key.variant_name().unwrap_or(&format!("{}", $key.0)),
            $child
        ))
        .boxed())
    };
}

macro_rules! unexpected_array_element {
    ($key:expr, $value:expr) => {
        return Err(RawError::from(format!(
            "unexpected node: {}[] => {:?}",
            $key.variant_name().unwrap_or_default(),
            $value
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
    ast_program: sx::Program<'ast>,
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
                &text[(t.location().offset() as usize)..((t.location().offset() + t.location().length()) as usize)],
            ),
            sx::NodeType::ARRAY => {
                let mapped: Vec<ASTNode<'text>> = children[ti].drain(..).map(|(_, n)| n).collect();
                ASTNode::Array(mapped)
            }

            sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE => map_enum!(VizComponentType, v),
            sx::NodeType::ENUM_DASHQL_INPUT_COMPONENT_TYPE => map_enum!(InputComponentType, v),
            sx::NodeType::ENUM_DASHQL_FETCH_METHOD_TYPE => map_enum!(FetchMethodType, v),
            sx::NodeType::ENUM_DASHQL_LOAD_METHOD_TYPE => map_enum!(LoadMethodType, v),
            sx::NodeType::ENUM_SQL_CHARACTER_TYPE => map_enum!(CharacterType, v),
            sx::NodeType::ENUM_SQL_COLUMN_CONSTRAINT => map_enum!(ColumnConstraint, v),
            sx::NodeType::ENUM_SQL_COMBINE_MODIFIER => map_enum!(CombineModifier, v),
            sx::NodeType::ENUM_SQL_COMBINE_OPERATION => map_enum!(CombineOperation, v),
            sx::NodeType::ENUM_SQL_CONSTRAINT_ATTRIBUTE => map_enum!(ConstraintAttribute, v),
            sx::NodeType::ENUM_SQL_CONST_TYPE => ASTNode::ConstType(sx::AConstType(v as u8)),
            sx::NodeType::ENUM_SQL_EXPRESSION_OPERATOR => map_enum!(ExpressionOperator, v),
            sx::NodeType::ENUM_SQL_EXTRACT_TARGET => map_enum!(ExtractTarget, v),
            sx::NodeType::ENUM_SQL_GROUP_BY_ITEM_TYPE => map_enum!(GroupByItemType, v),
            sx::NodeType::ENUM_SQL_INTERVAL_TYPE => map_enum!(IntervalType, v),
            sx::NodeType::ENUM_SQL_KNOWN_FUNCTION => map_enum!(KnownFunction, v),
            sx::NodeType::ENUM_SQL_NUMERIC_TYPE => map_enum!(NumericType, v),
            sx::NodeType::ENUM_SQL_ON_COMMIT_OPTION => map_enum!(OnCommitOption, v),
            sx::NodeType::ENUM_SQL_ORDER_DIRECTION => map_enum!(OrderDirection, v),
            sx::NodeType::ENUM_SQL_ORDER_NULL_RULE => map_enum!(OrderNullRule, v),
            sx::NodeType::ENUM_SQL_SUBQUERY_QUANTIFIER => map_enum!(SubqueryQuantifier, v),
            sx::NodeType::ENUM_SQL_TEMP_TYPE => map_enum!(TempType, v),
            sx::NodeType::ENUM_SQL_TRIM_TARGET => map_enum!(TrimDirection, v),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_DIRECTION => map_enum!(WindowBoundDirection, v),
            sx::NodeType::ENUM_SQL_WINDOW_BOUND_MODE => map_enum!(WindowBoundMode, v),
            sx::NodeType::ENUM_SQL_WINDOW_EXCLUSION_MODE => map_enum!(WindowExclusionMode, v),
            sx::NodeType::ENUM_SQL_WINDOW_RANGE_MODE => map_enum!(WindowRangeMode, v),
            sx::NodeType::ENUM_SQL_ROW_LOCKING_BLOCK_BEHAVIOR => {
                map_enum!(RowLockingBlockBehavior, v)
            }
            sx::NodeType::ENUM_SQL_ROW_LOCKING_STRENGTH => map_enum!(RowLockingStrength, v),
            sx::NodeType::ENUM_SQL_SAMPLE_UNIT_TYPE => map_enum!(SampleCountUnit, v),
            sx::NodeType::ENUM_SQL_JOIN_TYPE => ASTNode::JoinType(sx::JoinType(v as u8)),

            sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX => {
                let mut val = None;
                let mut lb = None;
                let mut ub = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = sx::AttributeKey(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_INDIRECTION_INDEX_VALUE, n) => val = Some(read_expr(n)?),
                        (Key::SQL_INDIRECTION_INDEX_LOWER_BOUND, n) => lb = Some(read_expr(n)?),
                        (Key::SQL_INDIRECTION_INDEX_UPPER_BOUND, n) => ub = Some(read_expr(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::Indirection(if let Some(val) = val {
                    Indirection::Index(IndirectionIndex { value: Box::new(val) })
                } else {
                    Indirection::Bounds(IndirectionBounds {
                        lower_bound: Box::new(lb.unwrap_or(Expression::Null)),
                        upper_bound: Box::new(ub.unwrap_or(Expression::Null)),
                    })
                })
            }

            sx::NodeType::OBJECT_SQL_GENERIC_TYPE => {
                let mut name = None;
                let mut modifiers = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = sx::AttributeKey(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_GENERIC_TYPE_NAME, ASTNode::StringRef(s)) => name = Some(s),
                        (Key::SQL_GENERIC_TYPE_MODIFIERS, ASTNode::Array(a)) => modifiers = read_exprs(a)?,
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_ORDER_VALUE, n) => value = Some(read_expr(n)?),
                        (Key::SQL_ORDER_DIRECTION, ASTNode::OrderDirection(d)) => direction = Some(d),
                        (Key::SQL_ORDER_NULLRULE, ASTNode::OrderNullRule(n)) => null_rule = Some(n),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::OrderSpecification(OrderSpecification {
                    value: Box::new(value.unwrap_or(Expression::Null)),
                    direction,
                    null_rule,
                })
            }
            sx::NodeType::OBJECT_SQL_INTERVAL_TYPE => {
                let mut ty = None;
                let mut precision = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_INTERVAL_TYPE, ASTNode::IntervalType(t)) => ty = Some(t),
                        (Key::SQL_INTERVAL_PRECISION, ASTNode::StringRef(s)) => precision = Some(s),
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_RESULT_TARGET_STAR, ASTNode::Boolean(true)) => star = true,
                        (Key::SQL_RESULT_TARGET_VALUE, n) => value = Some(read_expr(n)?),
                        (Key::SQL_RESULT_TARGET_NAME, ASTNode::StringRef(s)) => alias = Some(s),
                        (k, c) => unexpected_attr!(k, c),
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
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::Expression(Expression::Nary(NaryExpression {
                    operator,
                    args,
                    postfix,
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TABLEREF_NAME, ASTNode::Array(n)) => name = Some(read_name(n)?),
                        (Key::SQL_TABLEREF_INHERIT, ASTNode::Boolean(b)) => inherit = b,
                        (Key::SQL_TABLEREF_TABLE, ASTNode::SelectStatement(s)) => select = Some(Box::new(s)),
                        (Key::SQL_TABLEREF_TABLE, ASTNode::JoinedTable(t)) => joined = Some(t),
                        (Key::SQL_TABLEREF_TABLE, ASTNode::FunctionTable(t)) => func = Some(t),
                        (Key::SQL_TABLEREF_ALIAS, ASTNode::Alias(a)) => alias = Some(a),
                        (Key::SQL_TABLEREF_ALIAS, ASTNode::StringRef(s)) => {
                            alias = Some(Alias {
                                name: s,
                                ..Alias::default()
                            })
                        }
                        (Key::SQL_TABLEREF_LATERAL, ASTNode::Boolean(b)) => lateral = b,
                        (Key::SQL_TABLEREF_SAMPLE, ASTNode::TableSample(s)) => sample = Some(s),
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(s)) => function = Some(s),
                        (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(s)) => repeat = Some(s),
                        (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(s)) => seed = Some(s),
                        (Key::SQL_SAMPLE_COUNT_VALUE, ASTNode::StringRef(v)) => {
                            count = Some(v);
                        }
                        (Key::SQL_SAMPLE_COUNT_UNIT, ASTNode::SampleCountUnit(u)) => count_unit = Some(u),
                        (k, c) => unexpected_attr!(k, c),
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
                        (Key::SQL_CONST_CAST_FUNC_NAME, ASTNode::Array(n)) => func_name = Some(read_name(n)?),
                        (Key::SQL_CONST_CAST_FUNC_ARGS_LIST, ASTNode::Array(nodes)) => func_args = read_exprs(nodes)?,
                        (Key::SQL_CONST_CAST_FUNC_ARGS_ORDER, ASTNode::Array(nodes)) => {
                            func_arg_ordering = read_ordering(nodes)?;
                        }
                        (Key::SQL_CONST_CAST_INTERVAL, ASTNode::IntervalSpecification(i)) => interval = Some(i),
                        (Key::SQL_CONST_CAST_INTERVAL, ASTNode::StringRef(s)) => {
                            interval = Some(IntervalSpecification::Raw(s));
                        }
                        (k, c) => unexpected_attr!(k, c),
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
            sx::NodeType::OBJECT_SQL_ALIAS => {
                let mut name = "";
                let mut column_names = Vec::new();
                let mut column_definitions = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_ALIAS_NAME, ASTNode::StringRef(s)) => name = s,
                        (Key::SQL_ALIAS_COLUMN_NAMES, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::StringRef(s) => column_names.push(s),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (Key::SQL_ALIAS_COLUMN_DEFS, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::ColumnDefinition(d) => column_definitions.push(d),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a)) => name = read_name(a)?,
                        (Key::DASHQL_FETCH_METHOD, ASTNode::FetchMethodType(m)) => method = m,
                        (Key::DASHQL_FETCH_FROM_URI, n) => from_uri = Some(read_expr(n)?),
                        (Key::DASHQL_FETCH_EXTRA, n) => extra = Some(read_dson(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(a)) => name = read_name(a)?,
                        (Key::DASHQL_DATA_SOURCE, ASTNode::Array(a)) => source = read_name(a)?,
                        (Key::DASHQL_LOAD_METHOD, ASTNode::LoadMethodType(m)) => method = m,
                        (Key::DASHQL_LOAD_EXTRA, n) => extra = Some(read_dson(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                let mut input = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_JOIN_TYPE, ASTNode::JoinType(t)) => join = t,
                        (Key::SQL_JOIN_INPUT, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::TableRef(t) => input.push(t),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::JoinedTable(JoinedTable { join, input })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_DEF => {
                let mut elem_name = "";
                let mut elem_type = SQLType::default();
                let mut collate = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_COLUMN_DEF_NAME, ASTNode::StringRef(s)) => elem_name = s,
                        (Key::SQL_COLUMN_DEF_TYPE, ASTNode::SQLType(t)) => elem_type = t,
                        (Key::SQL_COLUMN_DEF_COLLATE, ASTNode::Array(nodes)) => {
                            let mut name = Vec::new();
                            for node in nodes {
                                match node {
                                    ASTNode::StringRef(s) => name.push(s),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                            collate = Some(name);
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::ColumnDefinition(ColumnDefinition {
                    name: elem_name,
                    sql_type: elem_type,
                    collate,
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_TABLE => {
                let mut function = None;
                let mut ordinality = false;
                let mut rows_from = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_FUNCTION_TABLE_FUNCTION, ASTNode::FunctionExpression(f)) => {
                            function = Some(Box::new(f))
                        }
                        (Key::SQL_FUNCTION_TABLE_WITH_ORDINALITY, ASTNode::Boolean(b)) => ordinality = b,
                        (Key::SQL_FUNCTION_TABLE_ROWS_FROM, ASTNode::Array(nodes)) => {
                            rows_from.reserve(nodes.len());
                            for node in nodes {
                                match node {
                                    ASTNode::RowsFromItem(item) => rows_from.push(item),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::FunctionTable(FunctionTable {
                    function,
                    rows_from,
                    with_ordinality: ordinality,
                })
            }
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                let mut name: Option<NamePath> = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_COLUMN_REF_PATH, ASTNode::Array(a)) => name = Some(read_name(a)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::Expression(Expression::ColumnRef(name.unwrap_or_default()))
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_ARG => {
                let mut name = None;
                let mut value = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s)) => name = Some(s),
                        (Key::SQL_FUNCTION_ARG_VALUE, n) => value = Some(read_expr(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::FunctionArgument(FunctionArgument {
                    name: name,
                    value: value.unwrap_or(Expression::Null),
                })
            }
            sx::NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let mut func_name = FunctionName::default();
                let mut func_args = Vec::new();
                let mut func_arg_ordering = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_FUNCTION_NAME, ASTNode::StringRef(s)) => func_name = FunctionName::Unknown(s),
                        (Key::SQL_FUNCTION_NAME, ASTNode::KnownFunction(f)) => func_name = FunctionName::Known(f),
                        (Key::SQL_FUNCTION_ORDER, ASTNode::Array(nodes)) => func_arg_ordering = read_ordering(nodes)?,
                        (Key::SQL_FUNCTION_ARGUMENTS, ASTNode::Array(nodes)) => {
                            func_args = Vec::new();
                            for node in nodes {
                                match node {
                                    ASTNode::FunctionArgument(t) => func_args.push(t),
                                    e => func_args.push(FunctionArgument {
                                        name: None,
                                        value: read_expr(e)?,
                                    }),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::FunctionExpression(FunctionExpression {
                    name: func_name,
                    arguments: func_args,
                    argument_ordering: func_arg_ordering,
                    ..Default::default()
                })
            }
            sx::NodeType::OBJECT_SQL_TYPECAST_EXPRESSION => {
                let mut value = None;
                let mut typename = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TYPECAST_VALUE, v) => value = Some(read_expr(v)?),
                        (Key::SQL_TYPECAST_TYPE, ASTNode::SQLType(t)) => typename = Some(t),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::TypecastExpression(TypecastExpression {
                    value: Box::new(value.unwrap()),
                    typename: Box::new(typename.unwrap()),
                })
            }
            sx::NodeType::OBJECT_SQL_TIMESTAMP_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s)) => precision = Some(s),
                        (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz)) => with_timezone = tz,
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::TimestampTypeInfo(TimestampType {
                    precision,
                    with_timezone,
                })
            }
            sx::NodeType::OBJECT_SQL_TIME_TYPE => {
                let mut precision = None;
                let mut with_timezone = false;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TIME_TYPE_PRECISION, ASTNode::StringRef(s)) => precision = Some(s),
                        (Key::SQL_TIME_TYPE_WITH_TIMEZONE, ASTNode::Boolean(tz)) => with_timezone = tz,
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::TimeTypeInfo(TimeType {
                    precision,
                    with_timezone,
                })
            }
            sx::NodeType::OBJECT_SQL_GROUP_BY_ITEM => {
                let mut item_type = GroupByItemType::EMPTY;
                let mut expr = None;
                let mut args = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_GROUP_BY_ITEM_TYPE, ASTNode::GroupByItemType(t)) => item_type = t,
                        (Key::SQL_GROUP_BY_ITEM_ARG, n) => expr = Some(read_expr(n)?),
                        (Key::SQL_GROUP_BY_ITEM_ARGS, ASTNode::Array(nodes)) => args = nodes,
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                let item = match item_type {
                    GroupByItemType::EMPTY => GroupByItem::Empty,
                    GroupByItemType::EXPRESSION => GroupByItem::Expression(Box::new(expr.unwrap())),
                    GroupByItemType::CUBE => GroupByItem::Cube(read_exprs(args)?),
                    GroupByItemType::ROLLUP => GroupByItem::Rollup(read_exprs(args)?),
                    GroupByItemType::GROUPING_SETS => {
                        let mut items = Vec::new();
                        for arg in args {
                            match arg {
                                ASTNode::GroupByItem(i) => items.push(i),
                                _ => unexpected_attr!(Key::SQL_GROUP_BY_ITEM_ARGS, arg),
                            }
                        }
                        GroupByItem::GroupingSets(items)
                    }
                    _ => return Err(RawError::from(format!("invalid group by item type: {:?}", item_type)).boxed()),
                };
                ASTNode::GroupByItem(item)
            }
            sx::NodeType::OBJECT_SQL_TYPENAME => {
                let mut base = None;
                let mut set_of = false;
                let mut array_bounds = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TYPENAME_TYPE, ASTNode::GenericTypeInfo(t)) => base = Some(SQLBaseType::Generic(t)),
                        (Key::SQL_TYPENAME_TYPE, ASTNode::NumericTypeInfo(t)) => base = Some(SQLBaseType::Numeric(t)),
                        (Key::SQL_TYPENAME_TYPE, ASTNode::NumericType(t)) => {
                            base = Some(SQLBaseType::Numeric(NumericType {
                                base: t,
                                modifiers: Vec::new(),
                            }))
                        }
                        (Key::SQL_TYPENAME_TYPE, ASTNode::BitTypeInfo(t)) => base = Some(SQLBaseType::Bit(t)),
                        (Key::SQL_TYPENAME_TYPE, ASTNode::CharacterTypeInfo(t)) => {
                            base = Some(SQLBaseType::Character(t))
                        }
                        (Key::SQL_TYPENAME_TYPE, ASTNode::TimestampTypeInfo(t)) => {
                            base = Some(SQLBaseType::Timestamp(t))
                        }
                        (Key::SQL_TYPENAME_TYPE, ASTNode::IntervalTypeInfo(t)) => base = Some(SQLBaseType::Interval(t)),
                        (Key::SQL_TYPENAME_SETOF, ASTNode::Boolean(b)) => set_of = b,
                        (Key::SQL_TYPENAME_ARRAY, ASTNode::Array(n)) => array_bounds = read_array_bounds(n)?,
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_VIZ_COMPONENT_TYPE, ASTNode::VizComponentType(t)) => component_type = Some(t),
                        (Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ASTNode::UInt32Bitmap(mods)) => {
                            type_modifiers = mods
                        }
                        (Key::DASHQL_VIZ_COMPONENT_EXTRA, n) => extra = Some(read_dson(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::VizComponent(VizComponent {
                    component_type,
                    type_modifiers,
                    extra,
                })
            }
            sx::NodeType::OBJECT_DASHQL_VIZ => {
                let mut target = TableRef::Select(SelectStatementRef::default());
                let mut components = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_VIZ_TARGET, ASTNode::TableRef(t)) => target = t,
                        (Key::DASHQL_VIZ_COMPONENTS, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::VizComponent(c) => components.push(c),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::VizStatement(VizStatement { target, components })
            }
            sx::NodeType::OBJECT_DASHQL_INPUT => {
                let mut name = NamePath::default();
                let mut value_type = SQLType::default();
                let mut component_type = Some(sx::InputComponentType::NONE);
                let mut extra = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_STATEMENT_NAME, ASTNode::Array(n)) => name = read_name(n)?,
                        (Key::DASHQL_INPUT_VALUE_TYPE, ASTNode::SQLType(t)) => value_type = t,
                        (Key::DASHQL_INPUT_COMPONENT_TYPE, ASTNode::InputComponentType(t)) => component_type = Some(t),
                        (Key::DASHQL_INPUT_EXTRA, n) => extra = Some(read_dson(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::InputStatement(InputStatement {
                    name,
                    value_type,
                    component_type,
                    extra,
                })
            }
            sx::NodeType::OBJECT_DASHQL_SET => {
                let mut value = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::DASHQL_SET_FIELDS, n) => value = Some(read_dson(n)?),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::SetStatement(SetStatement { fields: value.unwrap() })
            }
            sx::NodeType::OBJECT_SQL_CHARACTER_TYPE => {
                let mut base = sx::CharacterType::VARCHAR;
                let mut length = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_CHARACTER_TYPE, ASTNode::CharacterType(c)) => base = c,
                        (Key::SQL_CHARACTER_TYPE_LENGTH, ASTNode::StringRef(l)) => length = Some(l),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::CharacterTypeInfo(CharacterType { base, length })
            }
            sx::NodeType::OBJECT_SQL_INTO => {
                let mut temp_type = sx::TempType::DEFAULT;
                let mut temp_name = NamePath::default();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_TEMP_NAME, ASTNode::Array(nodes)) => temp_name = read_name(nodes)?,
                        (Key::SQL_TEMP_TYPE, ASTNode::TempType(t)) => temp_type = t,
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::Into(Into {
                    temp: temp_type,
                    name: temp_name,
                })
            }
            sx::NodeType::OBJECT_SQL_ROW_LOCKING => {
                let mut strength = sx::RowLockingStrength::READ_ONLY;
                let mut of = Vec::new();
                let mut block_behavior = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_ROW_LOCKING_STRENGTH, ASTNode::RowLockingStrength(s)) => strength = s,
                        (Key::SQL_ROW_LOCKING_BLOCK_BEHAVIOR, ASTNode::RowLockingBlockBehavior(b)) => {
                            block_behavior = Some(b);
                        }
                        (Key::SQL_ROW_LOCKING_OF, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::Array(path) => of.push(read_name(path)?),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
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
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_SAMPLE_FUNCTION, ASTNode::StringRef(f)) => function = f,
                        (Key::SQL_SAMPLE_REPEAT, ASTNode::StringRef(v)) => repeat = Some(v),
                        (Key::SQL_SAMPLE_SEED, ASTNode::StringRef(v)) => seed = Some(v),
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::Sample(Sample { function, repeat, seed })
            }
            sx::NodeType::OBJECT_SQL_CREATE_AS => {
                let mut name = NamePath::default();
                let mut select = None;
                let mut with_data = false;
                let mut if_not_exists = false;
                let mut columns = None;
                let mut temp = None;
                let mut on_commit = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_CREATE_AS_NAME, ASTNode::Array(n)) => name = read_name(n)?,
                        (Key::SQL_CREATE_AS_STATEMENT, ASTNode::SelectStatement(s)) => select = Some(s),
                        (Key::SQL_CREATE_AS_WITH_DATA, ASTNode::Boolean(b)) => with_data = b,
                        (Key::SQL_CREATE_AS_IF_NOT_EXISTS, ASTNode::Boolean(b)) => if_not_exists = b,
                        (Key::SQL_CREATE_AS_TEMP, ASTNode::TempType(t)) => temp = Some(t),
                        (Key::SQL_CREATE_AS_ON_COMMIT, ASTNode::OnCommitOption(o)) => on_commit = Some(o),
                        (Key::SQL_CREATE_AS_COLUMNS, ASTNode::Array(cols)) => {
                            let mut col_names = Vec::new();
                            for col in cols {
                                match col {
                                    ASTNode::StringRef(s) => col_names.push(s),
                                    _ => unexpected_array_element!(k, col),
                                }
                            }
                            columns = Some(col_names);
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
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
                let mut columns = None;
                let mut temp = None;
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_VIEW_NAME, ASTNode::Array(n)) => name = read_name(n)?,
                        (Key::SQL_VIEW_STATEMENT, ASTNode::SelectStatement(s)) => select = Some(s),
                        (Key::SQL_VIEW_TEMP, ASTNode::TempType(t)) => temp = Some(t),
                        (Key::SQL_VIEW_COLUMNS, ASTNode::Array(cols)) => {
                            let mut col_names = Vec::new();
                            for col in cols {
                                match col {
                                    ASTNode::StringRef(s) => col_names.push(s),
                                    _ => unexpected_array_element!(k, col),
                                }
                            }
                            columns = Some(col_names);
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::CreateView(CreateViewStatement {
                    name,
                    columns,
                    statement: select.unwrap(),
                    temp,
                })
            }
            sx::NodeType::OBJECT_SQL_SELECT => {
                let mut targets = Vec::new();
                let mut from = Vec::new();
                let mut where_clause = None;
                let mut into = None;
                let mut limit = None;
                let mut offset = None;
                let mut sample = None;
                let mut having = None;
                let mut row_locking = Vec::new();
                let mut group_by = Vec::new();
                let mut order_by = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = Key(ast[ci].attribute_key());
                    match (k, c) {
                        (Key::SQL_SELECT_WHERE, n) => where_clause = Some(Box::new(read_expr(n)?)),
                        (Key::SQL_SELECT_INTO, ASTNode::Into(i)) => into = Some(i),
                        (Key::SQL_SELECT_LIMIT_ALL, ASTNode::Boolean(true)) => limit = Some(Limit::ALL),
                        (Key::SQL_SELECT_LIMIT, n) => limit = Some(Limit::Expression(Box::new(read_expr(n)?))),
                        (Key::SQL_SELECT_OFFSET, n) => offset = Some(Box::new(read_expr(n)?)),
                        (Key::SQL_SELECT_ORDER, ASTNode::Array(nodes)) => order_by = read_ordering(nodes)?,
                        (Key::SQL_SELECT_HAVING, n) => having = Some(Box::new(read_expr(n)?)),
                        (Key::SQL_SELECT_SAMPLE, ASTNode::Sample(s)) => sample = Some(s),
                        (Key::SQL_SELECT_ROW_LOCKING, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::RowLocking(l) => row_locking.push(l),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (Key::SQL_SELECT_TARGETS, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::ResultTarget(t) => targets.push(t),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (Key::SQL_SELECT_FROM, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::TableRef(t) => from.push(t),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (Key::SQL_SELECT_GROUPS, ASTNode::Array(nodes)) => {
                            for node in nodes {
                                match node {
                                    ASTNode::GroupByItem(i) => group_by.push(i),
                                    _ => unexpected_array_element!(k, node),
                                }
                            }
                        }
                        (k, c) => unexpected_attr!(k, c),
                    }
                }
                ASTNode::SelectStatement(SelectStatement {
                    all: false,
                    targets: targets,
                    into,
                    from,
                    where_clause,
                    group_by,
                    order_by,
                    having,
                    windows: false,
                    sample,
                    row_locking,
                    limit,
                    offset,
                })
            }
            sx::NodeType::OBJECT_DSON => {
                let mut fields = Vec::new();
                for (ci, c) in children[ti].drain(..) {
                    let k = ast[ci].attribute_key();
                    let ks = if k >= sx::AttributeKey::DSON_DYNAMIC_KEYS_.0 {
                        let ki = k - sx::AttributeKey::DSON_DYNAMIC_KEYS_.0;
                        let dson_keys = ast_program.dson_keys().unwrap_or_default();
                        let dson_key = dson_keys[ki as usize];
                        &text[(dson_key.offset() as usize)..((dson_key.offset() + dson_key.length()) as usize)]
                    } else {
                        Key(k).variant_name().unwrap_or_default()
                    };
                    let value = read_dson(c)?;
                    fields.push(DsonField { key: ks, value });
                }
                ASTNode::Dson(DsonValue::Object(fields))
            }
            t => return Err(RawError::from(format!("node translation not implemented for: {:?}", t)).boxed()),
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
        Some(ASTNode::InputStatement(s)) => Ok(Statement::Input(s)),
        Some(ASTNode::FetchStatement(s)) => Ok(Statement::Fetch(s)),
        Some(ASTNode::VizStatement(s)) => Ok(Statement::Viz(s)),
        Some(ASTNode::LoadStatement(s)) => Ok(Statement::Load(s)),
        Some(ASTNode::CreateAs(s)) => Ok(Statement::CreateAs(s)),
        Some(ASTNode::CreateView(s)) => Ok(Statement::CreateView(s)),
        Some(ASTNode::SetStatement(s)) => Ok(Statement::Set(s)),
        _ => return Err(RawError::from(format!("not a valid statement node: {:?}", &last)).boxed()),
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
        let stmt = translate_statement(&text, &ast, statement, ast_program, &mut children)?;
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

    fn test_translation(text: &str, expected: Program<'static>) -> Result<(), Box<dyn Error + Send + Sync>> {
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
