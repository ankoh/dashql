//! The relations that statements touch.

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core_session::touched_relations::touched_relations;

/// A name as `db.schema.relation`, with the parts that were written
fn describe(name: &QualifiedTableNameT) -> String {
    [&name.database_name, &name.schema_name, &name.table_name].into_iter().flatten().map(String::as_str).collect::<Vec<_>>().join(".")
}

fn touched(text: &str) -> Vec<String> {
    touched_relations(text).relations.iter().flatten().map(describe).collect()
}

#[test]
fn names_the_relations_of_ddl_statements_as_written() {
    assert_eq!(
        touched(
            "create table t (a int);
             create table if not exists s.t2 (a int);
             create table d.s.t3 as select 1 as a;
             create view v as select 1 as a;
             select 1 as a into t4;
             create temp table t5 (a int);
             drop table s.t;
             drop view v;"
        ),
        ["t", "s.t2", "d.s.t3", "v", "t4", "t5", "s.t", "v"]
    );
}

#[test]
fn other_statements_touch_nothing() {
    assert!(touched("select 1; insert into t values (1); delete from t; set a = 1; explain select 1;").is_empty());
}

#[test]
fn alter_table_names_its_relation() {
    for action in [
        "add column b int",
        "add b int",
        "add column if not exists b int",
        "drop column b",
        "drop b",
        "drop column if exists b",
        "rename column a to b",
        "rename a to b",
        "alter column a set data type bigint",
        "alter a type bigint",
        "add column b int, drop column c",
    ] {
        assert_eq!(touched(&format!("alter table s.t {action}")), ["s.t"], "{action}");
        assert_eq!(touched(&format!("alter table if exists s.t {action}")), ["s.t"], "{action}");
    }
}

#[test]
fn alter_table_that_moves_a_relation_names_both_names() {
    assert_eq!(touched("alter table t rename to u"), ["t", "u"]);
    assert_eq!(touched("alter table s.t rename to u"), ["s.t", "s.u"]);
    assert_eq!(touched("alter table d.s.t rename to u"), ["d.s.t", "d.s.u"]);
    assert_eq!(touched("alter table s.t rename to other.u"), ["s.t", "other.u"]);
    assert_eq!(touched("alter table s.t set schema other"), ["s.t", "other.t"]);
    assert_eq!(touched("alter table d.s.t set schema other"), ["d.s.t", "d.other.t"]);
}

#[test]
fn alter_view_names_both_names() {
    assert_eq!(touched("alter view v rename to w"), ["v", "w"]);
    assert_eq!(touched("alter view if exists s.v set schema other"), ["s.v", "other.v"]);
}

#[test]
fn schema_statements_name_the_schema() {
    // An empty table is the whole schema
    let schema = |text: &str| -> Vec<(Option<String>, Option<String>, Option<String>)> {
        touched_relations(text).relations.iter().flatten().map(|r| (r.database_name.clone(), r.schema_name.clone(), r.table_name.clone())).collect()
    };
    let name = |s: &str| (None, Some(s.to_string()), Some(String::new()));
    assert_eq!(schema("drop schema s"), [name("s")]);
    assert_eq!(schema("drop schema if exists s cascade"), [name("s")]);
    assert_eq!(schema("drop schema d.s restrict"), [(Some("d".to_string()), Some("s".to_string()), Some(String::new()))]);
    assert_eq!(schema("alter schema s rename to t"), [name("s"), name("t")]);
    assert!(schema("create schema if not exists s").is_empty());
}

#[test]
fn explain_touches_what_it_runs() {
    assert_eq!(touched("explain (analyze) create table s.t as select 1 as a"), ["s.t"]);
    assert!(touched("explain create table s.t as select 1 as a").is_empty());
    assert!(touched("explain (analyze false) create table s.t as select 1 as a").is_empty());
}

#[test]
fn statements_that_do_not_parse_touch_nothing() {
    // The parser doesn't know every statement and dialect, that is no reason to ask a connection anything
    for text in [
        "alter table t owner to someone",
        "select 'unterminated",
        "SELECT * FROM t MATCH_RECOGNIZE (",
        "show tables like",
        "begin transaction isolation level",
        "vacuum t",
        "not a statement",
        "",
    ] {
        assert!(touched(text).is_empty(), "{text}");
    }
}
