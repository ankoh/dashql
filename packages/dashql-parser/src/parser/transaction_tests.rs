use super::{parse, ParsedScript};
use crate::scanner::scan;
use dashql_buffers::parser::{AttributeKey as K, Node, NodeType, StatementType};
use std::sync::Arc;

fn parse_transaction(sql: &str) -> ParsedScript {
    let parsed = parse(Arc::new(scan(sql, 0, 2)));
    assert!(parsed.scanned.errors.is_empty(), "{sql}: {:?}", parsed.scanned.errors);
    assert!(parsed.errors.is_empty(), "{sql}: {:?}", parsed.errors);
    assert_eq!(parsed.statements.len(), 1, "{sql}");
    assert_eq!(parsed.statements[0].statement_type, StatementType::TRANSACTION, "{sql}");
    parsed
}

fn root(parsed: &ParsedScript) -> &Node {
    &parsed.nodes[parsed.statements[0].root as usize]
}

fn child<'a>(parsed: &'a ParsedScript, node: &Node, key: K) -> &'a Node {
    parsed.children(node).iter().find(|n| n.attribute_key() == key).unwrap()
}

fn name<'a>(parsed: &'a ParsedScript, node: &Node) -> &'a str {
    assert_eq!(node.node_type(), NodeType::NAME);
    &parsed.scanned.names.get(node.children_begin_or_value()).text
}

#[test]
fn transaction_commands_and_qualifiers() {
    for command in ["begin", "commit", "end", "rollback", "abort"] {
        for qualifier in ["", " work", " transaction"] {
            let sql = format!("{}{};", command.to_uppercase(), qualifier);
            let parsed = parse_transaction(&sql);
            assert_eq!(name(&parsed, child(&parsed, root(&parsed), K::SQL_TRANSACTION_COMMAND)), command);
            assert_eq!(parsed.children(root(&parsed)).len(), 1, "{sql}");
        }
    }
    let parsed = parse_transaction("START TRANSACTION");
    assert_eq!(name(&parsed, child(&parsed, root(&parsed), K::SQL_TRANSACTION_COMMAND)), "start");
}

#[test]
fn transaction_modes_preserve_order_values_and_duplicates() {
    for start in ["begin", "begin work", "begin transaction", "start transaction"] {
        for separator in [" ", ", "] {
            let modes = [
                "isolation level read uncommitted",
                "read only",
                "not deferrable",
                "isolation level read committed",
                "read write",
                "deferrable",
                "isolation level repeatable read",
                "isolation level serializable",
                "read only",
            ];
            let parsed = parse_transaction(&format!("{start} {};", modes.join(separator)));
            let modes = parsed.children(child(&parsed, root(&parsed), K::SQL_TRANSACTION_MODES));
            assert_eq!(modes.len(), 9);
            for (i, expected) in
                [(0, "read uncommitted"), (3, "read committed"), (6, "repeatable read"), (7, "serializable")]
            {
                assert_eq!(name(&parsed, child(&parsed, &modes[i], K::SQL_TRANSACTION_ISOLATION_LEVEL)), expected);
            }
            for (i, key, expected) in [
                (1, K::SQL_TRANSACTION_READ_ONLY, 1),
                (2, K::SQL_TRANSACTION_DEFERRABLE, 0),
                (4, K::SQL_TRANSACTION_READ_ONLY, 0),
                (5, K::SQL_TRANSACTION_DEFERRABLE, 1),
                (8, K::SQL_TRANSACTION_READ_ONLY, 1),
            ] {
                let value = child(&parsed, &modes[i], key);
                assert_eq!(value.node_type(), NodeType::BOOL);
                assert_eq!(value.children_begin_or_value(), expected);
            }
        }
    }
}

#[test]
fn transaction_savepoint_targets() {
    for (target, expected) in
        [("checkpoint", "checkpoint"), ("savepoint", "savepoint"), ("begin", "begin"), ("\"Mixed Case\"", "Mixed Case")]
    {
        for prefix in [
            "savepoint",
            "release",
            "release savepoint",
            "rollback to",
            "rollback to savepoint",
            "rollback work to",
            "rollback transaction to savepoint",
        ] {
            let parsed = parse_transaction(&format!("{prefix} {target};"));
            assert_eq!(name(&parsed, child(&parsed, root(&parsed), K::SQL_TRANSACTION_TARGET)), expected);
            assert!(!parsed.children(root(&parsed)).iter().any(|n| n.attribute_key() == K::SQL_TRANSACTION_PREPARED));
        }
    }
}

#[test]
fn transaction_prepared_ids_are_literals() {
    for (prefix, command) in
        [("prepare transaction", "prepare"), ("commit prepared", "commit"), ("rollback prepared", "rollback")]
    {
        let parsed = parse_transaction(&format!("{prefix} 'batch''s id';"));
        let root = root(&parsed);
        assert_eq!(name(&parsed, child(&parsed, root, K::SQL_TRANSACTION_COMMAND)), command);
        let target = child(&parsed, root, K::SQL_TRANSACTION_TARGET);
        assert_eq!(target.node_type(), NodeType::LITERAL_STRING);
        assert_eq!(parsed.node_text(target), "'batch''s id'");
        assert_eq!(child(&parsed, root, K::SQL_TRANSACTION_PREPARED).children_begin_or_value(), 1);
    }
}

#[test]
fn transaction_invalid_forms() {
    for sql in [
        "start",
        "start work",
        "start read only",
        "begin transaction work",
        "commit and chain",
        "rollback and no chain",
        "commit read only",
        "abort to checkpoint",
        "begin isolation level",
        "begin isolation level snapshot",
        "begin isolation read committed",
        "begin read",
        "begin not",
        "begin , read only",
        "begin read only,",
        "begin read only,,deferrable",
        "savepoint",
        "savepoint 'checkpoint'",
        "release",
        "release savepoint 'checkpoint'",
        "rollback to",
        "rollback to savepoint 'checkpoint'",
        "prepare transaction",
        "prepare transaction batch",
        "commit prepared",
        "rollback prepared batch",
        "end prepared 'batch'",
    ] {
        let parsed = parse(Arc::new(scan(sql, 0, 2)));
        assert!(!parsed.errors.is_empty(), "accepted invalid transaction: {sql}");
    }
}

#[test]
fn transaction_error_recovery_preserves_following_statements() {
    let parsed = parse(Arc::new(scan("begin read invalid; rollback; select 1;", 0, 2)));
    assert!(!parsed.errors.is_empty());
    assert_eq!(
        parsed.statements.iter().map(|s| s.statement_type).collect::<Vec<_>>(),
        vec![StatementType::TRANSACTION, StatementType::SELECT]
    );
}
