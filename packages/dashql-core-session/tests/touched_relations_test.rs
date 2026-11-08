//! The relations that statements touch.

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core_session::touched_relations::touched_relations;

/// A name as `db.schema.relation`, with the parts that were written
fn describe(name: &QualifiedTableNameT) -> String {
    [&name.database_name, &name.schema_name, &name.table_name].into_iter().flatten().map(String::as_str).collect::<Vec<_>>().join(".")
}

fn touched(text: &str) -> Vec<String> {
    let touched = touched_relations(text);
    assert!(touched.parsed);
    touched.relations.iter().flatten().map(describe).collect()
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
fn statements_that_do_not_parse_are_reported() {
    assert!(!touched_relations("alter table t add column b int").parsed);
    assert!(!touched_relations("select 'unterminated").parsed);
}
