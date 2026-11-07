//! The table parameters of a session: `:foo` reads the output columns of `foo.sql` or the columns of the attachment
//! `foo.parquet`, the analyzer resolves columns through them and completion offers their names.

use dashql_core::analyzer::{AnalyzedScript, ColumnResolution};
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_core::table_parameters::{TableParameterAttachment, TableParameterSource, TableParameters, TABLE_PARAMETERS_ENTRY_ID};
use std::sync::Arc;

/// Analyze scripts and derive their table parameters
fn session(catalog: &Catalog, scripts: &[(&str, &str)]) -> Arc<TableParameters> {
    session_with(catalog, scripts, &[])
}

/// Analyze scripts and derive their table parameters with attachments
fn session_with(catalog: &Catalog, scripts: &[(&str, &str)], attachments: &[TableParameterAttachment]) -> Arc<TableParameters> {
    let analyzed: Vec<Script> = scripts
        .iter()
        .map(|(_, text)| {
            let mut script = Script::new(catalog);
            script.insert_text_at(0, text);
            script.analyze(catalog, true).unwrap();
            script
        })
        .collect();
    let inputs: Vec<(&str, Option<&AnalyzedScript>)> =
        scripts.iter().zip(&analyzed).map(|((name, _), s)| (*name, s.analyzed.as_deref())).collect();
    Arc::new(TableParameters::derive(&inputs, attachments, None))
}

/// Analyze a script with the results of a session
fn consumer(catalog: &Catalog, results: &Arc<TableParameters>, text: &str) -> Script {
    let mut script = Script::new(catalog);
    script.table_parameters = Some(results.clone());
    script.insert_text_at(0, text);
    script.analyze(catalog, true).unwrap();
    script
}

/// The column refs of a script in text order, `name -> script.column` or `name -> ?`
fn resolve(script: &Script, results: &TableParameters) -> Vec<String> {
    let analyzed = script.analyzed.as_ref().unwrap();
    let mut expressions: Vec<_> = analyzed.expressions.iter().filter_map(|e| Some((e, e.column_ref()?))).collect();
    expressions.sort_by_key(|(e, _)| analyzed.parsed.nodes[e.ast_node_id as usize].symbol_span().offset());
    expressions
        .into_iter()
        .map(|(_, column_ref)| {
            let name = column_ref.column_name.column_name.text();
            let target = match column_ref.resolved {
                ColumnResolution::TableColumn(loc) if loc.table.entry == TABLE_PARAMETERS_ENTRY_ID => {
                    let table = results.table(loc.table).unwrap();
                    format!("{}.{}", table.table_name.table_name.text(), table.table_columns[loc.column as usize].column_name.text())
                }
                ColumnResolution::Unresolved => "?".into(),
                _ => "other".into(),
            };
            format!("{name} -> {target}")
        })
        .collect()
}

fn complete(script: &mut Script, catalog: &Catalog, offset: usize) -> Vec<String> {
    let cursor = script.move_cursor(catalog, offset);
    let completion = Script::complete_at_cursor(&cursor, 10).unwrap();
    completion.top_candidates.iter().map(|c| c.completion_text.to_string()).collect()
}

#[test]
fn results_are_the_output_columns_of_single_selects() {
    let catalog = Catalog::new();
    let results = session(&catalog, &[("foo", "select 1 as a, 2 as b"), ("cmds", "create table t (x int); select 1"), ("bar", "select * from :foo")]);
    let columns = |i: usize| results.entries[i].table.as_ref().map(|t| t.table_columns.iter().map(|c| c.column_name.text().to_string()).collect::<Vec<_>>());
    assert_eq!(columns(0), Some(vec!["a".to_string(), "b".to_string()]));
    assert_eq!(columns(1), None);
}

#[test]
fn results_of_calls_are_the_columns_of_their_functions() {
    let mut catalog = Catalog::new();
    catalog
        .register_client_functions(
            r#"{ "format": 1, "namespace": "t", "functions": [
                { "name": "list", "method": "GET", "columns": [{ "name": "id" }, { "name": "label" }] },
                { "name": "remove", "method": "DELETE", "columns": [{ "name": "id" }] }
            ] }"#,
        )
        .unwrap();
    let results = session(
        &catalog,
        &[("listed", "call t.list ()"), ("removed", "call t.remove ()"), ("explained", "explain call t.list ()"), ("two", "call t.list (); call t.list ()")],
    );
    let columns = |i: usize| results.entries[i].table.as_ref().map(|t| t.table_columns.iter().map(|c| c.column_name.text().to_string()).collect::<Vec<_>>().join(","));
    assert_eq!(columns(0).as_deref(), Some("id,label,_status,_next,_meta,_raw"));
    // Only a single call that reads has a result that other scripts read
    assert_eq!(columns(1), None);
    assert_eq!(columns(2), None);
    assert_eq!(columns(3), None);
    let script = consumer(&catalog, &results, "select l.label, _next from :listed l");
    assert_eq!(resolve(&script, &results), ["label -> listed.label", "_next -> listed._next"]);
}

#[test]
fn table_parameters_resolve_columns_of_results() {
    let catalog = Catalog::new();
    let results = session(&catalog, &[("foo", "select 1 as a, 2 as b")]);
    let script = consumer(&catalog, &results, "select f.a, b, f.c from :foo f");
    assert_eq!(resolve(&script, &results), ["a -> foo.a", "b -> foo.b", "c -> ?"]);
    let script = consumer(&catalog, &results, "select foo.b from :foo");
    assert_eq!(resolve(&script, &results), ["b -> foo.b"]);
    // Case-folded names find the script, unknown ones resolve nothing
    let script = consumer(&catalog, &results, "select a from :FOO");
    assert_eq!(resolve(&script, &results), ["a -> foo.a"]);
    let script = consumer(&catalog, &results, "select a from :nope");
    assert_eq!(resolve(&script, &results), ["a -> ?"]);
}

#[test]
fn results_flow_through_chains_and_stars() {
    let catalog = Catalog::new();
    let first = session(&catalog, &[("foo", "select 1 as a"), ("bar", "select 1")]);
    let bar = consumer(&catalog, &first, "select *, 2 as z from :foo");
    let inputs = [("foo", None), ("bar", bar.analyzed.as_deref())];
    let results = Arc::new(TableParameters::derive(&inputs, &[], Some(&first)));
    let columns: Vec<String> = results.entries[1].table.as_ref().unwrap().table_columns.iter().map(|c| c.column_name.text().to_string()).collect();
    assert_eq!(columns, ["a", "z"]);
    // The script without an analysis kept its columns
    assert!(results.entries[0].table.is_some());
}

#[test]
fn cycles_have_no_results() {
    let catalog = Catalog::new();
    let results = session(&catalog, &[("a", "select * from :b"), ("b", "select * from :a"), ("c", "select 1 as x")]);
    assert!(results.entries[0].table.is_none());
    assert!(results.entries[1].table.is_none());
    assert!(results.entries[2].table.is_some());
}

#[test]
fn the_result_yields_its_name_to_other_from_items() {
    let mut catalog = Catalog::new();
    let mut schema = Script::new(&catalog);
    schema.insert_text_at(0, "create table foo (x int)");
    schema.analyze(&catalog, true).unwrap();
    catalog.load_script(schema.analyzed.clone().unwrap(), dashql_core::catalog::CatalogLayer::SESSION).unwrap();
    let results = session(&catalog, &[("foo", "select 1 as a")]);
    let script = consumer(&catalog, &results, "select foo.x, a from :foo, foo");
    assert!(script.analyzed.as_ref().unwrap().errors.is_empty(), "{:?}", script.analyzed.as_ref().unwrap().errors);
    assert_eq!(resolve(&script, &results), ["x -> other", "a -> foo.a"]);
}

#[test]
fn completion_offers_scripts_after_the_colon_of_a_table() {
    let catalog = Catalog::new();
    let results = session(&catalog, &[("foo", "select 1 as a"), ("food", "select 1 as a"), ("bar", "select 1 as a"), ("cmds", "create table t (x int)")]);
    let text = "select * from :";
    let mut script = consumer(&catalog, &results, text);
    let mut names = complete(&mut script, &catalog, text.len());
    names.sort();
    assert_eq!(names, ["bar", "foo", "food"]);
    let text = "select * from :fo";
    let mut script = consumer(&catalog, &results, text);
    let mut names = complete(&mut script, &catalog, text.len());
    names.sort();
    assert_eq!(names, ["foo", "food"]);
    // A scalar parameter is no script
    let text = "select 1 where 1 = :fo";
    let mut script = consumer(&catalog, &results, text);
    assert!(!complete(&mut script, &catalog, text.len()).iter().any(|n| n == "foo"));
}

#[test]
fn completion_of_columns_through_a_result() {
    let catalog = Catalog::new();
    let results = session(&catalog, &[("foo", "select 1 as amount, 2 as region")]);
    let text = "select f.re from :foo f";
    let mut script = consumer(&catalog, &results, text);
    let names = complete(&mut script, &catalog, "select f.re".len());
    assert_eq!(names.first().map(String::as_str), Some("region"));
}

#[test]
fn attachments_follow_the_scripts() {
    let catalog = Catalog::new();
    let columns: Vec<Arc<str>> = vec!["region".into(), "amount".into()];
    let attachments = [TableParameterAttachment { name: "sales", columns: Some(&columns) }, TableParameterAttachment { name: "raw", columns: None }];
    let results = session_with(&catalog, &[("foo", "select 1 as a")], &attachments);
    let sources: Vec<_> = results.entries.iter().map(|e| (e.name.to_string(), e.source, e.table.is_some())).collect();
    assert_eq!(
        sources,
        [
            ("foo".to_string(), TableParameterSource::Script(0), true),
            ("sales".to_string(), TableParameterSource::Attachment(0), true),
            ("raw".to_string(), TableParameterSource::Attachment(1), false),
        ]
    );
}

#[test]
fn table_parameters_resolve_columns_of_attachments() {
    let catalog = Catalog::new();
    let columns: Vec<Arc<str>> = vec!["region".into(), "amount".into()];
    let attachments = [TableParameterAttachment { name: "sales", columns: Some(&columns) }, TableParameterAttachment { name: "raw", columns: None }];
    let results = session_with(&catalog, &[("foo", "select 1 as a")], &attachments);
    let script = consumer(&catalog, &results, "select s.region, amount, s.nope from :sales s");
    assert_eq!(resolve(&script, &results), ["region -> sales.region", "amount -> sales.amount", "nope -> ?"]);
    let script = consumer(&catalog, &results, "select region from :SALES");
    assert_eq!(resolve(&script, &results), ["region -> sales.region"]);
    // An attachment whose columns are unknown resolves nothing
    let script = consumer(&catalog, &results, "select x from :raw");
    assert_eq!(resolve(&script, &results), ["x -> ?"]);
}

#[test]
fn a_script_and_an_attachment_with_one_name_are_ambiguous() {
    let catalog = Catalog::new();
    let columns: Vec<Arc<str>> = vec!["region".into()];
    let attachments = [TableParameterAttachment { name: "sales", columns: Some(&columns) }];
    let results = session_with(&catalog, &[("sales", "select 1 as a")], &attachments);
    let script = consumer(&catalog, &results, "select a, region from :sales");
    assert_eq!(resolve(&script, &results), ["a -> ?", "region -> ?"]);
}

#[test]
fn completion_offers_attachments_after_the_colon_of_a_table() {
    let catalog = Catalog::new();
    let columns: Vec<Arc<str>> = vec!["region".into()];
    let attachments = [TableParameterAttachment { name: "sales", columns: Some(&columns) }, TableParameterAttachment { name: "salt", columns: None }];
    let results = session_with(&catalog, &[("sample", "select 1 as a")], &attachments);
    let text = "select * from :sa";
    let mut script = consumer(&catalog, &results, text);
    let mut names = complete(&mut script, &catalog, text.len());
    names.sort();
    assert_eq!(names, ["sales", "sample"]);
    let text = "select s.re from :sales s";
    let mut script = consumer(&catalog, &results, text);
    let names = complete(&mut script, &catalog, "select s.re".len());
    assert_eq!(names.first().map(String::as_str), Some("region"));
}

#[test]
fn table_parameters_compare_names_sources_and_columns() {
    let catalog = Catalog::new();
    let columns: [Arc<str>; 1] = [Arc::from("x")];
    let attachment = [TableParameterAttachment { name: "file", columns: Some(&columns) }];
    let base = session_with(&catalog, &[("foo", "select 1 as a")], &attachment);
    // Another analysis of the same scripts is the same, also with other values
    assert!(base.same_as(&session_with(&catalog, &[("foo", "select 2 as a")], &attachment)));
    // Other columns, names, sources or counts differ
    assert!(!base.same_as(&session_with(&catalog, &[("foo", "select 1 as b")], &attachment)));
    assert!(!base.same_as(&session_with(&catalog, &[("bar", "select 1 as a")], &attachment)));
    assert!(!base.same_as(&session_with(&catalog, &[("foo", "select 1 as a")], &[])));
    let other_columns: [Arc<str>; 1] = [Arc::from("y")];
    assert!(!base.same_as(&session_with(&catalog, &[("foo", "select 1 as a")], &[TableParameterAttachment { name: "file", columns: Some(&other_columns) }])));
    assert!(!base.same_as(&session_with(&catalog, &[("foo", "select 1 as a")], &[TableParameterAttachment { name: "file", columns: None }])));
    let swapped = session_with(&catalog, &[], &[TableParameterAttachment { name: "foo", columns: Some(&columns) }, attachment[0]]);
    assert!(!base.same_as(&swapped));
}

#[test]
fn table_parameters_know_their_sources() {
    use dashql_core::catalog::TableLoc;
    let catalog = Catalog::new();
    let attachment = [TableParameterAttachment { name: "file", columns: None }];
    let results = session_with(&catalog, &[("foo", "select 1 as a"), ("bar", "select 2 as b")], &attachment);
    let loc = |index| TableLoc { entry: TABLE_PARAMETERS_ENTRY_ID, index };
    assert_eq!(results.source(loc(0)), Some(TableParameterSource::Script(0)));
    assert_eq!(results.source(loc(1)), Some(TableParameterSource::Script(1)));
    assert_eq!(results.source(loc(2)), Some(TableParameterSource::Attachment(0)));
    assert_eq!(results.source(loc(3)), None);
    // Tables of other entries are no table parameters
    assert_eq!(results.source(TableLoc { entry: TABLE_PARAMETERS_ENTRY_ID + 1, index: 0 }), None);
    assert!(results.table(TableLoc { entry: TABLE_PARAMETERS_ENTRY_ID + 1, index: 0 }).is_none());
}
