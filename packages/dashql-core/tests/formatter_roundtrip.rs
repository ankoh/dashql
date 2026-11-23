//! Formats the scripts of the parser snapshots and checks the output against the parser.
//!
//! Every script of the parser snapshots that parses without errors must be fully formattable, and its
//! formatted output must parse without errors again, to a tree with the same nodes. Without comments the output
//! must also be stable when it is formatted a second time.

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
use dashql_core::formatter::Formatter;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use dashql_snapshots::load_category;
use std::sync::Arc;

/// Scripts that the formatter rejects on purpose
const UNFORMATTABLE: &[&str] = &[
    // DEFAULT is only formatted as a value of an INSERT
    "select somefunc(default);",
    // Empty ROW types now parse, but the formatter has no representation for them yet.
    "create table t (p row())",
    // Statements that the formatter writes as placeholders
    "UPDATE t SET x = 1 RETURNING x;",
    "SELECT 1;\n-- Copy a query result.\nCOPY (SELECT JSON_OBJECT('answer': 42)) TO NULL;\nSELECT 2;",
    "MERGE INTO t USING u ON t.x = u.x WHEN MATCHED THEN UPDATE SET y=u.y WHEN NOT MATCHED BY SOURCE THEN DELETE WHEN NOT MATCHED THEN INSERT (x,y) VALUES (u.x,u.y);",
    "PREPARE p(integer) AS UPDATE t SET x=$1 RETURNING x;",
    "CREATE DATABASE db;",
    "DECLARE c SCROLL CURSOR FOR SELECT x FROM t;",
    // Clauses that the formatter does not write yet: SQL/JSON, external streams
    "SELECT JSON_VALUE(doc FORMAT JSON, '$.x' RETURNING integer DEFAULT 0 ON EMPTY ERROR ON ERROR) FROM t;",
    "SELECT * FROM EXTERNAL STREAM events (WITH (CARDINALITY 100));",
];

/// Scripts whose formatted output spells a construct differently, with another tree of the same meaning
const RESPELLED: &[&str] = &[
    // Array types are written as `t[]`
    "select cast(a as text array)",
    "create table t (ps array(row(x int)), qs row(x int)[])",
    "select cast(json_parse(payload) as array(json)) as entries from event_stream",
];

/// Does the script parse without scanner and parser errors?
fn is_valid(parsed: &ParsedScript) -> bool {
    parsed.errors.is_empty() && parsed.scanned.errors.is_empty()
}

/// The node types and attribute keys of a parsed script, sorted. Formatting must keep them, so that a clause
/// that the formatter does not write fails the round trip, but it may reorder clauses.
fn shape(parsed: &ParsedScript) -> Vec<(u16, u16)> {
    let mut shape: Vec<_> = parsed.nodes.iter().map(|n| (n.node_type().0, n.attribute_key().0)).collect();
    shape.sort_unstable();
    shape
}

/// The config of the formatter runs
fn config(mode: FormattingMode) -> FormattingConfigT {
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect::HYPER;
    config.mode = mode;
    config.max_width = 120;
    config.indentation_width = 2;
    config
}

#[test]
fn formatted_parser_snapshots_parse_again() {
    let mut failures = Vec::new();
    let mut checked = 0;
    for case in load_category("parser").unwrap() {
        let Some(input) = case.input() else { continue };
        let parsed = parse(Arc::new(scan(&input, 0, 2)));
        if !is_valid(&parsed) || UNFORMATTABLE.contains(&input.trim()) {
            continue;
        }
        for mode in [FormattingMode::INLINE, FormattingMode::COMPACT, FormattingMode::PRETTY] {
            checked += 1;
            let config = config(mode);
            let mut formatter = Formatter::new(&parsed);
            let formatted = formatter.format(&config);
            if !formatter.is_fully_formatted() {
                let nodes: Vec<_> = formatter
                    .unformattable_nodes()
                    .iter()
                    .map(|&n| format!("{:?}", parsed.nodes[n as usize].node_type().variant_name()))
                    .collect();
                failures.push(format!("{}: unformattable {nodes:?} in {input:?}", case.trial_name()));
                continue;
            }
            let reparsed = parse(Arc::new(scan(&formatted, 0, 2)));
            if !is_valid(&reparsed) {
                failures.push(format!("{}: output does not parse: {formatted:?} of {input:?}", case.trial_name()));
                continue;
            }
            if shape(&reparsed) != shape(&parsed) && !RESPELLED.contains(&input.trim()) {
                failures.push(format!("{}: output changes the tree: {formatted:?} of {input:?}", case.trial_name()));
                continue;
            }
            if parsed.scanned.comments.is_empty() {
                let again = Formatter::new(&reparsed).format(&config);
                if again != formatted {
                    failures.push(format!("{}: unstable output {formatted:?} then {again:?}", case.trial_name()));
                }
            }
        }
    }
    assert!(checked > 0, "no formatter runs");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}
