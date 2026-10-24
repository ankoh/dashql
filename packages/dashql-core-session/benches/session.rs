//! Editor session benchmarks: the work of one editor event, packed like the wasm module packs it.
//!
//! The document has 40 join queries over a schema of 30 tables, so an update with the analysis holds a few
//! thousand syntax spans and several hundred semantic spans.
//!
//!   bazel run -c opt //packages/dashql-core-session:bench_session

#[path = "../../dashql-core/benches/harness.rs"]
mod harness;

use dashql_buffers::editor::{
    EditorEventAction, EditorEventIntent, EditorEventOrigin, EditorEventT, EditorOffsetUnit, EditorAnalysisVersionT,
    EditorSelectionT, EditorTextChangeT, EditorUpdateT,
};
use dashql_core::catalog::{Catalog, CatalogLayer};
use dashql_core::script::Script;
use dashql_core_session::script_session::ScriptSession;
use harness::bench;
use std::fmt::Write;
use std::hint::black_box;

const TABLES: usize = 30;
const COLUMNS: usize = 15;
const QUERIES: usize = 40;

fn schema() -> String {
    let mut sql = String::new();
    for t in 0..TABLES {
        let columns: Vec<String> = (0..COLUMNS).map(|c| format!("c{c} integer")).collect();
        writeln!(sql, "create table t{t} ({});", columns.join(", ")).unwrap();
    }
    sql
}

fn document() -> String {
    let mut sql = String::new();
    for q in 0..QUERIES {
        let (a, b) = (q % TABLES, (q * 7 + 3) % TABLES);
        writeln!(
            sql,
            "select t{a}.c1, t{a}.c2, sum(t{b}.c4) as total\nfrom t{a} join t{b} on t{a}.c0 = t{b}.c0\nwhere t{a}.c5 > 10 and t{b}.c6 < 'x'\ngroup by 1, 2;\n"
        )
        .unwrap();
    }
    sql
}

/// Pack an update into bytes, the result of a wasm call
fn pack(update: &EditorUpdateT) -> usize {
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let packed = update.pack(&mut builder);
    builder.finish(packed, None);
    builder.finished_data().len()
}

fn selection(offset: u64) -> Option<Box<EditorSelectionT>> {
    let mut selection = EditorSelectionT::default();
    selection.anchor = offset;
    selection.head = offset;
    Some(Box::new(selection))
}

/// A cursor move, the event of CodeMirror for a selection change
fn move_event(session: &ScriptSession, offset: u64) -> EditorEventT {
    let mut event = EditorEventT::default();
    event.expected_text_version = session.text_version();
    event.origin = EditorEventOrigin::USER;
    event.intent = EditorEventIntent::SELECTION;
    event.primary_selection = selection(offset);
    event
}

/// A typed character, the event of CodeMirror for an insert
fn type_event(session: &ScriptSession, offset: u64, insert: &str) -> EditorEventT {
    let mut change = EditorTextChangeT::default();
    change.from = offset;
    change.to = offset + if insert.is_empty() { 1 } else { 0 };
    change.insert = Some(insert.to_string());
    let mut event = EditorEventT::default();
    event.expected_text_version = session.text_version();
    event.changes = Some(vec![change]);
    event.origin = EditorEventOrigin::USER;
    event.intent = EditorEventIntent::EDIT;
    event.action = EditorEventAction::TYPE;
    event.analyze = true;
    event.primary_selection = selection(offset + insert.len() as u64);
    event
}

fn main() {
    let mut catalog = Catalog::new();
    let mut schema_script = Script::new(&catalog);
    schema_script.insert_text_at(0, &schema());
    schema_script.analyze(&catalog, true).expect("schema");
    catalog.load_script(schema_script.analyzed.clone().unwrap(), CatalogLayer::CONNECTION).expect("load schema");

    let text = document();
    let mut session = ScriptSession::new(&catalog, EditorOffsetUnit::UTF16_CODE_UNITS).expect("session");
    session.replace_text(&catalog, session.text_version(), &text);
    session.analyze(&catalog);

    // A cursor in the middle of a column reference
    let cursor = text.find("t20.c4").unwrap() as u64 + 5;
    let update = session.apply(&catalog, &move_event(&session, cursor));
    println!(
        "analysis: {} diagnostics, {} syntax spans, {} semantic spans, {} bytes",
        update.diagnostics.as_ref().map_or(0, |d| d.len()),
        update.syntax_spans.as_ref().map_or(0, |s| s.len()),
        update.semantic_spans.as_ref().map_or(0, |s| s.len()),
        pack(&update),
    );

    let mut flip = false;
    bench("move_cursor", || {
        flip = !flip;
        let event = move_event(&session, if flip { cursor } else { cursor + 1 });
        black_box(pack(&session.apply(&catalog, &event)));
    });

    // The host holds the analysis, the update carries the cursor only
    let mut known = EditorAnalysisVersionT::default();
    known.text_version = update.text_version;
    known.catalog_revision = update.catalog_revision;
    let known = Some(Box::new(known));
    let mut event = move_event(&session, cursor + 1);
    event.known_analysis = known.clone();
    println!("known analysis: {} bytes", pack(&session.apply(&catalog, &event)));
    bench("move_cursor_known", || {
        flip = !flip;
        let mut event = move_event(&session, if flip { cursor } else { cursor + 1 });
        event.known_analysis = known.clone();
        let update = session.apply(&catalog, &event);
        assert!(update.analysis_omitted);
        black_box(pack(&update));
    });

    // Type a character and delete it again, every event analyzes
    let mut typed = false;
    bench("type_character", || {
        typed = !typed;
        let event = if typed { type_event(&session, cursor, "1") } else { type_event(&session, cursor, "") };
        black_box(pack(&session.apply(&catalog, &event)));
    });
}
