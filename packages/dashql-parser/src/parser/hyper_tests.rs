use super::{parse, ParsedScript};
use crate::scanner::scan;
use dashql_buffers::parser::{
    AttributeKey as K, DropObjectType, FetchDirection, GrantTargetType, JsonBehavior, MergeAction, MergeMatch,
    NodeType, SequenceOption, SessionParameter, StatementType,
};
use std::sync::Arc;

fn parse_sql(sql: &str) -> ParsedScript {
    parse(Arc::new(scan(sql, 0, 0)))
}

#[test]
fn accepts_hyper_grammar() {
    let mut failures = Vec::new();
    for &(name, sql) in super::hyper_cases::CASES {
        let parsed = parse_sql(sql);
        if !parsed.errors.is_empty() || !parsed.scanned.errors.is_empty() || parsed.statements.len() != 1 {
            failures.push(format!("{name}: {sql}\nscan={:?}\nparse={:?}", parsed.scanned.errors, parsed.errors));
        }
    }
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n\n"));
}

#[test]
fn accepts_hyper_bare_aliases() {
    let mut failures = Vec::new();
    for word in include_str!("hyper_aliases.txt").lines() {
        let sql = format!("SELECT 1 {word}");
        let parsed = parse_sql(&sql);
        if !parsed.errors.is_empty() {
            failures.push(format!("{word}: {:?}", parsed.errors));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn rejects_incomplete_and_malformed_hyper_sql() {
    for sql in [
        "UPDATE t SET",
        "UPDATE t SET x =",
        "MERGE INTO t USING u ON true WHEN MATCHED THEN",
        "COPY t TO",
        "COPY t TO NULL WITH (format =>)",
        "PREPARE p AS",
        "EXECUTE p(1,)",
        "SELECT * EXCLUDE () FROM t",
        "SELECT 1 GROUP BY ALL x junk",
        "SELECT 1 ORDER BY ALL junk",
        "SELECT 1 FETCH FIRST 1 ROW WITH",
        "SELECT JSON_OBJECT('a':)",
        "SELECT f(LAMBDA x:)",
        "SELECT CAST(1 AS ARRAY(integer NOT))",
        "SELECT ROW(1 AS)",
        "CREATE EXTERNAL TABLE t FOR",
        "CREATE FUNCTION f() RETURNS int AS",
        "GRANT SELECT ON t TO",
        "SELECT 1; UPDATE t SET x = ; SELECT 2",
        "SELECT 1 UPDATE t SET x=2",
        "SELECT 1; COPY t TO NULL junk; SELECT 2",
        "SELECT $tag$unterminated",
        "SELECT CAST(1 AS FLOAT(0))",
        "SELECT CAST(1 AS FLOAT(54))",
        "SELECT * FROM EXTERNAL STREAM events (WITH (CARDINALITY))",
    ] {
        let parsed = parse_sql(sql);
        assert!(!parsed.errors.is_empty() || !parsed.scanned.errors.is_empty(), "accepted invalid SQL: {sql}");
    }
}

#[test]
fn typed_statements_preserve_structure_and_source_spans() {
    let sql = "-- first\nSELECT 1;\n-- second\nUPDATE t SET x = 2 RETURNING x;\nSELECT 3;";
    let parsed = parse_sql(sql);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 3);
    assert_eq!(parsed.statements[0].statement_type, StatementType::SELECT);
    assert_eq!(parsed.statements[1].statement_type, StatementType::UPDATE);
    assert_eq!(parsed.statements[2].statement_type, StatementType::SELECT);
    let descriptions = parsed.associate_descriptions();
    assert_eq!(descriptions[1].description_count, 1);
    let statement = parsed.statements[1];
    let root = &parsed.nodes[statement.root as usize];
    assert_eq!(root.node_type(), NodeType::OBJECT_SQL_UPDATE);
    assert_eq!(parsed.node_text(root), "UPDATE t SET x = 2 RETURNING x");
    for statement in &parsed.statements {
        let end = statement.nodes_begin + statement.node_count;
        assert!(statement.root >= statement.nodes_begin && statement.root < end);
        for node in &parsed.nodes[statement.nodes_begin as usize..end as usize] {
            assert!(node.parent() >= statement.nodes_begin && node.parent() < end);
            assert!(node.symbol_span().offset() + node.symbol_span().length() <= parsed.scanned.symbols.len() as u32);
            if node.node_type() == NodeType::ARRAY || node.node_type().0 > NodeType::OBJECT_KEYS_.0 {
                assert!(
                    node.children_count() == 0
                        || (node.children_begin_or_value() >= statement.nodes_begin
                            && node.children_begin_or_value() + node.children_count() <= end)
                );
            }
        }
    }
}

#[test]
fn mixed_scripts_keep_errors_and_accept_following_new_syntax() {
    let parsed = parse_sql("UPDATE t SET x = ; SELECT 1; COPY t TO NULL; SELECT 2;");
    assert!(!parsed.errors.is_empty());
    assert!(parsed.statements.iter().any(|s| s.statement_type == StatementType::UPDATE));
    assert_eq!(
        parsed.statements.iter().filter(|s| s.statement_type == StatementType::SELECT).count(),
        2,
        "{:?} {:?}",
        parsed.statements,
        parsed.errors
    );
}

#[test]
fn extended_parsing_respects_the_nesting_limit() {
    let sql = format!("UPDATE t SET x = {}1{}; SELECT 2", "(".repeat(1500), ")".repeat(1500));
    let parsed = parse_sql(&sql);
    assert!(!parsed.errors.is_empty());
    assert_eq!(parsed.statements.last().unwrap().statement_type, StatementType::SELECT);
}

#[test]
fn quoted_semicolons_are_not_statement_boundaries() {
    let parsed = parse_sql("SELECT $tag$a;b$$c$tag$; UPDATE t SET x = 'a;b'; SELECT 3;");
    assert!(parsed.scanned.errors.is_empty(), "{:?}", parsed.scanned.errors);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 3);
}

#[test]
fn allows_leading_and_empty_statement_separators() {
    let parsed = parse_sql(";; SELECT 1; ; COPY t TO NULL;; SELECT 2;;");
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 3);
}

#[test]
fn accepts_unicode_identifier_escapes_and_whitespace() {
    let parsed = parse_sql("SELECT\u{a0}1 AS U&\"d\\0061t\"; SELECT 2 AS U&\"d!0061t\" UESCAPE '!';");
    assert!(parsed.scanned.errors.is_empty(), "{:?}", parsed.scanned.errors);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert!(parsed.scanned.names.find("dat").is_some());
    assert_eq!(parsed.statements.len(), 2);
}

fn valid_sql(sql: &str) -> ParsedScript {
    let parsed = parse_sql(sql);
    assert!(parsed.scanned.errors.is_empty(), "{sql}: {:?}", parsed.scanned.errors);
    assert!(parsed.errors.is_empty(), "{sql}: {:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 1, "{sql}");
    parsed
}

fn root(parsed: &ParsedScript) -> &dashql_buffers::parser::Node {
    &parsed.nodes[parsed.statements[0].root as usize]
}

fn field<'a>(
    parsed: &'a ParsedScript,
    node: &dashql_buffers::parser::Node,
    key: K,
) -> &'a dashql_buffers::parser::Node {
    parsed
        .children(node)
        .iter()
        .find(|n| n.attribute_key() == key)
        .unwrap_or_else(|| panic!("missing {key:?} in {node:?}"))
}

/// The value of an enum node of a type
fn enum_value(node: &dashql_buffers::parser::Node, node_type: NodeType) -> u8 {
    assert_eq!(node.node_type(), node_type);
    node.children_begin_or_value() as u8
}

/// Is a boolean attribute set?
fn flag(parsed: &ParsedScript, node: &dashql_buffers::parser::Node, key: K) -> bool {
    let value = field(parsed, node, key);
    assert_eq!(value.node_type(), NodeType::BOOL);
    value.children_begin_or_value() != 0
}

fn keyword<'a>(parsed: &'a ParsedScript, node: &dashql_buffers::parser::Node) -> &'a str {
    assert_eq!(node.node_type(), NodeType::NAME);
    &parsed.scanned.names.get(node.children_begin_or_value()).text
}

#[test]
fn extended_queries_keep_select_and_expression_nodes() {
    let parsed = valid_sql("SELECT t.* EXCLUDE (x), CAST(y AS integer OR NULL) FROM t GROUP BY DISTINCT GROUPING SETS ((y), ()) ORDER BY ALL DESC FETCH FIRST 2 ROWS WITH TIES");
    assert_eq!(parsed.statements[0].statement_type, StatementType::SELECT);
    let select = root(&parsed);
    assert_eq!(select.node_type(), NodeType::OBJECT_SQL_SELECT);
    let targets = parsed.children(field(&parsed, select, K::SQL_SELECT_TARGETS));
    assert_eq!(parsed.children(field(&parsed, &targets[0], K::SQL_RESULT_TARGET_EXCLUDE)).len(), 1);
    let cast = field(&parsed, &targets[1], K::SQL_RESULT_TARGET_VALUE);
    assert_eq!(cast.node_type(), NodeType::OBJECT_SQL_FUNCTION_EXPRESSION);
    let args = field(&parsed, cast, K::SQL_FUNCTION_CAST_ARGS);
    assert_eq!(field(&parsed, args, K::SQL_FUNCTION_CAST_OR_NULL).children_begin_or_value(), 1);
    assert_eq!(field(&parsed, select, K::SQL_SELECT_GROUP_DISTINCT).children_begin_or_value(), 1);
    assert_eq!(field(&parsed, select, K::SQL_SELECT_LIMIT_WITH_TIES).children_begin_or_value(), 1);
    let orders = parsed.children(field(&parsed, select, K::SQL_SELECT_ORDER));
    assert_eq!(field(&parsed, &orders[0], K::SQL_ORDER_ALL).children_begin_or_value(), 1);
}

#[test]
fn update_has_target_assignments_ctes_and_returning() {
    let parsed = valid_sql(
        "WITH c AS (SELECT 1) UPDATE t AS dst SET x = y + 1, (y,z) = (2,3) FROM c WHERE dst.x > 0 RETURNING dst.x",
    );
    assert_eq!(parsed.statements[0].statement_type, StatementType::UPDATE);
    let update = root(&parsed);
    assert_eq!(update.node_type(), NodeType::OBJECT_SQL_UPDATE);
    assert_eq!(parsed.children(field(&parsed, update, K::SQL_SELECT_WITH_CTES)).len(), 1);
    let target = field(&parsed, update, K::SQL_UPDATE_TARGET);
    assert_eq!(target.node_type(), NodeType::OBJECT_SQL_TABLEREF);
    assert_eq!(field(&parsed, target, K::SQL_TABLEREF_ALIAS).node_type(), NodeType::NAME);
    let assignments = parsed.children(field(&parsed, update, K::SQL_UPDATE_ASSIGNMENTS));
    assert_eq!(assignments.len(), 2);
    assert_eq!(assignments[0].node_type(), NodeType::OBJECT_SQL_ASSIGNMENT);
    assert!(!parsed.children(&assignments[0]).iter().any(|n| n.attribute_key() == K::SQL_ASSIGNMENT_MULTIPLE));
    assert_eq!(
        field(&parsed, &assignments[0], K::SQL_ASSIGNMENT_VALUE).node_type(),
        NodeType::OBJECT_SQL_NARY_EXPRESSION
    );
    assert!(flag(&parsed, &assignments[1], K::SQL_ASSIGNMENT_MULTIPLE));
    assert_eq!(parsed.children(field(&parsed, &assignments[1], K::SQL_ASSIGNMENT_COLUMNS)).len(), 2);
    assert_eq!(parsed.children(field(&parsed, update, K::SQL_UPDATE_FROM)).len(), 1);
    assert_eq!(parsed.children(field(&parsed, update, K::SQL_UPDATE_RETURNING)).len(), 1);
    assert_eq!(parsed.node_text(field(&parsed, update, K::SQL_UPDATE_WHERE)), "dst.x > 0");
}

#[test]
fn merge_preserves_match_kinds_conditions_and_actions() {
    let parsed = valid_sql("MERGE INTO t USING u ON t.x = u.x WHEN MATCHED AND u.y > 0 THEN UPDATE SET y=u.y WHEN NOT MATCHED BY SOURCE THEN DELETE WHEN NOT MATCHED THEN INSERT (x,y) VALUES (u.x,u.y)");
    assert_eq!(parsed.statements[0].statement_type, StatementType::MERGE);
    let merge = root(&parsed);
    let clauses = parsed.children(field(&parsed, merge, K::SQL_MERGE_CLAUSES));
    assert_eq!(clauses.len(), 3);
    for (clause, kind, action) in [
        (&clauses[0], MergeMatch::MATCHED, MergeAction::UPDATE),
        (&clauses[1], MergeMatch::NOT_MATCHED_BY_SOURCE, MergeAction::DELETE),
        (&clauses[2], MergeMatch::NOT_MATCHED_BY_TARGET, MergeAction::INSERT),
    ] {
        assert_eq!(clause.node_type(), NodeType::OBJECT_SQL_MERGE_WHEN_CLAUSE);
        let kind_node = field(&parsed, clause, K::SQL_MERGE_WHEN_CLAUSE_KIND);
        assert_eq!(MergeMatch(enum_value(kind_node, NodeType::ENUM_SQL_MERGE_MATCH)), kind);
        let value = field(&parsed, clause, K::SQL_MERGE_WHEN_CLAUSE_ACTION);
        assert_eq!(value.node_type(), NodeType::OBJECT_SQL_MERGE_ACTION);
        let action_node = field(&parsed, value, K::SQL_MERGE_ACTION_KIND);
        assert_eq!(MergeAction(enum_value(action_node, NodeType::ENUM_SQL_MERGE_ACTION)), action);
    }
    assert_eq!(parsed.node_text(field(&parsed, &clauses[0], K::SQL_MERGE_WHEN_CLAUSE_CONDITION)), "u.y > 0");
}

#[test]
fn copy_and_prepare_contain_ordinary_nested_statements() {
    let parsed = valid_sql("COPY (SELECT x + 1 FROM t) TO NULL WITH (format csv, header true)");
    assert_eq!(parsed.statements[0].statement_type, StatementType::COPY);
    let copy = root(&parsed);
    assert_eq!(field(&parsed, copy, K::SQL_COPY_QUERY).node_type(), NodeType::OBJECT_SQL_SELECT);
    assert_eq!(parsed.children(field(&parsed, copy, K::SQL_COPY_OPTIONS)).len(), 2);
    let parsed = valid_sql("PREPARE p(integer) AS UPDATE t SET x = $1 RETURNING x");
    assert_eq!(parsed.statements[0].statement_type, StatementType::PREPARE);
    assert_eq!(field(&parsed, root(&parsed), K::SQL_PREPARE_STATEMENT).node_type(), NodeType::OBJECT_SQL_UPDATE);
    assert_eq!(parsed.children(field(&parsed, root(&parsed), K::SQL_PREPARE_PARAMETER_TYPES)).len(), 1);
}

#[test]
fn json_value_has_input_path_return_type_and_behavior_fields() {
    let parsed = valid_sql(
        "SELECT JSON_VALUE(doc FORMAT JSON, '$.x' RETURNING integer DEFAULT 0 ON EMPTY ERROR ON ERROR) FROM t",
    );
    let targets = parsed.children(field(&parsed, root(&parsed), K::SQL_SELECT_TARGETS));
    let value = field(&parsed, &targets[0], K::SQL_RESULT_TARGET_VALUE);
    assert_eq!(value.node_type(), NodeType::OBJECT_SQL_JSON_VALUE);
    let input = field(&parsed, value, K::SQL_JSON_VALUE);
    assert_eq!(input.node_type(), NodeType::OBJECT_SQL_JSON_INPUT);
    assert_eq!(field(&parsed, input, K::SQL_JSON_FORMAT).children_begin_or_value(), 1);
    assert_eq!(parsed.node_text(field(&parsed, value, K::SQL_JSON_PATH)), "'$.x'");
    assert_eq!(field(&parsed, value, K::SQL_JSON_RETURNING).node_type(), NodeType::OBJECT_SQL_TYPENAME);
    let behaviors = field(&parsed, value, K::SQL_JSON_BEHAVIORS);
    let empty = field(&parsed, behaviors, K::SQL_JSON_ON_EMPTY);
    let kind = field(&parsed, empty, K::SQL_JSON_BEHAVIOR_KIND);
    assert_eq!(JsonBehavior(enum_value(kind, NodeType::ENUM_SQL_JSON_BEHAVIOR)), JsonBehavior::DEFAULT);
    assert_eq!(parsed.node_text(field(&parsed, empty, K::SQL_JSON_BEHAVIOR_DEFAULT)), "0");
    let error = field(&parsed, behaviors, K::SQL_JSON_ON_ERROR);
    let kind = field(&parsed, error, K::SQL_JSON_BEHAVIOR_KIND);
    assert_eq!(JsonBehavior(enum_value(kind, NodeType::ENUM_SQL_JSON_BEHAVIOR)), JsonBehavior::ERROR);
}

#[test]
fn function_parameters_have_names_types_modes_defaults_and_nullability() {
    let parsed = valid_sql("CREATE OR REPLACE FUNCTION f(IN x integer NOT NULL DEFAULT 2) RETURNS integer NOT NULL LANGUAGE SQL AS 'select x'");
    let function = root(&parsed);
    assert_eq!(parsed.statements[0].statement_type, StatementType::CREATE_FUNCTION);
    assert_eq!(field(&parsed, function, K::SQL_CREATE_FUNCTION_REPLACE).node_type(), NodeType::BOOL);
    assert_eq!(field(&parsed, function, K::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL).node_type(), NodeType::BOOL);
    let params = parsed.children(field(&parsed, function, K::SQL_CREATE_FUNCTION_PARAMS));
    assert_eq!(params.len(), 1);
    let param = &params[0];
    assert_eq!(param.node_type(), NodeType::OBJECT_SQL_FUNCTION_PARAM);
    assert_eq!(keyword(&parsed, field(&parsed, param, K::SQL_FUNCTION_PARAM_NAME)), "x");
    assert_eq!(field(&parsed, param, K::SQL_FUNCTION_PARAM_TYPE).node_type(), NodeType::OBJECT_SQL_TYPENAME);
    assert_eq!(parsed.node_text(field(&parsed, param, K::SQL_FUNCTION_PARAM_DEFAULT)), "2");
    assert_eq!(field(&parsed, param, K::SQL_FUNCTION_PARAM_NOT_NULL).children_begin_or_value(), 1);
    assert_eq!(parsed.children(field(&parsed, function, K::SQL_CREATE_FUNCTION_OPTIONS)).len(), 2);
}

#[test]
fn all_accepted_extensions_have_valid_tree_edges_and_spans() {
    for &(name, sql) in super::hyper_cases::CASES {
        let parsed = valid_sql(sql);
        for statement in &parsed.statements {
            let end = statement.nodes_begin + statement.node_count;
            let mut pending = vec![statement.root];
            while let Some(i) = pending.pop() {
                assert!(i >= statement.nodes_begin && i < end, "{name}");
                let node = &parsed.nodes[i as usize];
                let span = node.symbol_span();
                assert!(span.offset() + span.length() <= parsed.scanned.symbols.len() as u32, "{name}: {node:?}");
                if node.node_type() == NodeType::ARRAY || node.node_type().0 > NodeType::OBJECT_KEYS_.0 {
                    for (j, child) in parsed.children(node).iter().enumerate() {
                        assert_eq!(child.parent(), i, "{name}: {child:?}");
                        pending.push(node.children_begin_or_value() + j as u32);
                    }
                }
            }
        }
    }
}

#[test]
fn external_stream_cardinality_is_a_numeric_expression() {
    let parsed = valid_sql("SELECT * FROM EXTERNAL STREAM events (WITH (CARDINALITY 12.5))");
    let from = parsed.children(field(&parsed, root(&parsed), K::SQL_SELECT_FROM));
    let stream = field(&parsed, &from[0], K::SQL_TABLEREF_TABLE);
    assert_eq!(stream.node_type(), NodeType::OBJECT_SQL_EXTERNAL_STREAM);
    let cardinality = field(&parsed, stream, K::SQL_EXTERNAL_STREAM_CARDINALITY);
    assert_eq!(cardinality.node_type(), NodeType::LITERAL_FLOAT);
    assert_eq!(parsed.node_text(cardinality), "12.5");
}

#[test]
fn command_kinds_are_enums_and_flags() {
    // DROP INDEX CONCURRENTLY IF EXISTS splits into its object type and two flags
    let parsed = valid_sql("DROP INDEX CONCURRENTLY IF EXISTS i CASCADE");
    let drop = root(&parsed);
    assert_eq!(drop.node_type(), NodeType::OBJECT_SQL_DROP);
    let object_type = field(&parsed, drop, K::SQL_DROP_TYPE);
    assert_eq!(DropObjectType(enum_value(object_type, NodeType::ENUM_SQL_DROP_OBJECT_TYPE)), DropObjectType::INDEX);
    assert!(flag(&parsed, drop, K::SQL_DROP_CONCURRENTLY));
    assert!(flag(&parsed, drop, K::SQL_DROP_IF_EXISTS));

    // FETCH BACKWARD ALL is a direction with the ALL flag, MOVE a flag of the FETCH
    let parsed = valid_sql("MOVE BACKWARD ALL FROM c");
    let fetch = root(&parsed);
    assert!(flag(&parsed, fetch, K::SQL_FETCH_MOVE));
    let direction = field(&parsed, fetch, K::SQL_FETCH_DIRECTION);
    let kind = field(&parsed, direction, K::SQL_FETCH_DIRECTION_KIND);
    assert_eq!(FetchDirection(enum_value(kind, NodeType::ENUM_SQL_FETCH_DIRECTION)), FetchDirection::BACKWARD);
    assert!(flag(&parsed, direction, K::SQL_FETCH_DIRECTION_ALL));

    // GRANT ON ALL TABLES IN SCHEMA is a relation target with the ALL IN SCHEMA flag
    let parsed = valid_sql("GRANT SELECT ON ALL TABLES IN SCHEMA s TO r");
    let target = field(&parsed, root(&parsed), K::SQL_GRANT_TARGET);
    let kind = field(&parsed, target, K::SQL_GRANT_TARGET_KIND);
    assert_eq!(GrantTargetType(enum_value(kind, NodeType::ENUM_SQL_GRANT_TARGET_TYPE)), GrantTargetType::RELATION);
    assert!(flag(&parsed, target, K::SQL_GRANT_TARGET_ALL_IN_SCHEMA));

    // NO MAXVALUE is the MAXVALUE option with the NO flag
    let parsed = valid_sql("CREATE SEQUENCE s NO MAXVALUE");
    let options = parsed.children(field(&parsed, root(&parsed), K::SQL_CREATE_SEQUENCE_OPTIONS));
    let kind = field(&parsed, &options[0], K::SQL_SEQUENCE_OPTION_KIND);
    assert_eq!(SequenceOption(enum_value(kind, NodeType::ENUM_SQL_SEQUENCE_OPTION)), SequenceOption::MAX_VALUE);
    assert!(flag(&parsed, &options[0], K::SQL_SEQUENCE_OPTION_NO));

    // SHOW TIME ZONE names the parameter, SET x TO DEFAULT is a flag
    let parsed = valid_sql("SHOW TIME ZONE");
    let parameter = field(&parsed, root(&parsed), K::SQL_SHOW_PARAMETER);
    assert_eq!(
        SessionParameter(enum_value(parameter, NodeType::ENUM_SQL_SESSION_PARAMETER)),
        SessionParameter::TIME_ZONE
    );
    let parsed = valid_sql("SET search_path TO DEFAULT");
    assert!(flag(&parsed, root(&parsed), K::SQL_SET_DEFAULT));
}
