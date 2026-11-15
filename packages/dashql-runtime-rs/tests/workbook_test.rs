//! Tests of the scripts of a workbook, ported from `workbook_scripts.test.ts` of the TypeScript runtime as far as the
//! actions are ported.

use std::cell::RefCell;
use std::rc::Rc;

use dashql_buffers::editor::{EditorEventT, EditorOffsetUnit, EditorSelectionT, EditorTextChangeT};
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::catalog::Catalog;
use dashql_runtime::workbook::{
    ConnectionCopy, ScriptConnection, ScriptKey, ScriptList, ScriptListEntry, Workbook, WorkbookAction, WorkbookEffect,
};

/// A connection with a catalog of its own
fn connection(id: &str, params: Option<&str>) -> Rc<ScriptConnection> {
    Rc::new(ScriptConnection {
        connection_id: id.to_string(),
        catalog: Rc::new(RefCell::new(Catalog::new())),
        dialect: FormattingDialect::HYPER,
        local: false,
        params: params.map(str::to_string),
    })
}

/// A workbook with scripts on one connection, in feed order
fn workbook(scripts: &[(&str, &str)]) -> (Workbook, Rc<ScriptConnection>) {
    let main = connection("main", Some(r#"{"hyper":{}}"#));
    let mut workbook = Workbook::new("workbook", Some("Test".into()), Some(main.clone()), EditorOffsetUnit::UTF16_CODE_UNITS);
    for (file_name, text) in scripts {
        workbook.add_stored_script(file_name, text, main.clone(), None).unwrap();
    }
    (workbook, main)
}

fn key(workbook: &Workbook, file_name: &str) -> ScriptKey {
    workbook.script_by_file(file_name).unwrap().key()
}

fn files(workbook: &Workbook) -> Vec<&str> {
    workbook.scripts().iter().map(|script| script.file_name()).collect()
}

fn create(workbook: &mut Workbook, index: Option<usize>, text: Option<&str>, base: &str) -> Vec<WorkbookEffect> {
    let action = WorkbookAction::CreateScript { index, text: text.map(str::to_string), base: base.into(), connection: None };
    workbook.apply(action).unwrap().effects
}

/// An editor event that replaces the text and analyzes it, like typing in CodeMirror
fn typed(workbook: &Workbook, key: ScriptKey, text: &str) -> EditorEventT {
    let script = workbook.script(key).unwrap();
    let mut change = EditorTextChangeT::default();
    change.from = 0;
    change.to = script.text().encode_utf16().count() as u64;
    change.insert = Some(text.to_string());
    let mut event = EditorEventT::default();
    event.expected_text_version = script.session().text_version();
    event.changes = Some(vec![change]);
    event.analyze = true;
    event
}

/// An editor event that moves the cursor
fn cursor(workbook: &Workbook, key: ScriptKey, offset: u64) -> EditorEventT {
    let mut selection = EditorSelectionT::default();
    selection.anchor = offset;
    selection.head = offset;
    let mut event = EditorEventT::default();
    event.expected_text_version = workbook.script(key).unwrap().session().text_version();
    event.primary_selection = Some(Box::new(selection));
    event
}

#[test]
fn appends_a_script_with_text_analyzes_it_and_writes_it() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: alpha }).unwrap();
    assert!(!workbook.script(alpha).unwrap().analysis_outdated());

    let effects = create(&mut workbook, None, Some("create table t (x int)"), "gamma");
    assert_eq!(files(&workbook), ["alpha.sql", "beta.sql", "gamma.sql"]);
    let created = workbook.script_by_file("gamma.sql").unwrap();
    assert_eq!(created.text(), "create table t (x int)");
    assert!(!created.analysis_outdated());
    assert!(created.editor_update().is_some_and(|update| update.analysis_available));
    // The new script published its table, the other scripts of the catalog are outdated
    assert!(workbook.script(alpha).unwrap().analysis_outdated());
    assert_eq!(effects[0], WorkbookEffect::WriteScript { file_name: "gamma.sql".into(), text: "create table t (x int)".into() });
    assert!(matches!(&effects[1], WorkbookEffect::WriteScriptList(list) if list.scripts.len() == 3));
}

#[test]
fn inserts_at_a_feed_index_with_a_unique_name() {
    let (mut workbook, _) = workbook(&[("alpha.sql", ""), ("beta.sql", "")]);
    let effects = create(&mut workbook, Some(1), None, "alpha");
    assert_eq!(files(&workbook), ["alpha.sql", "alpha-2.sql", "beta.sql"]);
    assert_eq!(effects[0], WorkbookEffect::WriteScript { file_name: "alpha-2.sql".into(), text: String::new() });
}

#[test]
fn creates_the_first_script_on_the_pending_connection() {
    let (mut workbook, main) = workbook(&[]);
    assert_eq!(workbook.script_list().connections, [ConnectionCopy { connection_id: "main".into(), params: r#"{"hyper":{}}"#.into() }]);
    create(&mut workbook, None, Some("select 1"), "first");
    assert_eq!(files(&workbook), ["first.sql"]);
    assert!(Rc::ptr_eq(workbook.scripts()[0].connection(), &main));
    // The script took the pending connection
    assert!(workbook.pending_connection().is_none());
}

#[test]
fn deletes_the_last_script_and_keeps_its_connection_for_the_next_one() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "create table t (x int)")]);
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: key(&workbook, "alpha.sql") }).unwrap();
    create(&mut workbook, None, None, "beta");
    assert!(workbook.pending_connection().is_none());
    let outcome = workbook.apply(WorkbookAction::DeleteScript { file_name: "alpha.sql".into() }).unwrap();
    assert!(outcome.changed);
    assert_eq!(outcome.effects[0], WorkbookEffect::DeleteScript { file_name: "alpha.sql".into() });
    // The table of the deleted script is gone from the catalog, the remaining script resolves again
    assert!(workbook.script_by_file("beta.sql").unwrap().analysis_outdated());
    workbook.apply(WorkbookAction::DeleteScript { file_name: "beta.sql".into() }).unwrap();
    assert!(workbook.scripts().is_empty());
    assert!(workbook.pending_connection().is_some_and(|pending| Rc::ptr_eq(pending, &main)));
    // An unknown script changes nothing
    assert!(!workbook.apply(WorkbookAction::DeleteScript { file_name: "missing.sql".into() }).unwrap().changed);
}

#[test]
fn renames_in_place_with_a_unique_name() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let beta = key(&workbook, "beta.sql");
    let outcome = workbook.apply(WorkbookAction::RenameScript { file_name: "beta.sql".into(), new_name: "Alpha.SQL".into() }).unwrap();
    assert_eq!(files(&workbook), ["alpha.sql", "Alpha-2.sql"]);
    assert_eq!(key(&workbook, "Alpha-2.sql"), beta);
    assert_eq!(outcome.effects[0], WorkbookEffect::RenameScript { from: "beta.sql".into(), to: "Alpha-2.sql".into() });
    // The same name writes the unchanged text, a name that is no file name is ignored
    let same = workbook.apply(WorkbookAction::RenameScript { file_name: "alpha.sql".into(), new_name: "alpha".into() }).unwrap();
    assert!(!same.changed);
    assert_eq!(same.effects, [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 1".into() }]);
    let invalid = workbook.apply(WorkbookAction::RenameScript { file_name: "alpha.sql".into(), new_name: "a/b".into() }).unwrap();
    assert!(!invalid.changed && invalid.effects.is_empty());
}

#[test]
fn reorders_through_the_script_list() {
    let (mut workbook, _) = workbook(&[("alpha.sql", ""), ("beta.sql", ""), ("gamma.sql", "")]);
    let outcome = workbook.apply(WorkbookAction::ReorderScripts { order: vec!["gamma.sql".into(), "alpha.sql".into()] }).unwrap();
    assert_eq!(files(&workbook), ["gamma.sql", "alpha.sql", "beta.sql"]);
    let entry = |name: &str| ScriptListEntry { name: name.into(), connection_id: "main".into() };
    assert_eq!(outcome.effects, [WorkbookEffect::WriteScriptList(ScriptList {
        scripts: vec![entry("gamma.sql"), entry("alpha.sql"), entry("beta.sql")],
        connections: vec![ConnectionCopy { connection_id: "main".into(), params: r#"{"hyper":{}}"#.into() }],
    })]);
    // The same order changes nothing
    let same = workbook.apply(WorkbookAction::ReorderScripts { order: vec!["gamma.sql".into(), "gamma.sql".into()] }).unwrap();
    assert!(!same.changed && same.effects.is_empty());
}

#[test]
fn writes_typed_text_but_not_a_moved_cursor() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    let event = typed(&workbook, alpha, "select 42");
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event }).unwrap();
    assert!(outcome.changed);
    assert!(outcome.editor_update.is_some_and(|update| update.analysis_available));
    assert_eq!(outcome.effects, [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 42".into() }]);

    let revision = workbook.script(alpha).unwrap().revision();
    let event = cursor(&workbook, alpha, 3);
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event }).unwrap();
    assert!(outcome.effects.is_empty());
    // The cursor is part of the projection that the editor shows
    assert!(workbook.script(alpha).unwrap().revision() > revision);
}

/// Analyze the outdated scripts until none is outdated, like the app does on demand. A script that publishes its own
/// declarations changes its catalog, so a current script may analyze once more. Returns the number of analyses.
fn settle(workbook: &mut Workbook) -> usize {
    let mut analyses = 0;
    for _ in 0..4 {
        let keys: Vec<ScriptKey> = workbook.scripts().iter().filter(|s| s.is_analysis_outdated()).map(|s| s.key()).collect();
        if keys.is_empty() {
            return analyses;
        }
        for key in keys {
            workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key }).unwrap();
            analyses += 1;
        }
    }
    panic!("the analyses of the workbook don't settle");
}

#[test]
fn analyzes_the_readers_of_changed_declarations_again() {
    let (mut workbook, _) = workbook(&[("tables.sql", "create table t (x int)"), ("query.sql", "select x from t")]);
    let (tables, query) = (key(&workbook, "tables.sql"), key(&workbook, "query.sql"));
    settle(&mut workbook);
    assert!(!workbook.script(query).unwrap().is_analysis_outdated());
    // Settled scripts analyze no more
    assert_eq!(settle(&mut workbook), 0);

    // Typing a new table publishes it, the query must resolve again
    let event = typed(&workbook, tables, "create table t (x int, y int)");
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: tables, event }).unwrap();
    assert!(workbook.script(query).unwrap().is_analysis_outdated());
    assert!(workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: query }).unwrap().changed);
    settle(&mut workbook);
    // A current script isn't analyzed again
    assert!(!workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: query }).unwrap().changed);
}

#[test]
fn sets_the_text_of_a_script() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let (alpha, beta) = (key(&workbook, "alpha.sql"), key(&workbook, "beta.sql"));
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: beta }).unwrap();
    let outcome = workbook.apply(WorkbookAction::SetScriptText { key: alpha, text: "select 3".into() }).unwrap();
    assert_eq!(workbook.script(alpha).unwrap().text(), "select 3");
    assert!(!workbook.script(alpha).unwrap().analysis_outdated());
    assert!(workbook.script(beta).unwrap().analysis_outdated());
    assert_eq!(outcome.effects, [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 3".into() }]);
}

#[test]
fn marks_the_scripts_of_an_updated_catalog_outdated() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: alpha }).unwrap();
    let other = workbook.apply(WorkbookAction::CatalogDidUpdate { connection_id: "other".into() }).unwrap();
    assert!(!other.changed);
    assert!(workbook.apply(WorkbookAction::CatalogDidUpdate { connection_id: "main".into() }).unwrap().changed);
    assert!(workbook.script(alpha).unwrap().analysis_outdated());
}

#[test]
fn keeps_the_result_of_the_newest_query() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::RegisterQuery { key: alpha, query_id: 7 }).unwrap();
    workbook.apply(WorkbookAction::RegisterScriptResult { key: alpha, query_id: 7 }).unwrap();
    workbook.apply(WorkbookAction::RegisterQuery { key: alpha, query_id: 8 }).unwrap();
    // An older overlapping query doesn't replace the newer result
    assert!(!workbook.apply(WorkbookAction::RegisterScriptResult { key: alpha, query_id: 5 }).unwrap().changed);
    let script = workbook.script(alpha).unwrap();
    assert_eq!((script.latest_query_id(), script.latest_result_query_id()), (Some(8), Some(7)));
}

#[test]
fn renames_the_workbook() {
    let (mut workbook, _) = workbook(&[]);
    let outcome = workbook.apply(WorkbookAction::RenameWorkbook { name: Some("  Sales ".into()) }).unwrap();
    assert_eq!(workbook.name(), Some("Sales"));
    assert_eq!(outcome.effects, [WorkbookEffect::WriteProperties { name: Some("Sales".into()), ephemeral: false }]);
    assert!(!workbook.apply(WorkbookAction::RenameWorkbook { name: Some("Sales".into()) }).unwrap().changed);
    workbook.apply(WorkbookAction::RenameWorkbook { name: Some(" ".into()) }).unwrap();
    assert_eq!(workbook.name(), None);
}
