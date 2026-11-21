//! Name resolution through the FROM sources of the name scopes: derived tables, column aliases,
//! correlation, qualified stars, merged join columns and output column names.

use dashql_buffers::analyzer::AnalyzerErrorType;
use dashql_core::analyzer::{AnalyzedScript, ColumnResolution};
use dashql_core::catalog::Catalog;
use dashql_core::catalog::CatalogLayer;
use dashql_core::script::Script;
use std::sync::Arc;

/// The fixture: a catalog with the tables t, u, v and w, and the tables k of the schemas s1 and s2
struct NameResolutionTest {
    /// The catalog with the schema tables
    catalog: Catalog,
    /// The schema scripts, kept alive while their tables are in the catalog
    schemas: Vec<Script>,
}

impl NameResolutionTest {
    fn new() -> Self {
        let mut test = Self { catalog: Catalog::new(), schemas: Vec::new() };
        test.publish(concat!(
            "create table t (a int, b int); create table u (a int, c int); create table v (id int, x int); ",
            "create table w (id int, y int); create table s1.k (a int, b int); create table s2.k (c int); ",
            "create table db1.s3.n (e int);",
        ));
        test
    }

    /// Publish the tables of a script to the catalog
    fn publish(&mut self, sql: &str) {
        let mut schema = Script::new(&self.catalog);
        schema.insert_text_at(0, sql);
        schema.analyze(&self.catalog, true).unwrap();
        self.catalog.load_script(schema.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
        self.schemas.push(schema);
    }

    /// The columns of a published table
    fn published_columns(&self, table_name: &str) -> Vec<String> {
        let analyzed = self.schemas.iter().filter_map(|s| s.analyzed.as_ref());
        let mut tables = analyzed.flat_map(|a| a.entry.table_declarations.iter());
        let table = tables.find(|t| t.table_name.table_name.text() == table_name).expect("published table");
        table.table_columns.iter().map(|c| c.column_name.text().to_string()).collect()
    }

    fn analyze(&self, sql: &str) -> Arc<AnalyzedScript> {
        let mut script = Script::new(&self.catalog);
        script.insert_text_at(0, sql);
        script.analyze(&self.catalog, true).unwrap();
        assert!(script.parsed.as_ref().unwrap().errors.is_empty(), "{sql}");
        script.analyzed.clone().unwrap()
    }

    /// Describe the column refs of a script in text order. A ref is written as it is spelled,
    /// followed by the catalog column it resolves to, `local` for a column computed in the script,
    /// or `?` if unresolved.
    fn resolve(&self, sql: &str) -> Vec<String> {
        let analyzed = self.analyze(sql);
        let mut expressions: Vec<_> = analyzed.expressions.iter().collect();
        expressions.sort_by_key(|e| analyzed.parsed.nodes[e.ast_node_id as usize].symbol_span().offset());
        expressions
            .into_iter()
            .filter_map(|e| e.column_ref())
            .map(|column_ref| {
                let name = &column_ref.column_name;
                let spelled = match &name.table_alias {
                    Some(alias) => format!("{}.{}", alias.text(), name.column_name.text()),
                    None => name.column_name.text().to_string(),
                };
                let target = match (column_ref.resolved, &column_ref.resolved_ids) {
                    (ColumnResolution::Unresolved, _) => "?".to_string(),
                    (_, None) => "local".to_string(),
                    (_, Some(ids)) => {
                        let (table_id, column) = ids.catalog_table_column_id.unpack_table_column_id();
                        let table = self
                            .catalog
                            .table_by_id(table_id)
                            .or_else(|| analyzed.entry.table_by_id(table_id))
                            .expect("table");
                        let column = table.column_by_id(column).expect("column");
                        let schema = table.table_name.schema_name.text();
                        let schema = if schema.is_empty() { String::new() } else { format!("{schema}.") };
                        format!("{schema}{}.{}", table.table_name.table_name.text(), column.column_name.text())
                    }
                };
                format!("{spelled} -> {target}")
            })
            .collect()
    }
}

#[test]
fn derived_table_columns_are_visible_through_the_alias() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("select s.a, s.z, z from (select a, b as z from t) s"),
        ["s.a -> t.a", "s.z -> t.b", "z -> t.b", "a -> t.a", "b -> t.b"]
    );
}

#[test]
fn unaliased_derived_table_columns_are_visible() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select z from (select b as z from t)"), ["z -> t.b", "b -> t.b"]);
}

#[test]
fn derived_table_column_aliases_rename_by_position() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("select s.p, s.b, s.a from (select a, b from t) s(p)"),
        ["s.p -> t.a", "s.b -> t.b", "s.a -> ?", "a -> t.a", "b -> t.b"]
    );
}

#[test]
fn table_column_aliases_rename_by_position() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select x.p, x.b, x.a from t as x(p)"), ["x.p -> t.a", "x.b -> t.b", "x.a -> ?"]);
}

#[test]
fn table_refs_resolve_to_ctes_by_unqualified_names() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("with t as (select 1 as k) select * from t, public.t");
    let relations: Vec<_> = analyzed.table_references.iter().filter_map(|r| r.inner.as_ref()).collect();
    let [cte, qualified] = relations.as_slice() else { panic!("two table refs expected") };
    // The CTE has no catalog table, the reference names the CTE instead
    assert!(cte.resolved_cte.is_some());
    assert!(cte.resolved_table.is_none());
    // A qualified name never reads a CTE
    assert!(qualified.resolved_cte.is_none());
}

#[test]
fn values_columns_are_named_by_the_column_aliases() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select r.k, r.l from (values (1, 2)) r(k, l)"), ["r.k -> local", "r.l -> local"]);
}

#[test]
fn expression_subquery_outputs_are_not_visible() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select c from t where a in (select c from u)"), ["c -> ?", "a -> t.a", "c -> u.c"]);
}

#[test]
fn expression_subquery_outputs_do_not_shadow_schema_inference() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("select q from missing where id in (select q from missing2)");
    let schema = analyzed.inferred_table_schemas.iter().find(|s| s.table_name.table_name.text() == "missing").unwrap();
    let columns: Vec<_> = schema.columns.iter().map(|c| c.column_name.text()).collect();
    assert_eq!(columns, ["q", "id"]);
}

#[test]
fn expression_subqueries_correlate_with_the_parent() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("select a from t where exists (select 1 from u where u.c = t.b)"),
        ["a -> t.a", "u.c -> u.c", "t.b -> t.b"]
    );
}

#[test]
fn derived_tables_do_not_correlate_with_their_siblings() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select * from t, (select t.a as k) s"), ["t.a -> ?"]);
    assert_eq!(test.resolve("select * from t, lateral (select t.a as k) s"), ["t.a -> t.a"]);
    // A lateral derived table only sees the FROM items before it
    assert_eq!(test.resolve("select * from lateral (select t.a as k) s, t"), ["t.a -> ?"]);
}

#[test]
fn derived_tables_correlate_with_outer_queries() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select (select s.k from (select t.a as k) s) from t"), ["s.k -> t.a", "t.a -> t.a"]);
}

#[test]
fn ctes_do_not_correlate_with_the_from_clause() {
    let test = NameResolutionTest::new();
    // c.k is the column of the CTE, which has no catalog column
    assert_eq!(test.resolve("with c as (select t.b as k) select c.k from t, c"), ["t.b -> ?", "c.k -> local"]);
}

#[test]
fn qualified_star_forwards_the_columns_of_one_source() {
    let test = NameResolutionTest::new();
    let resolved = test.resolve("select q.c, q.a from (select s.* from t, (select c from u) s) q");
    // The qualifier of s.* is no column ref
    assert_eq!(resolved, ["q.c -> u.c", "q.a -> ?", "c -> u.c"]);
}

#[test]
fn qualified_star_is_no_column_of_an_unresolved_table() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("select m.* from missing m");
    assert!(analyzed.inferred_table_schemas.is_empty());
}

#[test]
fn star_forwards_sources_in_from_order() {
    let test = NameResolutionTest::new();
    // Both t and the derived table provide a, the first one in FROM order wins
    assert_eq!(
        test.resolve("select q.a, q.c from (select * from (select c, a from u) s, t) q"),
        ["q.a -> u.a", "q.c -> u.c", "c -> u.c", "a -> u.a"]
    );
}

#[test]
fn using_columns_are_not_ambiguous() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("select id, x, y from v join w using (id)");
    assert!(analyzed.errors.is_empty(), "{:?}", analyzed.errors);
    assert_eq!(test.resolve("select id, x, y from v join w using (id)"), ["id -> v.id", "x -> v.x", "y -> w.y"]);
    assert_eq!(test.resolve("select id from v natural join w"), ["id -> v.id"]);
}

#[test]
fn columns_outside_of_using_stay_ambiguous() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("select id from v, w");
    assert_eq!(analyzed.errors.len(), 1);
    assert_eq!(analyzed.errors[0].error_type, AnalyzerErrorType::COLUMN_REF_AMBIGUOUS);
    let analyzed = test.analyze("select a from t join u using (b)");
    assert_eq!(analyzed.errors.len(), 1);
    assert_eq!(analyzed.errors[0].error_type, AnalyzerErrorType::COLUMN_REF_AMBIGUOUS);
}

#[test]
fn order_by_prefers_output_columns() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select a + 1 as n from t order by n"), ["a -> t.a", "n -> local"]);
    assert_eq!(test.resolve("select b as a from t order by a"), ["b -> t.b", "a -> t.b"]);
    // Only bare names refer to output columns
    assert_eq!(test.resolve("select b as n from t order by n + 1"), ["b -> t.b", "n -> ?"]);
}

#[test]
fn group_by_prefers_input_columns() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select b as a from t group by a"), ["b -> t.b", "a -> t.a"]);
    assert_eq!(test.resolve("select b as n from t group by n"), ["b -> t.b", "n -> t.b"]);
}

#[test]
fn set_operations_order_by_the_left_output_columns() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select a from t union select c from u order by a"), ["a -> t.a", "c -> u.c", "a -> t.a"]);
}

#[test]
fn computed_columns_keep_their_position() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("with c(p, q) as (select case when a > 0 then 1 end, b from t) select c.q from c"),
        ["a -> t.a", "b -> t.b", "c.q -> t.b"]
    );
}

#[test]
fn qualified_table_names_do_not_name_ctes() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("with k as (select 1 as z) select z, a from s1.k"), ["z -> ?", "a -> s1.k.a"]);
    assert_eq!(test.resolve("with k as (select 1 as z) select z from k"), ["z -> local"]);
}

#[test]
fn unaliased_tables_of_different_schemas_share_their_name() {
    let test = NameResolutionTest::new();
    let analyzed = test.analyze("select a, c from s1.k, s2.k");
    assert!(analyzed.errors.is_empty(), "{:?}", analyzed.errors);
    assert_eq!(test.resolve("select a, c from s1.k, s2.k"), ["a -> s1.k.a", "c -> s2.k.c"]);
    // The name qualifies the columns of both tables
    assert_eq!(test.resolve("select k.a, k.c from s1.k, s2.k"), ["k.a -> s1.k.a", "k.c -> s2.k.c"]);
    // The same table and the same alias stay duplicates
    for sql in ["select 1 from t, t", "select 1 from s1.k x, s2.k x"] {
        let analyzed = test.analyze(sql);
        assert_eq!(analyzed.errors.len(), 1, "{sql}");
        assert_eq!(analyzed.errors[0].error_type, AnalyzerErrorType::DUPLICATE_TABLE_ALIAS, "{sql}");
    }
}

#[test]
fn column_refs_qualify_tables_with_their_schema() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("select s1.k.a, s2.k.c from s1.k, s2.k"), ["k.a -> s1.k.a", "k.c -> s2.k.c"]);
    assert_eq!(test.resolve("select db1.s3.n.e from db1.s3.n"), ["n.e -> s3.n.e"]);
    // The schema of a table qualifies columns in subqueries
    assert_eq!(test.resolve("select 1 from s1.k where exists (select s1.k.b)"), ["k.b -> s1.k.b"]);
    // An alias hides the name of the table
    assert_eq!(test.resolve("select s1.k.a from s1.k x"), ["s1.k -> ?"]);
}

#[test]
fn qualified_column_refs_stop_at_the_scope_of_their_qualifier() {
    let test = NameResolutionTest::new();
    // The inner t has no column b, the outer t is hidden
    assert_eq!(test.resolve("select * from t where exists (select 1 from u t where t.b = 1)"), ["t.b -> ?"]);
    // The column belongs to the inner unresolved table
    let sql = "select * from t where exists (select 1 from unknown_tbl t where t.b = 1)";
    assert_eq!(test.resolve(sql), ["t.b -> ?"]);
    let analyzed = test.analyze(sql);
    let schema = analyzed.inferred_table_schemas.iter().find(|s| s.table_name.table_name.text() == "unknown_tbl");
    let columns: Vec<_> = schema.expect("inferred").columns.iter().map(|c| c.column_name.text()).collect();
    assert_eq!(columns, ["b"]);
}

#[test]
fn create_table_keeps_the_column_order() {
    let test = NameResolutionTest::new();
    let sql = "create table q (b int, a int); select p from q as x(p)";
    assert_eq!(test.resolve(sql), ["p -> q.b"]);
    let analyzed = test.analyze(sql);
    let columns: Vec<_> =
        analyzed.entry.table_declarations[0].table_columns.iter().map(|c| c.column_name.text()).collect();
    assert_eq!(columns, ["b", "a"]);
}

#[test]
fn star_has_the_join_columns_of_using_once() {
    let test = NameResolutionTest::new();
    for join in ["v join w using (id)", "v natural join w"] {
        assert_eq!(
            test.resolve(&format!("select p, q, r from (select * from {join}) s(p, q, r)")),
            ["p -> v.id", "q -> v.x", "r -> w.y"],
            "{join}"
        );
    }
    let mut test = NameResolutionTest::new();
    test.publish("create table m2 as select * from (select x, id from v) vv join w using (id)");
    assert_eq!(test.published_columns("m2"), ["id", "x", "y"]);
}

#[test]
fn create_table_as_keeps_unnamed_columns() {
    let mut test = NameResolutionTest::new();
    test.publish("create table m as select a, count(*), b + 1, b from t");
    assert_eq!(test.published_columns("m"), ["a", "count", "?column?", "b"]);
    assert_eq!(test.resolve("select z from m as mm(w, x, y, z)"), ["z -> m.b"]);
    // The declared names rename the leading columns
    test.publish("create table m3(p) as select a, b from t");
    assert_eq!(test.published_columns("m3"), ["p", "b"]);
}

#[test]
fn later_statements_read_the_columns_of_views() {
    let test = NameResolutionTest::new();
    assert_eq!(test.resolve("create view vv as select a from t; select a from vv"), ["a -> t.a", "a -> vv.a"]);
    assert_eq!(test.resolve("create table tt as select b from t; select b from tt"), ["b -> t.b", "b -> tt.b"]);
}

#[test]
fn statements_read_the_declaration_before_them() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("create table z (a int); select a from z; alter table z rename column a to b; select b from z"),
        ["a -> z.a", "b -> z.b"]
    );
    assert_eq!(
        test.resolve("create table r (a int); select a from r; drop table r; create table r (b int); select b from r"),
        ["a -> r.a", "b -> r.b"]
    );
}

#[test]
fn column_aliases_of_a_from_item_rename_the_columns_of_a_cte() {
    let test = NameResolutionTest::new();
    assert_eq!(
        test.resolve("with c(x, y) as (select a, b from t) select y, b from c as cc(p)"),
        ["a -> t.a", "b -> t.b", "y -> t.b", "b -> ?"]
    );
}

#[test]
fn create_table_as_has_no_columns_of_its_subqueries() {
    let mut test = NameResolutionTest::new();
    test.publish("create table x2 as select * from unknown_tbl where a in (select b from t)");
    assert!(test.published_columns("x2").is_empty());
    // A parenthesized SELECT has the columns of the SELECT within
    test.publish("create table x3 as (select a from t)");
    assert_eq!(test.published_columns("x3"), ["a"]);
}
