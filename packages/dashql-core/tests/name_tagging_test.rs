//! Tests of the name tags of the analyzer.
//!
//! The analyzer leaves the scan untouched and keeps the names and their tags in the analyzed script.

use dashql_buffers::analyzer::NameTag;
use dashql_core::analyzer::analyze;
use dashql_core::catalog::Catalog;
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use std::sync::Arc;

const COLUMN_NAME: u8 = NameTag::COLUMN_NAME.0;
const TABLE_NAME: u8 = NameTag::TABLE_NAME.0;
const TABLE_ALIAS: u8 = NameTag::TABLE_ALIAS.0;
const SCHEMA_NAME: u8 = NameTag::SCHEMA_NAME.0;
const DATABASE_NAME: u8 = NameTag::DATABASE_NAME.0;

fn test(script: &str, expected: &[(&str, u8)]) {
    let scanned = Arc::new(scan(script, 0, 0));
    let parsed = Arc::new(parse(scanned));
    assert!(parsed.errors.is_empty(), "{}", parsed.errors[0].message);
    let catalog = Catalog::new();
    let analyzed = analyze(parsed, &catalog).unwrap();

    // The names with their tags, looked up by text. The analyzer also registers the empty name for unqualified table
    // names, which is left out.
    let mut have: Vec<(&str, u8)> = analyzed
        .names
        .iter()
        .enumerate()
        .filter(|(_, n)| !n.text.is_empty())
        .map(|(i, n)| (n.text.as_str(), analyzed.name_tags[i].0))
        .collect();
    have.sort();
    let mut expected = expected.to_vec();
    expected.sort();
    assert_eq!(have, expected);
}

#[test]
fn select_1() {
    test("select 1", &[]);
}

#[test]
fn select_foo() {
    test("select foo", &[("foo", COLUMN_NAME)]);
}

#[test]
fn select_foo_from_bar() {
    test("select foo from bar", &[("foo", COLUMN_NAME), ("bar", TABLE_NAME)]);
}

#[test]
fn select_foo_from_foo() {
    test("select foo from foo", &[("foo", COLUMN_NAME | TABLE_NAME)]);
}

#[test]
fn select_foo_from_foo_foo() {
    test("select foo from foo foo", &[("foo", COLUMN_NAME | TABLE_NAME | TABLE_ALIAS)]);
}

#[test]
fn select_foo_from_foo_bar() {
    test("select foo from foo bar", &[("foo", COLUMN_NAME | TABLE_NAME), ("bar", TABLE_ALIAS)]);
}

#[test]
fn select_foo_bar_from_the_foo() {
    test("select foo.bar from the foo", &[("foo", TABLE_ALIAS), ("bar", COLUMN_NAME), ("the", TABLE_NAME)]);
}

#[test]
fn select_foo_bar_from_the_real_foo() {
    test(
        "select foo.bar from the.real foo",
        &[("foo", TABLE_ALIAS), ("bar", COLUMN_NAME), ("the", SCHEMA_NAME), ("real", TABLE_NAME)],
    );
}

#[test]
fn select_foo_bar_from_the_actually_real_foo() {
    test(
        "select foo.bar from the.actually.real foo",
        &[
            ("foo", TABLE_ALIAS),
            ("bar", COLUMN_NAME),
            ("the", DATABASE_NAME),
            ("actually", SCHEMA_NAME),
            ("real", TABLE_NAME),
        ],
    );
}

#[test]
fn quoted_identifier() {
    test("select * from \"SomeQuotedString\"", &[("SomeQuotedString", TABLE_NAME)]);
}
