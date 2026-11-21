//! Tests of the scripts of a workbook and their actions.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use dashql_buffers::editor::{EditorEventOrigin, EditorEventT, EditorOffsetUnit, EditorSelectionT, EditorTextChangeT};
use dashql_buffers::formatting::FormattingDialect;
use dashql_core_runtime::attachments::{renamed_attachment_file_name, DataFile, WorkbookAttachment};
use dashql_core_runtime::workbook::{
    new_catalog, text_change, ConnectionCopy, EditorUpdateId, ExternalChanges, ScriptConnection,
    ScriptConnectionProfile, ScriptKey, ScriptList, ScriptListEntry, ScriptPlacement, ScriptStoredResult, StoredScript,
    TextChange, Workbook, WorkbookAction, WorkbookEffect, WorkbookOrigin,
};
use serde_json::Value;

/// Connection params of their JSON text
fn json_params(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

/// What the scripts read of a connection of a test
fn profile(params: Option<&str>) -> ScriptConnectionProfile {
    ScriptConnectionProfile {
        dialect: FormattingDialect::HYPER,
        local: false,
        params: params.map(json_params),
        default_database: String::new(),
        default_schema: String::new(),
    }
}

/// A connection with a catalog of its own. The catalogs of the runtime share their entry ids, a script that moves to
/// another catalog keeps its key.
fn connection(id: &str, params: Option<&str>) -> Rc<ScriptConnection> {
    Rc::new(ScriptConnection::new(id, Rc::new(RefCell::new(new_catalog())), profile(params)))
}

/// The connection that the scripts of a test workbook run on
const MAIN_PARAMS: &str = r#"{"hyper":{}}"#;

/// A workbook with scripts on one connection, in feed order
fn workbook(scripts: &[(&str, &str)]) -> (Workbook, Rc<ScriptConnection>) {
    let main = connection("main", Some(MAIN_PARAMS));
    let mut workbook =
        Workbook::new("workbook", Some("Test".into()), Some(main.clone()), EditorOffsetUnit::UTF16_CODE_UNITS);
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
    let place = index.map_or(ScriptPlacement::End, ScriptPlacement::At);
    let action =
        WorkbookAction::CreateScript { place, text: text.map(str::to_string), base: base.into(), connection: None };
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
    event.expected_text_version = script.session().borrow().text_version();
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
    event.expected_text_version = workbook.script(key).unwrap().session().borrow().text_version();
    event.primary_selection = Some(Box::new(selection));
    event
}

#[test]
fn appends_a_script_with_text_analyzes_it_and_writes_it() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: alpha }).unwrap();
    assert!(!workbook.script(alpha).unwrap().is_analysis_outdated());

    let effects = create(&mut workbook, None, Some("create table t (x int)"), "gamma");
    assert_eq!(files(&workbook), ["alpha.sql", "beta.sql", "gamma.sql"]);
    let created = workbook.script_by_file("gamma.sql").unwrap();
    assert_eq!(created.text(), "create table t (x int)");
    assert!(!created.is_analysis_outdated());
    assert!(created.editor_update().is_some_and(|update| update.analysis_available));
    // The new script published its table, the other scripts of the catalog are outdated
    assert!(workbook.script(alpha).unwrap().is_analysis_outdated());
    assert_eq!(
        effects[0],
        WorkbookEffect::WriteScript { file_name: "gamma.sql".into(), text: "create table t (x int)".into() }
    );
    assert!(matches!(&effects[1], WorkbookEffect::WriteScriptList(list) if list.scripts.len() == 3));
}

#[test]
fn inserts_at_a_feed_index_with_a_unique_name() {
    let (mut workbook, _) = workbook(&[("alpha.sql", ""), ("beta.sql", "")]);
    let action = WorkbookAction::CreateScript {
        place: ScriptPlacement::At(1),
        text: None,
        base: "alpha".into(),
        connection: None,
    };
    let outcome = workbook.apply(action).unwrap();
    assert_eq!(files(&workbook), ["alpha.sql", "alpha-2.sql", "beta.sql"]);
    // The outcome names the created script
    assert_eq!(outcome.created, Some(key(&workbook, "alpha-2.sql")));
    assert_eq!(
        outcome.effects[0],
        WorkbookEffect::WriteScript { file_name: "alpha-2.sql".into(), text: String::new() }
    );
}

#[test]
fn places_a_script_by_its_references() {
    let (mut workbook, _) = workbook(&[
        ("orders.sql", "select 1 as id"),
        ("report.sql", "select * from :helper"),
        ("other.sql", "select 2"),
    ]);
    let by_references = |workbook: &mut Workbook, text: &str, base: &str| {
        let action = WorkbookAction::CreateScript {
            place: ScriptPlacement::ByReferences,
            text: Some(text.into()),
            base: base.into(),
            connection: None,
        };
        workbook.apply(action).unwrap().effects
    };
    // Before the first script that reads it
    by_references(&mut workbook, "select * from :orders", "helper");
    assert_eq!(files(&workbook), ["orders.sql", "helper.sql", "report.sql", "other.sql"]);
    // After the last script that it reads, when no script reads it
    let effects = by_references(&mut workbook, "select * from :orders join :report using (id)", "chart");
    assert_eq!(files(&workbook), ["orders.sql", "helper.sql", "report.sql", "chart.sql", "other.sql"]);
    // The workbook file lists the place
    let list = effects.iter().find_map(|effect| match effect {
        WorkbookEffect::WriteScriptList(list) => {
            Some(list.scripts.iter().map(|entry| entry.name.clone()).collect::<Vec<_>>())
        }
        _ => None,
    });
    assert_eq!(list.unwrap(), ["orders.sql", "helper.sql", "report.sql", "chart.sql", "other.sql"]);
    // At the end without references
    by_references(&mut workbook, "select 3", "plain");
    assert_eq!(files(&workbook).last(), Some(&"plain.sql"));
}

#[test]
fn creates_the_first_script_on_the_pending_connection() {
    let (mut workbook, main) = workbook(&[]);
    assert_eq!(
        workbook.script_list().connections,
        [ConnectionCopy { connection_id: "main".into(), params: json_params(r#"{"hyper":{}}"#) }]
    );
    create(&mut workbook, None, Some("select 1"), "first");
    assert_eq!(files(&workbook), ["first.sql"]);
    assert!(Rc::ptr_eq(workbook.scripts()[0].connection(), &main));
    // The script took the pending connection
    assert!(workbook.pending_connection().is_none());
}

#[test]
fn uses_the_connections_of_its_scripts_and_then_its_pending_connection() {
    let (mut workbook, _) = workbook(&[]);
    // A workbook without scripts uses its pending connection
    assert_eq!(workbook.connection_ids(), ["main"]);
    create(&mut workbook, None, Some("select 1"), "first");
    create(&mut workbook, None, Some("select 2"), "second");
    // The scripts took the pending connection, it is named once
    assert_eq!(workbook.connection_ids(), ["main"]);
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
    assert!(workbook.script_by_file("beta.sql").unwrap().is_analysis_outdated());
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
    let outcome = workbook
        .apply(WorkbookAction::RenameScript { file_name: "beta.sql".into(), new_name: "Alpha.SQL".into() })
        .unwrap();
    assert_eq!(files(&workbook), ["alpha.sql", "Alpha-2.sql"]);
    assert_eq!(key(&workbook, "Alpha-2.sql"), beta);
    assert_eq!(outcome.effects[0], WorkbookEffect::RenameScript { from: "beta.sql".into(), to: "Alpha-2.sql".into() });
    // The same name writes the unchanged text, a name that is no file name is ignored
    let same = workbook
        .apply(WorkbookAction::RenameScript { file_name: "alpha.sql".into(), new_name: "alpha".into() })
        .unwrap();
    assert!(!same.changed);
    assert_eq!(same.effects, [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 1".into() }]);
    let invalid =
        workbook.apply(WorkbookAction::RenameScript { file_name: "alpha.sql".into(), new_name: "a/b".into() }).unwrap();
    assert!(!invalid.changed && invalid.effects.is_empty());
}

#[test]
fn reorders_through_the_script_list() {
    let (mut workbook, _) = workbook(&[("alpha.sql", ""), ("beta.sql", ""), ("gamma.sql", "")]);
    let outcome = workbook
        .apply(WorkbookAction::ReorderScripts {
            order: vec!["gamma.sql".into(), "alpha.sql".into(), "beta.sql".into()],
        })
        .unwrap();
    assert_eq!(files(&workbook), ["gamma.sql", "alpha.sql", "beta.sql"]);
    let entry = |name: &str| ScriptListEntry { name: name.into(), connection_id: "main".into() };
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScriptList(ScriptList {
            scripts: vec![entry("gamma.sql"), entry("alpha.sql"), entry("beta.sql")],
            connections: vec![ConnectionCopy { connection_id: "main".into(), params: json_params(r#"{"hyper":{}}"#) }],
        })]
    );
    // The same order changes nothing
    let same =
        workbook.apply(WorkbookAction::ReorderScripts { order: vec!["gamma.sql".into(), "gamma.sql".into()] }).unwrap();
    assert!(!same.changed && same.effects.is_empty());
    // The scripts that an order leaves out keep their places, the named ones swap theirs
    workbook.apply(WorkbookAction::ReorderScripts { order: vec!["beta.sql".into(), "gamma.sql".into()] }).unwrap();
    assert_eq!(files(&workbook), ["beta.sql", "alpha.sql", "gamma.sql"]);
    let unknown = workbook
        .apply(WorkbookAction::ReorderScripts { order: vec!["missing.sql".into(), "beta.sql".into()] })
        .unwrap();
    assert!(!unknown.changed);
}

#[test]
fn writes_typed_text_but_not_a_moved_cursor() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    let event = typed(&workbook, alpha, "select 42");
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    assert!(outcome.changed);
    // The update is the one that the script holds now
    assert!(outcome.editor_update.is_none());
    assert!(workbook.script(alpha).unwrap().editor_update().is_some_and(|update| update.analysis_available));
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 42".into() }]
    );

    let revision = workbook.script(alpha).unwrap().revision();
    let event = cursor(&workbook, alpha, 3);
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    assert!(outcome.effects.is_empty());
    // The cursor is part of the projection that the editor shows
    assert!(workbook.script(alpha).unwrap().revision() > revision);
}

/// Analyze the outdated scripts until none is outdated, like the app does on demand. A script that publishes its own
/// declarations changes its catalog, so a current script may analyze once more. Returns the number of analyses.
fn settle(workbook: &mut Workbook) -> usize {
    let mut analyses = 0;
    for _ in 0..4 {
        let keys: Vec<ScriptKey> =
            workbook.scripts().iter().filter(|s| s.is_analysis_outdated()).map(|s| s.key()).collect();
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
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: tables, event, known: None }).unwrap();
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
    let outcome = workbook
        .apply(WorkbookAction::SetScriptText { key: alpha, text: "select 3".into(), with_diff: false })
        .unwrap();
    assert_eq!(workbook.script(alpha).unwrap().text(), "select 3");
    assert!(!workbook.script(alpha).unwrap().is_analysis_outdated());
    assert!(workbook.script(beta).unwrap().is_analysis_outdated());
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select 3".into() }]
    );
}

fn set_text(workbook: &mut Workbook, key: ScriptKey, text: &str, with_diff: bool) {
    workbook.apply(WorkbookAction::SetScriptText { key, text: text.into(), with_diff }).unwrap();
}

fn text(workbook: &Workbook, key: ScriptKey) -> String {
    workbook.script(key).unwrap().text()
}

/// The Vega-Lite spec of the visualization of a script, compact JSON
fn vegalite_spec(workbook: &Workbook, key: ScriptKey) -> Option<String> {
    let visualization = &workbook.script(key)?.visualization()?.visualization;
    (visualization.renderer.as_deref() == Some("vegalite")).then(|| visualization.vegalite_spec.clone()).flatten()
}

fn prior_text(workbook: &Workbook, key: ScriptKey) -> Option<String> {
    workbook.script(key).unwrap().pending_diff().map(|diff| diff.prior_text.clone())
}

#[test]
fn restages_a_rewrite_of_a_script_with_a_staged_diff_against_the_text_before_it() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "")]);
    let alpha = key(&workbook, "alpha.sql");
    let original = "/* @board width=4 height=2 */\nselect 2 as x";
    set_text(&mut workbook, alpha, original, false);

    let table = "/* @vis table\n   @board width=4 height=2 */\nselect 2 as x";
    set_text(&mut workbook, alpha, table, true);
    assert_eq!(prior_text(&workbook, alpha).as_deref(), Some(original));
    assert!(workbook.script(alpha).unwrap().pending_diff().is_some_and(|diff| diff.diff.ops.is_some()));

    // A second rewrite joins the staged diff, rejecting it reverts both
    let moved = "/* @vis table\n   @board width=6 height=2 */\nselect 2 as x";
    set_text(&mut workbook, alpha, moved, true);
    assert_eq!(text(&workbook, alpha), moved);
    assert_eq!(prior_text(&workbook, alpha).as_deref(), Some(original));
    let outcome = workbook.apply(WorkbookAction::RejectPendingDiff { key: alpha }).unwrap();
    assert_eq!(text(&workbook, alpha), original);
    assert_eq!(prior_text(&workbook, alpha), None);
    assert_eq!(outcome.effects, [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: original.into() }]);

    // A rewrite back to the text before the staged diff drops it
    set_text(&mut workbook, alpha, table, true);
    set_text(&mut workbook, alpha, original, true);
    assert_eq!(text(&workbook, alpha), original);
    assert_eq!(prior_text(&workbook, alpha), None);
}

#[test]
fn stages_no_rewrite_of_a_blank_script() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "  \n"), ("beta.sql", "select 1")]);
    let (alpha, beta) = (key(&workbook, "alpha.sql"), key(&workbook, "beta.sql"));
    set_text(&mut workbook, alpha, "select 2", true);
    assert_eq!(text(&workbook, alpha), "select 2");
    assert_eq!(prior_text(&workbook, alpha), None);
    set_text(&mut workbook, beta, "select 3", true);
    assert_eq!(prior_text(&workbook, beta).as_deref(), Some("select 1"));
}

#[test]
fn keeps_the_rewritten_text_when_a_staged_diff_is_accepted() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 2 as x, 3 as y")]);
    let alpha = key(&workbook, "alpha.sql");
    assert!(!workbook.apply(WorkbookAction::AcceptPendingDiff { key: alpha }).unwrap().changed);
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"bar"}"#.into() }).unwrap();
    let rewritten = text(&workbook, alpha);
    assert!(rewritten.contains("@vis vegalite"));
    let outcome = workbook.apply(WorkbookAction::AcceptPendingDiff { key: alpha }).unwrap();
    assert!(outcome.changed && outcome.effects.is_empty());
    assert_eq!(prior_text(&workbook, alpha), None);
    assert_eq!(text(&workbook, alpha), rewritten);
}

#[test]
fn stages_the_chart_spec_for_the_vis_tag_of_the_last_statement() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "")]);
    let alpha = key(&workbook, "alpha.sql");
    let original = "create table t (a int);\nselect 2 as x, 3 as y";
    set_text(&mut workbook, alpha, original, false);

    // A query without tags gets a new comment in front of the last statement
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"bar"}"#.into() }).unwrap();
    assert!(text(&workbook, alpha).starts_with("create table t (a int);\n/**\n * @vis vegalite\n"));
    // The compiled spec reads the result of the query
    let spec = vegalite_spec(&workbook, alpha).unwrap();
    assert!(spec.contains(r#""mark": "bar""#) && spec.contains(r#""$sql""#), "{spec}");
    // The rewrite waits for the user like a formatting, rejecting it restores the script
    assert_eq!(prior_text(&workbook, alpha).as_deref(), Some(original));
    workbook.apply(WorkbookAction::RejectPendingDiff { key: alpha }).unwrap();
    assert_eq!(text(&workbook, alpha), original);

    // A card tag survives a rewrite of the renderer
    let card = "/* @vis vegalite {\"mark\":\"bar\"}\n   @board width=4 height=2 */\nselect 2 as x, 3 as y";
    set_text(&mut workbook, alpha, card, false);
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"line"}"#.into() }).unwrap();
    assert!(text(&workbook, alpha).contains("@board width=4 height=2"));
    assert!(!text(&workbook, alpha).contains("\"bar\""));

    // Every edit restages the diff against the text before the first edit
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"point"}"#.into() }).unwrap();
    let edited = text(&workbook, alpha);
    assert!(edited.contains("point"));
    assert!(vegalite_spec(&workbook, alpha).is_some_and(|spec| spec.contains("point")));
    assert!(workbook
        .script(alpha)
        .unwrap()
        .visualization()
        .is_some_and(|vis| vis.sql.contains("2 AS x") || vis.sql.contains("2 as x")));
    assert_eq!(prior_text(&workbook, alpha).as_deref(), Some(card));

    // An unchanged spec leaves the workbook alone
    let revision = workbook.revision();
    let same =
        workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"point"}"#.into() }).unwrap();
    assert!(!same.changed);
    assert_eq!((workbook.revision(), text(&workbook, alpha)), (revision, edited));

    // Rejecting the diff restores the text before the first edit
    workbook.apply(WorkbookAction::RejectPendingDiff { key: alpha }).unwrap();
    assert_eq!(text(&workbook, alpha), card);
}

#[test]
fn writes_the_value_of_an_input_into_the_scripts_that_use_it() {
    let (mut workbook, _) = workbook(&[("a.sql", ""), ("b.sql", ""), ("c.sql", "select 3")]);
    let (a, b, c) = (key(&workbook, "a.sql"), key(&workbook, "b.sql"), key(&workbook, "c.sql"));
    set_text(&mut workbook, a, "/* @param :min = 1 */\nselect :min::int", false);
    set_text(&mut workbook, b, "select :min", false);
    let c_revision = workbook.script(c).unwrap().revision();
    let input =
        |keys: Vec<ScriptKey>| WorkbookAction::SetWorkbookInput { name: "min".into(), literal: "20".into(), keys };
    let outcome = workbook.apply(input(vec![a, b])).unwrap();
    assert_eq!(text(&workbook, a), "/** @param :min = 20 */\nselect :min::int");
    assert_eq!(text(&workbook, b), "/** @param :min = 20 */\nselect :min");
    assert_eq!(
        workbook.script(b).unwrap().external_changes(),
        Some(&ExternalChanges {
            from_text: "select :min".into(),
            changes: vec![TextChange { from: 0, to: 0, insert: "/** @param :min = 20 */\n".into() }],
        })
    );
    assert!(outcome
        .effects
        .contains(&WorkbookEffect::WriteScript { file_name: "b.sql".into(), text: text(&workbook, b) }));
    // A script that doesn't use the input stays, the same value changes nothing
    assert_eq!(workbook.script(c).unwrap().revision(), c_revision);
    let same = workbook.apply(input(vec![a, b])).unwrap();
    assert!(!same.changed && same.effects.is_empty());
}

#[test]
fn describes_a_text_change_by_its_common_prefix_and_suffix() {
    let utf16 = EditorOffsetUnit::UTF16_CODE_UNITS;
    let change = |from: u64, to: u64, insert: &str| TextChange { from, to, insert: insert.into() };
    assert_eq!(text_change("select 1", "select 21", utf16), change(7, 7, "2"));
    assert_eq!(text_change("aaa", "aa", utf16), change(2, 3, ""));
    assert_eq!(text_change("", "x", utf16), change(0, 0, "x"));
    // Offsets count in the unit of the editors
    assert_eq!(text_change("€ 1", "€ 2", utf16), change(2, 3, "2"));
    assert_eq!(text_change("€ 1", "€ 2", EditorOffsetUnit::UTF8_BYTES), change(4, 5, "2"));
    assert_eq!(text_change("aé", "aè", utf16), change(1, 2, "è"));
    // A character of two UTF-16 code units stays whole, also if the two share the first one
    assert_eq!(text_change("a😀b", "a😁b", utf16), change(1, 3, "😁"));
    assert_eq!(text_change("😀", "", utf16), change(0, 2, ""));
}

#[test]
fn accepts_a_staged_rewrite_when_the_user_types() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 2 as x")]);
    let alpha = key(&workbook, "alpha.sql");
    set_text(&mut workbook, alpha, "select 2 as x, 3 as y", true);
    assert!(prior_text(&workbook, alpha).is_some());
    // A moved cursor keeps it, a typed character accepts it
    let event = cursor(&workbook, alpha, 2);
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    assert!(prior_text(&workbook, alpha).is_some());
    let mut event = typed(&workbook, alpha, "select 2 as x, 4 as y");
    event.origin = EditorEventOrigin::USER;
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    assert!(prior_text(&workbook, alpha).is_none());
}

#[test]
fn marks_the_scripts_of_an_updated_catalog_outdated() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: alpha }).unwrap();
    let other = workbook.apply(WorkbookAction::CatalogDidUpdate { connection_id: "other".into() }).unwrap();
    assert!(!other.changed);
    assert!(workbook.apply(WorkbookAction::CatalogDidUpdate { connection_id: "main".into() }).unwrap().changed);
    assert!(workbook.script(alpha).unwrap().is_analysis_outdated());
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
fn keeps_the_stored_result_that_the_host_looked_up() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    assert_eq!(workbook.script(alpha).unwrap().stored_result(), None);
    let stored =
        ScriptStoredResult { name: "alpha.sql.k.0.parquet".into(), key: "k".into(), written_at: 1000.0, current: true };
    let set = |stored: Option<ScriptStoredResult>| WorkbookAction::SetStoredResult { key: alpha, stored };
    let revision = workbook.script(alpha).unwrap().revision();
    let outcome = workbook.apply(set(Some(stored.clone()))).unwrap();
    // The stored result is no content of the workbook file, nothing is written
    assert!(outcome.changed && outcome.effects.is_empty());
    assert_eq!(workbook.script(alpha).unwrap().stored_result(), Some(&stored));
    assert_ne!(workbook.script(alpha).unwrap().revision(), revision);
    assert!(!workbook.apply(set(Some(stored))).unwrap().changed);
    assert!(workbook.apply(set(None)).unwrap().changed);
    assert_eq!(workbook.script(alpha).unwrap().stored_result(), None);
}

#[test]
fn renames_the_workbook() {
    let (mut workbook, _) = workbook(&[]);
    let outcome = workbook.apply(WorkbookAction::RenameWorkbook { name: Some("  Sales ".into()) }).unwrap();
    assert_eq!(workbook.name(), Some("Sales"));
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteProperties { name: Some("Sales".into()), ephemeral: false, origin: None }]
    );
    assert!(!workbook.apply(WorkbookAction::RenameWorkbook { name: Some("Sales".into()) }).unwrap().changed);
    workbook.apply(WorkbookAction::RenameWorkbook { name: Some(" ".into()) }).unwrap();
    assert_eq!(workbook.name(), None);
}

#[test]
fn moves_a_script_to_another_connection_under_its_key() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let beta = key(&workbook, "beta.sql");
    workbook.apply(WorkbookAction::RegisterQuery { key: beta, query_id: 7 }).unwrap();
    workbook.apply(WorkbookAction::RegisterScriptResult { key: beta, query_id: 7 }).unwrap();
    let trino = connection("trino", Some(r#"{"trino":{}}"#));
    let set = |connection: &Rc<ScriptConnection>| WorkbookAction::SetScriptConnection {
        file_name: "beta.sql".into(),
        connection: connection.clone(),
    };
    let outcome = workbook.apply(set(&trino)).unwrap();
    let moved = workbook.script(beta).unwrap();
    assert!(Rc::ptr_eq(moved.connection(), &trino));
    assert_eq!(moved.text(), "select 2");
    assert_eq!((moved.latest_query_id(), moved.latest_result_query_id()), (Some(7), Some(7)));
    assert!(!moved.is_analysis_outdated());
    let entry =
        |name: &str, connection_id: &str| ScriptListEntry { name: name.into(), connection_id: connection_id.into() };
    let copy = |connection_id: &str, params: &str| ConnectionCopy {
        connection_id: connection_id.into(),
        params: json_params(params),
    };
    // The workbook file takes a copy of the new connection
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScriptList(ScriptList {
            scripts: vec![entry("alpha.sql", "main"), entry("beta.sql", "trino")],
            connections: vec![copy("main", MAIN_PARAMS), copy("trino", r#"{"trino":{}}"#)],
        })]
    );
    // The same connection changes nothing, a script moves back under its key
    assert!(!workbook.apply(set(&trino)).unwrap().changed);
    workbook.apply(set(&main)).unwrap();
    assert!(Rc::ptr_eq(workbook.script(beta).unwrap().connection(), &main));
}

#[test]
fn creates_the_next_script_on_the_connection_that_the_user_picks() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "")]);
    let trino = connection("trino", Some(r#"{"trino":{}}"#));
    let outcome = workbook.apply(WorkbookAction::SetPendingConnection { connection: trino.clone() }).unwrap();
    // A workbook with scripts doesn't store the pick
    assert!(outcome.changed && outcome.effects.is_empty());
    assert!(Rc::ptr_eq(workbook.scripts()[0].connection(), &main));
    create(&mut workbook, None, None, "beta");
    assert!(Rc::ptr_eq(workbook.script_by_file("beta.sql").unwrap().connection(), &trino));
    // The script took the pick
    assert!(workbook.pending_connection().is_none());
    // A connection without params can't be copied into the workbook file
    assert!(
        !workbook.apply(WorkbookAction::SetPendingConnection { connection: connection("bare", None) }).unwrap().changed
    );
}

#[test]
fn keeps_the_connection_of_a_workbook_without_scripts_in_its_workbook_file() {
    let (mut workbook, _) = workbook(&[]);
    let server = connection("server", Some(r#"{"hyper":{"protocol":"V3_HTTP"}}"#));
    let outcome = workbook.apply(WorkbookAction::SetPendingConnection { connection: server.clone() }).unwrap();
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScriptList(ScriptList {
            scripts: vec![],
            connections: vec![ConnectionCopy {
                connection_id: "server".into(),
                params: json_params(r#"{"hyper":{"protocol":"V3_HTTP"}}"#)
            }],
        })]
    );
    // The first script runs on it, deleting the last script keeps its connection for the next one
    create(&mut workbook, None, None, "first");
    assert!(workbook.pending_connection().is_none());
    workbook.apply(WorkbookAction::DeleteScript { file_name: "first.sql".into() }).unwrap();
    assert!(workbook.pending_connection().is_some_and(|pending| Rc::ptr_eq(pending, &server)));
}

#[test]
fn detaches_a_connection_that_only_the_next_script_would_use() {
    let embedded = connection("embedded", Some(r#"{"hyper":{"protocol":"WASM"}}"#));
    let server = connection("server", Some(r#"{"hyper":{"protocol":"V3_HTTP"}}"#));
    let detach = || WorkbookAction::DetachConnection { from: "server".into(), into: embedded.clone() };
    // A workbook without scripts holds the embedded database then
    let mut empty = Workbook::new("empty", None, Some(server.clone()), EditorOffsetUnit::UTF16_CODE_UNITS);
    empty.apply(detach()).unwrap();
    assert!(empty.pending_connection().is_some_and(|pending| Rc::ptr_eq(pending, &embedded)));
    // A workbook with scripts lets go of the pick, another connection changes nothing
    let (mut picked, _) = workbook(&[("alpha.sql", "")]);
    picked.apply(WorkbookAction::SetPendingConnection { connection: server.clone() }).unwrap();
    picked.apply(detach()).unwrap();
    assert!(picked.pending_connection().is_none());
    assert!(!picked.apply(detach()).unwrap().changed);
    // A connection stays while scripts use it
    picked.apply(WorkbookAction::SetPendingConnection { connection: server.clone() }).unwrap();
    picked
        .apply(WorkbookAction::SetScriptConnection { file_name: "alpha.sql".into(), connection: server.clone() })
        .unwrap();
    assert!(!picked.apply(detach()).unwrap().changed);
}

#[test]
fn moves_the_scripts_and_the_pending_connection_of_a_merged_connection() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let kept = connection("kept", None);
    workbook
        .apply(WorkbookAction::SetScriptConnection { file_name: "beta.sql".into(), connection: kept.clone() })
        .unwrap();
    let (alpha, beta) = (key(&workbook, "alpha.sql"), key(&workbook, "beta.sql"));
    let pending = Rc::new(ScriptConnection::new("main", main.catalog.clone(), profile(Some(MAIN_PARAMS))));
    workbook.apply(WorkbookAction::SetPendingConnection { connection: connection("other", Some("{}")) }).unwrap();
    workbook.apply(WorkbookAction::SetPendingConnection { connection: pending }).unwrap();
    let target = connection("target", Some(r#"{"hyper":{"protocol":"WASM"}}"#));
    let outcome =
        workbook.apply(WorkbookAction::ReplaceConnection { from: "main".into(), into: target.clone() }).unwrap();
    // The pending connection and the scripts move to the target, scripts on other connections stay
    assert!(workbook.pending_connection().is_some_and(|pending| Rc::ptr_eq(pending, &target)));
    let moved = workbook.script(alpha).unwrap();
    assert!(Rc::ptr_eq(moved.connection(), &target));
    assert_eq!(moved.text(), "select 1");
    assert!(moved.is_analysis_outdated());
    assert!(Rc::ptr_eq(workbook.script(beta).unwrap().connection(), &kept));
    // The workbook file replaces the merged connection
    assert_eq!(
        outcome.effects[0],
        WorkbookEffect::PatchConnection {
            connection_id: "target".into(),
            params: Some(json_params(r#"{"hyper":{"protocol":"WASM"}}"#)),
            replaces: vec!["main".into()],
        }
    );
    assert!(matches!(&outcome.effects[1], WorkbookEffect::WriteScriptList(list)
        if list.scripts.iter().map(|s| s.connection_id.as_str()).collect::<Vec<_>>() == ["target", "kept"]));
    // A connection that the workbook doesn't use changes nothing
    assert!(
        !workbook.apply(WorkbookAction::ReplaceConnection { from: "unknown".into(), into: target }).unwrap().changed
    );
}

fn data_file(name: &str) -> DataFile {
    DataFile { name: name.into(), size_bytes: 1, mtime_ms: 1 }
}

#[test]
fn renames_a_script_past_the_names_of_the_attachments() {
    let (mut workbook, _) = workbook(&[("alpha.sql", ""), ("beta.sql", "")]);
    workbook
        .apply(WorkbookAction::SetWorkbookAttachments {
            files: vec![data_file("Sales.parquet"), data_file("notes.txt")],
        })
        .unwrap();
    workbook.apply(WorkbookAction::RenameScript { file_name: "alpha.sql".into(), new_name: "sales".into() }).unwrap();
    assert_eq!(files(&workbook), ["sales-2.sql", "beta.sql"]);
    let attachments: Vec<_> =
        workbook.attachments().unwrap().iter().map(|a| (a.file_name.as_str(), a.name.as_str())).collect();
    assert_eq!(attachments, [("Sales.parquet", "Sales")]);
    // A new script neither takes the name of an attachment
    create(&mut workbook, None, None, "SALES");
    assert!(workbook.script_by_file("SALES-3.sql").is_some());
}

#[test]
fn renames_the_references_to_a_renamed_script_in_the_other_scripts() {
    let (mut workbook, _) = workbook(&[("foo.sql", ""), ("bar.sql", ""), ("baz.sql", "")]);
    let (foo, bar, baz) = (key(&workbook, "foo.sql"), key(&workbook, "bar.sql"), key(&workbook, "baz.sql"));
    set_text(&mut workbook, foo, "select 1 as a", false);
    let bar_text = "select 'é', f.a from :foo f join :FOO g on true";
    set_text(&mut workbook, bar, bar_text, false);
    set_text(&mut workbook, baz, "select * from :bar, :foo_other", false);
    let outcome =
        workbook.apply(WorkbookAction::RenameScript { file_name: "foo.sql".into(), new_name: "foo 2".into() }).unwrap();
    let renamed = r#"select 'é', f.a from :"foo 2" f join :"foo 2" g on true"#;
    assert_eq!(text(&workbook, bar), renamed);
    let changes = workbook.script(bar).unwrap().external_changes().unwrap();
    assert_eq!(changes.from_text, bar_text);
    // The changes count UTF-16 code units of the text before them, the é is one unit and two bytes
    assert_eq!(changes.changes[0], TextChange { from: 21, to: 25, insert: r#":"foo 2""#.into() });
    // Other references keep their names
    assert_eq!(text(&workbook, baz), "select * from :bar, :foo_other");
    assert!(outcome
        .effects
        .contains(&WorkbookEffect::WriteScript { file_name: "bar.sql".into(), text: renamed.into() }));
    assert!(outcome.effects.contains(&WorkbookEffect::RenameScript { from: "foo.sql".into(), to: "foo 2.sql".into() }));
}

#[test]
fn renames_the_references_to_a_renamed_attachment_in_the_scripts() {
    let (mut workbook, _) = workbook(&[("foo.sql", ""), ("bar.sql", "")]);
    let (foo, bar) = (key(&workbook, "foo.sql"), key(&workbook, "bar.sql"));
    workbook.apply(WorkbookAction::SetWorkbookAttachments { files: vec![data_file("sales.parquet")] }).unwrap();
    let foo_text = "select * from :sales s join :SALES t on true";
    set_text(&mut workbook, foo, foo_text, false);
    set_text(&mut workbook, bar, "select * from :foo", false);
    let action = WorkbookAction::RenameAttachment { file_name: "sales.parquet".into(), name: "sales 2024".into() };
    let outcome = workbook.apply(action).unwrap();
    let renamed = r#"select * from :"sales 2024" s join :"sales 2024" t on true"#;
    assert_eq!(text(&workbook, foo), renamed);
    assert_eq!(workbook.script(foo).unwrap().external_changes().unwrap().from_text, foo_text);
    assert_eq!(text(&workbook, bar), "select * from :foo");
    let attachments: Vec<_> =
        workbook.attachments().unwrap().iter().map(|a| (a.file_name.as_str(), a.name.as_str())).collect();
    assert_eq!(attachments, [("sales 2024.parquet", "sales 2024")]);
    // The scripts that read the attachment are written, then its file is renamed
    assert_eq!(
        outcome.effects,
        [
            WorkbookEffect::WriteScript { file_name: "foo.sql".into(), text: renamed.into() },
            WorkbookEffect::RenameDataFile { from: "sales.parquet".into(), to: "sales 2024.parquet".into() },
        ]
    );
    // A name that is no plain file name or the same name renames nothing
    for name in ["a/b", "  ", "sales 2024"] {
        let outcome = workbook
            .apply(WorkbookAction::RenameAttachment { file_name: "sales 2024.parquet".into(), name: name.into() })
            .unwrap();
        assert!(!outcome.changed && outcome.effects.is_empty());
    }
}

#[test]
fn names_a_renamed_attachment_past_the_scripts_and_the_other_attachments() {
    let attachment = |file_name: &str| WorkbookAttachment {
        file_name: file_name.into(),
        name: file_name.trim_end_matches(".parquet").into(),
        size_bytes: 1,
        mtime_ms: 1,
        columns: None,
    };
    let attachments = [attachment("sales.parquet"), attachment("orders.parquet")];
    let renamed = |requested: &str, scripts: &[&str]| {
        renamed_attachment_file_name("sales.parquet", requested, scripts.iter().copied(), &attachments)
    };
    assert_eq!(renamed(" revenue ", &["items"]).as_deref(), Some("revenue.parquet"));
    assert_eq!(renamed("revenue.parquet", &[]).as_deref(), Some("revenue.parquet"));
    assert_eq!(renamed("Items", &["items"]).as_deref(), Some("Items-2.parquet"));
    // The name of another attachment is taken in any case, also as a whole file name
    assert_eq!(renamed("ORDERS", &[]).as_deref(), Some("ORDERS-2.parquet"));
    assert_eq!(renamed("orders.parquet", &[]).as_deref(), Some("orders-2.parquet"));
    // The attachment may keep its name or change its case
    assert_eq!(renamed("Sales", &[]).as_deref(), Some("Sales.parquet"));
    assert_eq!(renamed("a/b", &[]), None);
    assert_eq!(renamed("  ", &[]), None);
}

/// The origin of a workbook opened from a published workbook, read-only or imported
fn published(read_only: bool) -> WorkbookOrigin {
    WorkbookOrigin { link: serde_json::json!({ "workbookId": "published", "versionId": "v1" }), read_only }
}

#[test]
fn a_read_only_workbook_refuses_the_rename_of_an_attachment_before_anything_changed() {
    let (mut workbook, _) = workbook(&[("foo.sql", "")]);
    let foo = key(&workbook, "foo.sql");
    workbook.apply(WorkbookAction::SetWorkbookAttachments { files: vec![data_file("sales.parquet")] }).unwrap();
    set_text(&mut workbook, foo, "select * from :sales", false);
    let link = published(true);
    workbook.apply(WorkbookAction::SetOrigin { origin: Some(link) }).unwrap();
    assert!(workbook
        .apply(WorkbookAction::RenameAttachment { file_name: "sales.parquet".into(), name: "revenue".into() })
        .is_err());
    assert_eq!(text(&workbook, foo), "select * from :sales");
    assert_eq!(workbook.attachments().unwrap()[0].file_name, "sales.parquet");
}

#[test]
fn keeps_the_columns_of_an_attachment_until_its_file_changes() {
    let (mut workbook, _) = workbook(&[("foo.sql", "select * from :sales")]);
    let foo = key(&workbook, "foo.sql");
    workbook.apply(WorkbookAction::SetWorkbookAttachments { files: vec![data_file("sales.parquet")] }).unwrap();
    settle(&mut workbook);
    let columns = |names: &[&str]| names.iter().map(|name| Arc::<str>::from(*name)).collect::<Vec<_>>();
    let set = |stamp: &str, names: &[&str]| WorkbookAction::SetAttachmentColumns {
        file_name: "sales.parquet".into(),
        stamp: stamp.into(),
        columns: columns(names),
    };
    // Columns of another version of the file are dropped
    assert!(!workbook.apply(set("9-9", &["a"])).unwrap().changed);
    assert!(workbook.apply(set("1-1", &["region", "amount"])).unwrap().changed);
    // The scripts that read the attachment resolve its columns again
    assert!(workbook.script(foo).unwrap().is_analysis_outdated());
    assert!(!workbook.apply(set("1-1", &["region", "amount"])).unwrap().changed);
    // The same listing keeps the columns
    assert!(
        !workbook
            .apply(WorkbookAction::SetWorkbookAttachments { files: vec![data_file("sales.parquet")] })
            .unwrap()
            .changed
    );
    assert_eq!(workbook.attachments().unwrap()[0].columns, Some(columns(&["region", "amount"])));
}

#[test]
fn analyzes_the_readers_of_a_script_whose_columns_changed() {
    let (mut workbook, _) = workbook(&[("foo.sql", "select 1 as a"), ("bar.sql", "select a from :foo")]);
    let (foo, bar) = (key(&workbook, "foo.sql"), key(&workbook, "bar.sql"));
    settle(&mut workbook);
    assert!(!workbook.script(bar).unwrap().is_analysis_outdated());
    // New columns of the result of foo outdate the analysis of bar
    set_text(&mut workbook, foo, "select 1 as a, 2 as b", false);
    assert!(workbook.script(bar).unwrap().is_analysis_outdated());
    settle(&mut workbook);
    assert!(!workbook.script(bar).unwrap().is_analysis_outdated());
}

fn stored(name: &str, sql: &str, connection: &Rc<ScriptConnection>) -> StoredScript {
    StoredScript { name: name.into(), sql: sql.into(), connection: connection.clone(), unresolved_connection_id: None }
}

#[test]
fn keeps_a_read_only_workbook_as_it_came_until_it_gets_an_origin_of_its_own() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "/* @param :region = 'US' */ select :region")]);
    let alpha = key(&workbook, "alpha.sql");
    let link = published(true);
    let outcome = workbook.apply(WorkbookAction::SetOrigin { origin: Some(link.clone()) }).unwrap();
    assert!(
        matches!(&outcome.effects[0], WorkbookEffect::WriteProperties { origin: Some(origin), .. } if origin.read_only)
    );
    assert!(workbook.is_read_only());
    // Changes of what the workbook says are refused, query ids still land
    let input = WorkbookAction::SetWorkbookInput { name: "region".into(), literal: "'EU'".into(), keys: vec![alpha] };
    assert!(workbook.apply(input).is_err());
    assert!(workbook
        .apply(WorkbookAction::CreateScript {
            place: ScriptPlacement::End,
            text: None,
            base: "beta".into(),
            connection: None
        })
        .is_err());
    assert_eq!(text(&workbook, alpha), "/* @param :region = 'US' */ select :region");
    assert!(workbook.apply(WorkbookAction::RegisterQuery { key: alpha, query_id: 1 }).unwrap().changed);
    // An origin that isn't read-only imports the workbook
    workbook.apply(WorkbookAction::SetOrigin { origin: Some(published(false)) }).unwrap();
    assert!(!workbook.is_read_only());
    create(&mut workbook, None, None, "beta");
    assert!(!workbook.apply(WorkbookAction::SetOrigin { origin: Some(published(false)) }).unwrap().changed);
}

#[test]
fn promotes_an_ephemeral_workbook_that_holds_a_script() {
    let (mut workbook, _) = workbook(&[]);
    workbook.set_ephemeral(true);
    assert_eq!(workbook.promote(["Untitled"]), None);
    create(&mut workbook, None, Some("select 1"), "first");
    let effect = workbook.promote(["Untitled", "Sales"]);
    assert_eq!(
        effect,
        Some(WorkbookEffect::WriteProperties { name: Some("Untitled 2".into()), ephemeral: false, origin: None })
    );
    assert!(!workbook.ephemeral());
    assert_eq!(workbook.promote(["Untitled"]), None);
}

#[test]
fn matches_and_replaces_the_scripts_that_storage_holds() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let alpha = key(&workbook, "alpha.sql");
    assert!(workbook
        .matches_stored_scripts(&[stored("alpha.sql", "select 1", &main), stored("beta.sql", "select 2", &main)]));
    // The order is part of what storage holds
    assert!(!workbook
        .matches_stored_scripts(&[stored("beta.sql", "select 2", &main), stored("alpha.sql", "select 1", &main)]));
    let other = connection("other", None);
    let changed = workbook
        .replace_from_storage(vec![
            stored("added.sql", "select 3", &main),
            stored("alpha.sql", "select changed", &other),
        ])
        .unwrap();
    assert!(changed);
    assert_eq!(files(&workbook), ["added.sql", "alpha.sql"]);
    let moved = workbook.script(alpha).unwrap();
    assert_eq!(moved.text(), "select changed");
    assert!(Rc::ptr_eq(moved.connection(), &other));
    assert!(workbook.matches_stored_scripts(&[
        stored("added.sql", "select 3", &main),
        stored("alpha.sql", "select changed", &other)
    ]));
}

#[test]
fn replaces_the_text_of_a_stored_script_that_stays_on_its_connection() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    let alpha = key(&workbook, "alpha.sql");
    set_text(&mut workbook, alpha, "select 1, 2", true);
    let mut entry = stored("alpha.sql", "select changed", &main);
    entry.unresolved_connection_id = Some("unknown".into());
    workbook.replace_from_storage(vec![entry]).unwrap();
    assert_eq!(files(&workbook), ["alpha.sql"]);
    let replaced = workbook.script(alpha).unwrap();
    // The script keeps its key and drops what belonged to the old text
    assert_eq!(replaced.text(), "select changed");
    assert!(replaced.pending_diff().is_none());
    assert!(replaced.is_analysis_outdated());
    assert_eq!(replaced.unresolved_connection_id(), Some("unknown"));
}

#[test]
fn keeps_the_analysis_of_scripts_that_storage_did_not_change() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1"), ("beta.sql", "select 2")]);
    settle(&mut workbook);
    let revision = workbook.revision();
    let changed = workbook
        .replace_from_storage(vec![
            stored("alpha.sql", "select 1", &main),
            stored("beta.sql", "select 2", &main),
            // A duplicate entry of storage is ignored
            stored("alpha.sql", "select other", &main),
        ])
        .unwrap();
    assert!(!changed);
    assert_eq!(workbook.revision(), revision);
    assert_eq!(files(&workbook), ["alpha.sql", "beta.sql"]);
    assert!(workbook.scripts().iter().all(|script| !script.is_analysis_outdated()));
    assert_eq!(text(&workbook, key(&workbook, "alpha.sql")), "select 1");
}

#[test]
fn keeps_the_reference_to_an_unresolved_connection_until_a_connection_is_picked() {
    let main = connection("main", Some(MAIN_PARAMS));
    let mut workbook = Workbook::new("workbook", None, None, EditorOffsetUnit::UTF16_CODE_UNITS);
    let alpha = workbook.add_stored_script("alpha.sql", "select 1", main.clone(), Some("unknown".into())).unwrap();
    let effects = create(&mut workbook, None, None, "beta");
    let list =
        |effects: &[WorkbookEffect]| match effects.iter().find(|e| matches!(e, WorkbookEffect::WriteScriptList(_))) {
            Some(WorkbookEffect::WriteScriptList(list)) => list.clone(),
            _ => panic!("no script list"),
        };
    assert_eq!(
        list(&effects).scripts[0],
        ScriptListEntry { name: "alpha.sql".into(), connection_id: "unknown".into() }
    );
    // Picking the connection the script runs on replaces the reference, the script keeps its session
    let outcome = workbook
        .apply(WorkbookAction::SetScriptConnection { file_name: "alpha.sql".into(), connection: main })
        .unwrap();
    assert_eq!(workbook.script(alpha).unwrap().unresolved_connection_id(), None);
    assert_eq!(
        list(&outcome.effects).scripts[0],
        ScriptListEntry { name: "alpha.sql".into(), connection_id: "main".into() }
    );
}

#[test]
fn analyzes_and_publishes_every_script_for_a_run() {
    let (mut workbook, main) =
        workbook(&[("query.sql", "select id from items"), ("items.sql", "create table items (id int)")]);
    let (items, query) = (key(&workbook, "items.sql"), key(&workbook, "query.sql"));
    workbook.analyze_for_run().unwrap();
    // The query resolves the table of the script after it, the second pass analyzed it at the final catalog revision
    assert!(main.catalog.borrow().contains(items));
    let script = workbook.script(query).unwrap();
    assert!(!script.is_analysis_outdated());
    assert!(script.editor_update().unwrap().analysis_available);
    // A catalog update outdates the scripts, the run analyzes them again before it plans
    workbook.apply(WorkbookAction::CatalogDidUpdate { connection_id: "main".into() }).unwrap();
    assert!(workbook.analyze_outdated_scripts());
    assert!(!workbook.analyze_outdated_scripts());
}

#[test]
fn takes_deleted_and_dropped_scripts_out_of_their_catalogs() {
    let (mut workbook, main) =
        workbook(&[("tables.sql", "create table t (x int)"), ("more.sql", "create table u (y int)")]);
    let (tables, more) = (key(&workbook, "tables.sql"), key(&workbook, "more.sql"));
    settle(&mut workbook);
    assert!(main.catalog.borrow().contains(tables) && main.catalog.borrow().contains(more));
    workbook.apply(WorkbookAction::DeleteScript { file_name: "tables.sql".into() }).unwrap();
    assert!(!main.catalog.borrow().contains(tables));
    // A moved script leaves the catalog of its old connection
    let other = connection("other", None);
    workbook
        .apply(WorkbookAction::SetScriptConnection { file_name: "more.sql".into(), connection: other.clone() })
        .unwrap();
    assert!(!main.catalog.borrow().contains(more) && other.catalog.borrow().contains(more));
    // A dropped workbook takes its scripts with it
    drop(workbook);
    assert!(!other.catalog.borrow().contains(more));
}

#[test]
fn applies_the_keystrokes_of_an_editor_and_leaves_out_the_analysis_it_holds() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    let event = typed(&workbook, alpha, "select 42");
    assert!(workbook
        .apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None })
        .unwrap()
        .outcome_is_held());
    // The first cursor move analyzes against the catalog that the published text left
    let event = cursor(&workbook, alpha, 2);
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    let held = workbook.script(alpha).unwrap().editor_update().unwrap().clone();
    assert!(held.analysis_available && held.syntax_spans.is_some());

    // A cursor move of an editor that holds the update of the analysis leaves it out, the script keeps it
    let event = cursor(&workbook, alpha, 3);
    let script = workbook.script(alpha).unwrap();
    let known =
        EditorUpdateId { session_generation: script.session_generation(), serial: script.editor_update_serial() };
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: Some(known) }).unwrap();
    let update = outcome.editor_update.expect("the update without the analysis");
    assert!(update.analysis_omitted && update.syntax_spans.is_none());
    let script = workbook.script(alpha).unwrap().editor_update().unwrap();
    assert_eq!(script.state_revision, update.state_revision);
    assert_eq!(script.syntax_spans, held.syntax_spans);
    assert_eq!(script.semantic_spans, held.semantic_spans);

    // An editor that holds an update of another session or from before the analysis gets the whole update
    for other in [
        EditorUpdateId { session_generation: known.session_generation + 1, ..known },
        EditorUpdateId { serial: 0, ..known },
    ] {
        let event = cursor(&workbook, alpha, 4);
        let outcome =
            workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: Some(other) }).unwrap();
        assert!(outcome.editor_update.is_none_or(|update| !update.analysis_omitted));
        assert!(!workbook.script(alpha).unwrap().editor_update().unwrap().analysis_omitted);
    }
}

#[test]
fn a_new_analysis_with_the_same_versions_crosses_to_the_editor_again() {
    let (mut workbook, _) = workbook(&[("base.sql", "select 1 as a"), ("reader.sql", "select a from :base")]);
    let (base, reader) = (key(&workbook, "base.sql"), key(&workbook, "reader.sql"));
    settle(&mut workbook);
    let event = cursor(&workbook, reader, 1);
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: reader, event, known: None }).unwrap();
    let script = workbook.script(reader).unwrap();
    let known =
        EditorUpdateId { session_generation: script.session_generation(), serial: script.editor_update_serial() };
    let before = script.editor_update().map(|update| (update.text_version, update.catalog_revision)).unwrap();
    // The result of base gets a column, reader analyzes again with its text against the same catalog
    set_text(&mut workbook, base, "select 1 as a, 2 as b", false);
    workbook.apply(WorkbookAction::AnalyzeOutdatedScript { key: reader }).unwrap();
    let after = workbook
        .script(reader)
        .unwrap()
        .editor_update()
        .map(|update| (update.text_version, update.catalog_revision))
        .unwrap();
    assert_eq!(before, after);
    // The editor holds the analysis before, the move of its cursor carries the new one
    let event = cursor(&workbook, reader, 2);
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: reader, event, known: Some(known) }).unwrap();
    assert!(outcome.editor_update.is_none_or(|update| !update.analysis_omitted));
}

#[test]
fn refuses_a_keystroke_of_an_editor_that_missed_a_change_of_the_text() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    // The editor shows the text, then the workbook changes it
    let stale = typed(&workbook, alpha, "select 2");
    workbook
        .apply(WorkbookAction::SetScriptText { key: alpha, text: "select 12345".into(), with_diff: false })
        .unwrap();
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event: stale, known: None }).unwrap();
    assert_eq!(
        outcome.editor_update.map(|update| update.status),
        Some(dashql_buffers::editor::EditorUpdateStatus::STALE_TEXT_VERSION)
    );
    assert!(outcome.effects.is_empty() && !outcome.changed);
    assert_eq!(workbook.script(alpha).unwrap().text(), "select 12345");
}

#[test]
fn a_read_only_workbook_refuses_every_change_of_its_scripts() {
    let (mut workbook, main) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    let link = published(true);
    workbook.apply(WorkbookAction::SetOrigin { origin: Some(link) }).unwrap();
    // Typing and replacing the scripts from storage fail, the text stays
    let event = typed(&workbook, alpha, "select 2");
    assert!(workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).is_err());
    let stored = vec![StoredScript {
        name: "alpha.sql".into(),
        sql: "select 3".into(),
        connection: main.clone(),
        unresolved_connection_id: None,
    }];
    assert!(workbook.replace_from_storage(stored).is_err());
    assert!(workbook.apply(WorkbookAction::RejectPendingDiff { key: alpha }).is_err());
    assert_eq!(workbook.script(alpha).unwrap().text(), "select 1");
    // Moving the cursor of the read-only editor stays
    let event = cursor(&workbook, alpha, 3);
    assert!(workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).is_ok());
}

#[test]
fn computes_a_chart_edit_before_it_changes_the_script() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1 as x")]);
    let alpha = key(&workbook, "alpha.sql");
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"bar"}"#.into() }).unwrap();
    assert!(workbook.script(alpha).unwrap().pending_diff().is_some());
    let version = workbook.script(alpha).unwrap().session().borrow().text_version();
    // A spec that isn't one changes nothing, not even the version of the text
    let outcome = workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: "not json".into() }).unwrap();
    assert!(!outcome.changed && outcome.effects.is_empty());
    assert_eq!(workbook.script(alpha).unwrap().session().borrow().text_version(), version);
    // A second edit restages the diff against the text before the first one
    workbook.apply(WorkbookAction::SetScriptVisSpec { key: alpha, spec: r#"{"mark":"line"}"#.into() }).unwrap();
    let script = workbook.script(alpha).unwrap();
    assert_eq!(script.pending_diff().map(|diff| diff.prior_text.as_str()), Some("select 1 as x"));
    assert!(script.text().contains("line"));
}

#[test]
fn a_run_analyzes_the_outdated_scripts_once() {
    let (mut workbook, _) = workbook(&[("tables.sql", "create table t (x int)"), ("query.sql", "select x from t")]);
    let (tables, query) = (key(&workbook, "tables.sql"), key(&workbook, "query.sql"));
    assert_eq!(workbook.analyze_for_run(), Ok(true));
    assert!(workbook.scripts().iter().all(|script| !script.is_analysis_outdated()));
    // Current analyses stay as they are
    let revision = workbook.script(query).unwrap().revision();
    assert_eq!(workbook.analyze_for_run(), Ok(false));
    assert_eq!(workbook.script(query).unwrap().revision(), revision);
    // Typing a new table outdates the query, the next run analyzes it
    let event = typed(&workbook, tables, "create table t (x int, y int)");
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: tables, event, known: None }).unwrap();
    assert!(workbook.script(query).unwrap().is_analysis_outdated());
    assert_eq!(workbook.analyze_for_run(), Ok(true));
    assert!(workbook.scripts().iter().all(|script| !script.is_analysis_outdated()));
}

#[test]
fn writes_a_typed_text_whose_analysis_failed() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1")]);
    let alpha = key(&workbook, "alpha.sql");
    settle(&mut workbook);
    let revision = workbook.script(alpha).unwrap().revision();
    // A function name of four parts fails the analysis (docs/design/core_quirks.md)
    let event = typed(&workbook, alpha, "select a.b.c.d(1)");
    let outcome = workbook.apply(WorkbookAction::ApplyEditorEvent { key: alpha, event, known: None }).unwrap();
    let script = workbook.script(alpha).unwrap();
    assert_eq!(
        script.editor_update().map(|update| update.status),
        Some(dashql_buffers::editor::EditorUpdateStatus::ANALYSIS_FAILED)
    );
    assert_eq!(
        outcome.effects,
        [WorkbookEffect::WriteScript { file_name: "alpha.sql".into(), text: "select a.b.c.d(1)".into() }]
    );
    assert!(outcome.changed && script.revision() > revision);
}

#[test]
fn a_script_stays_current_with_its_own_declarations() {
    let (mut workbook, _) = workbook(&[("tables.sql", "")]);
    let tables = key(&workbook, "tables.sql");
    settle(&mut workbook);
    let event = typed(&workbook, tables, "create table t (x int)");
    workbook.apply(WorkbookAction::ApplyEditorEvent { key: tables, event, known: None }).unwrap();
    // The publish of the table changed the catalog, the analysis of the script that published it stays current
    assert!(!workbook.script(tables).unwrap().is_analysis_outdated());
    assert_eq!(workbook.analyze_for_run(), Ok(false));
}

#[test]
fn a_rewrite_of_the_text_reaches_a_mounted_editor_as_a_change() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1 as a")]);
    let alpha = key(&workbook, "alpha.sql");
    set_text(&mut workbook, alpha, "select 12 as a", false);
    assert_eq!(
        workbook.script(alpha).unwrap().external_changes(),
        Some(&ExternalChanges {
            from_text: "select 1 as a".into(),
            changes: vec![TextChange { from: 8, to: 8, insert: "2".into() }],
        })
    );
    // Rejecting a staged rewrite restores the text the same way
    set_text(&mut workbook, alpha, "select 3 as a", true);
    workbook.apply(WorkbookAction::RejectPendingDiff { key: alpha }).unwrap();
    assert_eq!(text(&workbook, alpha), "select 12 as a");
    assert_eq!(
        workbook.script(alpha).unwrap().external_changes().map(|changes| changes.from_text.as_str()),
        Some("select 3 as a")
    );
}

#[test]
fn a_script_of_a_merged_connection_keeps_what_its_session_does_not_hold() {
    let (mut workbook, _) = workbook(&[("alpha.sql", "select 1 as x")]);
    let alpha = key(&workbook, "alpha.sql");
    settle(&mut workbook);
    set_text(&mut workbook, alpha, "select 2 as x", true);
    let stored = vec![StoredScript {
        name: "alpha.sql".into(),
        sql: "select 2 as x".into(),
        connection: workbook.script(alpha).unwrap().connection().clone(),
        unresolved_connection_id: Some("missing".into()),
    }];
    workbook.replace_from_storage(stored).unwrap();
    // The reload kept the staged rewrite of the unchanged text, the script names the unresolved connection
    set_text(&mut workbook, alpha, "select 3 as x", true);
    workbook.apply(WorkbookAction::SetExecutionVisualization { key: alpha, visualization: None }).unwrap();
    let before = workbook.script(alpha).unwrap();
    let (diff, statistics, update) =
        (before.pending_diff().map(|diff| diff.revision), before.statistics().count(), before.editor_update().cloned());
    assert!(diff.is_some() && statistics > 0 && update.is_some());
    assert_eq!(before.unresolved_connection_id(), Some("missing"));
    let target = connection("target", Some("{}"));
    workbook.apply(WorkbookAction::ReplaceConnection { from: "main".into(), into: target.clone() }).unwrap();
    let moved = workbook.script(alpha).unwrap();
    assert!(Rc::ptr_eq(moved.connection(), &target));
    assert_eq!(moved.pending_diff().map(|diff| diff.revision), diff);
    assert_eq!(moved.unresolved_connection_id(), Some("missing"));
    assert_eq!(moved.statistics().count(), statistics);
    assert_eq!(moved.editor_update(), update.as_ref());
    assert!(moved.is_analysis_outdated());
}

#[test]
fn a_script_that_analyzes_before_a_rewrite_of_references_moves_its_revision() {
    let (mut workbook, main) = workbook(&[("foo.sql", "select 1 as a"), ("bar.sql", "select 2 as b")]);
    let bar = key(&workbook, "bar.sql");
    settle(&mut workbook);
    // The text of bar changes on disk, its analysis lags behind it
    let stored = |sql: &str| StoredScript {
        name: "".into(),
        sql: sql.into(),
        connection: main.clone(),
        unresolved_connection_id: None,
    };
    let scripts = vec![
        StoredScript { name: "foo.sql".into(), ..stored("select 1 as a") },
        StoredScript { name: "bar.sql".into(), ..stored("select 3 as b") },
    ];
    workbook.replace_from_storage(scripts).unwrap();
    let revision = workbook.script(bar).unwrap().revision();
    // The rename analyzes bar before it looks for references, bar shows its new analysis
    workbook.apply(WorkbookAction::RenameScript { file_name: "foo.sql".into(), new_name: "renamed".into() }).unwrap();
    let script = workbook.script(bar).unwrap();
    assert!(script.revision() > revision);
    assert_eq!(
        script.editor_update().map(|update| update.text_version),
        Some(script.session().borrow().text_version())
    );
}

#[test]
fn the_workbooks_on_a_connection_share_its_catalog() {
    let main = connection("main", Some(MAIN_PARAMS));
    let mut first = Workbook::new("first", None, Some(main.clone()), EditorOffsetUnit::UTF16_CODE_UNITS);
    let mut second = Workbook::new("second", None, Some(main.clone()), EditorOffsetUnit::UTF16_CODE_UNITS);
    let tables = first.add_stored_script("tables.sql", "", main.clone(), None).unwrap();
    let query = second.add_stored_script("query.sql", "select y from t", main.clone(), None).unwrap();
    settle(&mut first);
    settle(&mut second);
    first.take_published();
    assert!(!second.script(query).unwrap().is_analysis_outdated());
    // A table that the first workbook publishes reaches the scripts of the second through the catalog
    let event = typed(&first, tables, "create table t (y int)");
    first.apply(WorkbookAction::ApplyEditorEvent { key: tables, event, known: None }).unwrap();
    assert_eq!(first.take_published(), ["main"]);
    assert!(second.script(query).unwrap().is_analysis_outdated());
    // The host outdates the scripts of the other workbooks on the connection, they analyze against the table
    second.apply(WorkbookAction::CatalogDidUpdate { connection_id: "main".into() }).unwrap();
    settle(&mut second);
    let diagnostics = |workbook: &Workbook, key: ScriptKey| {
        workbook.script(key).unwrap().editor_update().unwrap().diagnostics.clone().unwrap_or_default()
    };
    assert!(diagnostics(&second, query).is_empty());

    // Both workbooks declare t: the other scripts resolve t against the older declaration, the table of the first
    // workbook, and keep the newer one as an alternative. A script resolves its own declaration first.
    let other =
        second.add_stored_script("other.sql", "create table t (z int); select z from t", main.clone(), None).unwrap();
    let reads = second.add_stored_script("reads.sql", "select * from t", main.clone(), None).unwrap();
    settle(&mut second);
    let resolved = |workbook: &Workbook, key: ScriptKey| -> Vec<(u32, usize)> {
        let session = workbook.script(key).unwrap().session().borrow();
        let analyzed = session.script().current_analysis().map(|(_, _, analyzed)| analyzed.clone()).unwrap();
        analyzed
            .table_references
            .iter()
            .filter_map(|reference| reference.inner.as_ref())
            .filter_map(|relation| {
                Some((
                    relation.resolved_table.as_ref()?.catalog_table_id.unpack_table_id().origin,
                    relation.resolved_alternatives.len(),
                ))
            })
            .collect()
    };
    assert_eq!(resolved(&second, reads), [(tables, 1)]);
    assert_eq!(resolved(&second, other).first().map(|(origin, _)| *origin), Some(other));
    assert!(diagnostics(&second, query).is_empty());
}

#[test]
fn compiles_the_visualizations_again_in_a_new_dialect() {
    let (mut workbook, main) = workbook(&[("chart.sql", "/* @vis table */\nselect 2 as x")]);
    let chart = key(&workbook, "chart.sql");
    settle(&mut workbook);
    let (revision, compiled) = {
        let script = workbook.script(chart).unwrap();
        (script.visualization_revision(), script.visualization().map(|vis| vis.sql.clone()))
    };
    assert!(compiled.is_some());
    // Unchanged, the profile compiles to the same visualization
    assert!(workbook.apply(WorkbookAction::ConnectionProfileChanged { connection_id: "main".into() }).unwrap().changed);
    assert_eq!(workbook.script(chart).unwrap().visualization_revision(), revision);
    assert!(main.update(ScriptConnectionProfile { dialect: FormattingDialect::TRINO, ..profile(Some(MAIN_PARAMS)) }));
    workbook.apply(WorkbookAction::ConnectionProfileChanged { connection_id: "main".into() }).unwrap();
    let script = workbook.script(chart).unwrap();
    assert!(script.visualization().is_some());
    // A connection that the workbook doesn't use changes nothing
    assert!(
        !workbook.apply(WorkbookAction::ConnectionProfileChanged { connection_id: "other".into() }).unwrap().changed
    );
}

trait HeldUpdate {
    /// Does the script hold the update of the outcome?
    fn outcome_is_held(&self) -> bool;
}

impl HeldUpdate for dashql_core_runtime::workbook::WorkbookOutcome {
    fn outcome_is_held(&self) -> bool {
        self.changed && self.editor_update.is_none()
    }
}
