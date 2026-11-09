//! Tests of the table declarations of CREATE TABLE, CREATE TABLE AS, views and SELECT INTO.

use dashql_core::catalog::CatalogLayer;
use dashql_core::catalog::{Catalog, TableDeclaration};
use dashql_core::script::Script;

/// Analyze a script that declares a single table
fn analyze_single_table(input: &str, catalog: &Catalog) -> Script {
    let mut script = Script::new(catalog);
    script.insert_text_at(0, input);
    script.analyze(catalog, true).unwrap();
    assert_eq!(script.analyzed.as_ref().unwrap().entry.table_declarations.len(), 1);
    script
}

fn single_table(script: &Script) -> &TableDeclaration {
    &script.analyzed.as_ref().unwrap().entry.table_declarations[0]
}

fn expect_columns(table: &TableDeclaration, expected: &[&str]) {
    let names: Vec<&str> = table.table_columns.iter().map(|c| c.column_name.text()).collect();
    assert_eq!(names, expected);
}

/// Analyze and load the schema `create table source (id int, amount int)`
fn load_source_schema(catalog: &mut Catalog) -> Script {
    let mut schema = Script::new(catalog);
    schema.insert_text_at(0, "create table source (id int, amount int)");
    schema.analyze(catalog, true).unwrap();
    catalog.load_script(schema.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    schema
}

#[test]
fn create_table_as_derives_named_select_columns() {
    let mut catalog = Catalog::new();
    let _schema = load_source_schema(&mut catalog);

    let script = analyze_single_table(
        "create table result as with selected as (select * from source) select *, amount + 1, id as renamed from selected",
        &catalog,
    );
    let table = single_table(&script);
    assert_eq!(table.table_name.table_name.text(), "result");
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["amount", "id", "renamed"]);
}

#[test]
fn explicit_create_aliases_override_select_output_names() {
    let catalog = Catalog::new();
    let script = analyze_single_table("create view result(first, second) as select 1 as old, 2 as names", &catalog);
    let table = single_table(&script);
    assert_eq!(table.table_name.table_name.text(), "result");
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["first", "second"]);
}

#[test]
fn explicit_create_table_aliases_override_select_output_names() {
    let catalog = Catalog::new();
    let script = analyze_single_table("create table result(first, second) as select 1 as old, 2 as names", &catalog);
    let table = single_table(&script);
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["first", "second"]);
}

#[test]
fn view_derives_cte_alias_columns() {
    let catalog = Catalog::new();
    let script = analyze_single_table(
        "create view result as with source(first, second) as (select 1 as old, 2 as names) select * from source",
        &catalog,
    );
    let table = single_table(&script);
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["first", "second"]);
}

#[test]
fn select_into_declares_table_from_resolved_star() {
    let mut catalog = Catalog::new();
    let _schema = load_source_schema(&mut catalog);

    let script = analyze_single_table("select *, id as copied_id, amount + 1 into result from source", &catalog);
    let table = single_table(&script);
    assert_eq!(table.table_name.table_name.text(), "result");
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["amount", "id", "copied_id"]);
}

#[test]
fn ordinary_create_table_keeps_declared_columns_and_statement_id() {
    let catalog = Catalog::new();
    let script = analyze_single_table("create table result (z int, a int)", &catalog);
    let table = single_table(&script);
    assert_eq!(table.ast_statement_id, Some(0));
    expect_columns(table, &["a", "z"]);
}

#[test]
fn derived_table_columns_are_indexed() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(
        0,
        "create table source (id int); create table derived as select id as copied_id from source; select copied_id from derived",
    );
    script.analyze(&catalog, true).unwrap();

    let analyzed = script.analyzed.as_ref().unwrap();
    assert_eq!(analyzed.entry.table_declarations.len(), 2);
    let derived = &analyzed.entry.table_declarations[1];
    assert_eq!(derived.ast_statement_id, Some(1));
    assert!(derived.table_columns_by_name.contains_key("copied_id"));
}

#[test]
fn set_operation_uses_left_input_columns() {
    let catalog = Catalog::new();
    let script = analyze_single_table("create view result as select 1 as first union all select 2 as second", &catalog);
    expect_columns(single_table(&script), &["first"]);
}

#[test]
fn derived_tables_keep_the_types_of_passed_through_columns() {
    let mut catalog = Catalog::new();
    let _schema = load_source_schema(&mut catalog);

    let script = analyze_single_table(
        "create table result as with selected as (select * from source) select *, amount + 1 as next, id as renamed from selected",
        &catalog,
    );
    let types: Vec<(&str, Option<&str>)> = single_table(&script).table_columns.iter().map(|c| (c.column_name.text(), c.column_type.as_deref())).collect();
    assert_eq!(
        types,
        vec![("amount", Some("integer")), ("id", Some("integer")), ("next", None), ("renamed", Some("integer"))]
    );

    // Column aliases name the output columns by position
    let script = analyze_single_table("create view aliased (a, b) as select amount + 1, id from source", &catalog);
    let types: Vec<(&str, Option<&str>)> = single_table(&script).table_columns.iter().map(|c| (c.column_name.text(), c.column_type.as_deref())).collect();
    assert_eq!(types, vec![("a", None), ("b", Some("integer"))]);
}

/// The tables that a script declares as `schema.table(a, b)`, columns in declaration order
fn declared(text: &str, catalog_sql: Option<&str>) -> Vec<String> {
    let mut catalog = Catalog::new();
    if let Some(catalog_sql) = catalog_sql {
        let mut schema = Script::new(&catalog);
        schema.insert_text_at(0, catalog_sql);
        schema.analyze(&catalog, true).unwrap();
        catalog.load_script(schema.analyzed.clone().unwrap(), CatalogLayer::CONNECTION).unwrap();
    }
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, text);
    script.analyze(&catalog, true).unwrap();
    script.analyzed.as_ref().unwrap().entry.table_declarations.iter().map(|t| {
        let mut columns: Vec<_> = t.table_columns.iter().collect();
        columns.sort_by_key(|c| c.ast_node_id.unwrap_or(0));
        let columns: Vec<&str> = columns.iter().map(|c| c.column_name.text()).collect();
        format!("{}.{}({})", t.table_name.schema_name.text(), t.table_name.table_name.text(), columns.join(", "))
    }).collect()
}

/// The unresolved columns of a script
fn unresolved(text: &str, catalog_sql: Option<&str>) -> Vec<String> {
    let mut catalog = Catalog::new();
    if let Some(catalog_sql) = catalog_sql {
        let mut schema = Script::new(&catalog);
        schema.insert_text_at(0, catalog_sql);
        schema.analyze(&catalog, true).unwrap();
        catalog.load_script(schema.analyzed.clone().unwrap(), CatalogLayer::CONNECTION).unwrap();
    }
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, text);
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.as_ref().unwrap();
    analyzed.expressions.iter().filter_map(|e| e.column_ref()).filter(|c| matches!(c.resolved, dashql_core::analyzer::ColumnResolution::Unresolved)).map(|c| c.column_name.column_name.text().to_string()).collect()
}

fn errors(text: &str) -> Vec<String> {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, text);
    script.analyze(&catalog, true).unwrap();
    script.analyzed.as_ref().unwrap().errors.iter().map(|e| format!("{e:?}")).collect()
}

#[test]
fn alter_table_changes_the_declaration_of_the_script() {
    assert_eq!(declared("create table t (a int); alter table t add column b int", None), [".t(a, b)"]);
    assert_eq!(declared("create table t (a int, b int); alter table t drop column a", None), [".t(b)"]);
    assert_eq!(declared("create table t (a int); alter table t rename column a to b", None), [".t(b)"]);
    // A column that is there stays, as with `if not exists`
    assert_eq!(declared("create table t (a int); alter table t add column if not exists a text", None), [".t(a)"]);
}

#[test]
fn alter_table_that_moves_a_table_declares_the_new_name() {
    assert_eq!(declared("create table s.t (a int); alter table s.t rename to u", None), ["s.t(a)", "s.u(a)"]);
    assert_eq!(declared("create table s.t (a int); alter table s.t set schema o", None), ["s.t(a)", "o.t(a)"]);
    assert_eq!(declared("create table s.t (a int); alter table s.t rename to u, add column b int", None), ["s.t(a)", "s.u(a, b)"]);
}

#[test]
fn later_statements_read_the_altered_table() {
    assert!(unresolved("create table t (a int); alter table t add column b int; select b from t", None).is_empty());
    assert_eq!(unresolved("create table t (a int); alter table t drop column a; select a from t", None), ["a"]);
    assert!(unresolved("create table t (a int); alter table t rename column a to b; select b from t", None).is_empty());
    assert!(unresolved("create table t (a int); alter table t rename to u; select a from u", None).is_empty());
}

#[test]
fn alter_table_of_a_table_of_the_catalog_waits_for_the_connection() {
    let catalog = "create table db.s.t (a int, c int)";
    assert!(declared("alter table db.s.t add column b int", Some(catalog)).is_empty());
    assert!(declared("alter table t rename to u", Some(catalog)).is_empty());
    // A read before and after the statement reads what the connection reports until it answers
    assert_eq!(unresolved("select a from t; alter table t rename column a to b; select b from t", Some(catalog)), ["b"]);
    assert!(declared("alter table unknown add column b int", Some(catalog)).is_empty());
}

#[test]
fn alter_table_reads_the_names_of_the_script_as_a_reference_does() {
    assert!(unresolved("create table s.t (a int); alter table t add column b int; select b from t", None).is_empty());
    assert_eq!(declared("create table s.t (a int); alter table t add column b int", None), ["s.t(a, b)"]);
    assert_eq!(declared("create table t (a int); alter table o.t add column b int", None), [".t(a)"]);
    assert_eq!(declared("create table t (a int); alter table db.s.t add column b int", None), [".t(a)"]);
    assert!(errors("create table t (a int); alter table t alter column a type bigint using a::bigint").is_empty());
}

#[test]
fn alter_table_that_moves_a_table_keeps_what_the_new_name_leaves_out() {
    assert_eq!(declared("create table db.s.t (a int); alter table db.s.t rename to o.u", None), ["s.t(a)", "o.u(a)"]);
    assert_eq!(declared("create table db.s.t (a int); alter table db.s.t rename to u", None), ["s.t(a)", "s.u(a)"]);
    assert_eq!(declared("create table db.s.t (a int); alter table db.s.t set schema o", None), ["s.t(a)", "o.t(a)"]);
    assert!(unresolved("create table db.s.t (a int); alter table db.s.t rename to o.u; select a from db.o.u", None).is_empty());
}

#[test]
fn a_script_reads_the_last_declaration_of_a_name() {
    let text = "create table t (a int); alter table t rename to o; create table t (a int, b int); alter table t add column c int";
    assert!(unresolved(&format!("{text}; select b, c from t"), None).is_empty());
    // Another script sees one table
    let mut catalog = Catalog::new();
    let mut declaring = Script::new(&catalog);
    declaring.insert_text_at(0, text);
    declaring.analyze(&catalog, true).unwrap();
    catalog.load_script(declaring.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    let mut reading = Script::new(&catalog);
    reading.insert_text_at(0, "select b, c from t");
    reading.analyze(&catalog, true).unwrap();
    assert!(reading.analyzed.as_ref().unwrap().errors.is_empty());
}

#[test]
fn alter_table_of_another_script_does_not_make_its_table_ambiguous() {
    let mut catalog = Catalog::new();
    let mut creating = Script::new(&catalog);
    creating.insert_text_at(0, "create table t (a int)");
    creating.analyze(&catalog, true).unwrap();
    catalog.load_script(creating.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    let mut altering = Script::new(&catalog);
    altering.insert_text_at(0, "alter table t add column b int");
    altering.analyze(&catalog, true).unwrap();
    assert!(altering.analyzed.as_ref().unwrap().entry.table_declarations.is_empty());
    catalog.load_script(altering.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    let mut reading = Script::new(&catalog);
    reading.insert_text_at(0, "select a from t");
    reading.analyze(&catalog, true).unwrap();
    assert!(reading.analyzed.as_ref().unwrap().errors.is_empty());
}

#[test]
fn alter_table_applies_to_a_table_of_create_table_as() {
    assert_eq!(declared("create table t as select 1 as a; alter table t add column b int", None), [".t(a, b)"]);
    assert_eq!(declared("create table t as select 1 as a, 2 as c; alter table t drop column a", None), [".t(c)"]);
    // What waits for the columns moves along
    assert_eq!(declared("create table t as select 1 a, 2 b; alter table t drop column a; alter table t rename to u", None), [".t(b)", ".u(b)"]);
    assert_eq!(declared("create table t as select 1 a, 2 b; alter table t rename to u; alter table u drop column a", None), [".t(a, b)", ".u(b)"]);
}
