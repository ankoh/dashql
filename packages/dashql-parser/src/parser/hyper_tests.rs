use super::{parse, ParsedScript};
use crate::scanner::scan;
use dashql_buffers::parser::{AttributeKey as K, NodeType, StatementType};
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
    ] {
        let parsed = parse_sql(sql);
        assert!(!parsed.errors.is_empty() || !parsed.scanned.errors.is_empty(), "accepted invalid SQL: {sql}");
    }
}

#[test]
fn syntax_only_statements_preserve_structure_and_source_spans() {
    let sql = "-- first\nSELECT 1;\n-- second\nUPDATE t SET x = 2 RETURNING x;\nSELECT 3;";
    let parsed = parse_sql(sql);
    assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 3);
    assert_eq!(parsed.statements[0].statement_type, StatementType::SELECT);
    assert_eq!(parsed.statements[1].statement_type, StatementType::SQL_SYNTAX);
    assert_eq!(parsed.statements[2].statement_type, StatementType::SELECT);
    let descriptions = parsed.associate_descriptions();
    assert_eq!(descriptions[1].description_count, 1);
    let statement = parsed.statements[1];
    let root = &parsed.nodes[statement.root as usize];
    assert_eq!(root.node_type(), NodeType::OBJECT_SQL_SYNTAX);
    assert_eq!(parsed.node_text(root), "UPDATE t SET x = 2 RETURNING x");
    let rule = parsed.children(root).iter().find(|c| c.attribute_key() == K::SQL_SYNTAX_RULE).unwrap();
    assert_eq!(parsed.scanned.names.get(rule.children_begin_or_value()).text, "Stmt");
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
    assert!(parsed.statements.iter().any(|s| s.statement_type == StatementType::SQL_SYNTAX));
    assert_eq!(parsed.statements.iter().filter(|s| s.statement_type == StatementType::SELECT).count(), 2);
}

#[test]
fn syntax_only_parsing_respects_the_nesting_limit() {
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
