//! The persistence of connections: what storage keeps of a connection and when it is written. Ported from
//! `applyConnectionAction` of `packages/dashql/src/runtime/connections/connection_registry_state.ts` and from
//! `connection_persistence_service.ts`.
//!
//! The app manifest is the source of truth of a connection: its entry holds the params, the draft, the name and the
//! caching choice. Every workbook that references the connection keeps a copy of its saved params. The files of a
//! durable connection hold its catalog: the relations, the functions and the state of the lookups. The decisions are
//! functions of the connection before and after a change, the writes go through the storage writer.

use serde_json::{json, Map, Value};

use crate::catalog_loader::catalog_is_durable;
use crate::catalog_loader::tables::{relations_file_of_entry, CatalogStateFile};
use crate::connections::{CatalogUpdateTaskStatus, ConnectionParams, ConnectionState};
use crate::restore::catalog::{CATALOG_FUNCTIONS_FILE, CATALOG_RELATIONS_FILE, CATALOG_STATE_FILE};
use crate::storage::keys::{connection_entry_key, connection_file_key, workbook_connection_copy_key};
use crate::storage::{StorageHost, StorageWriter, TextSource, WriteOutcome, WriteTask};
use crate::workbook_format::data::WorkbookConnection;
use crate::workbook_format::sharing::connection_params_share_equal;

/// The debounce of the writes of the params and the catalog of a connection
pub const CONNECTION_WRITE_DEBOUNCE_MS: f64 = 100.0;
/// The debounce of the writes of a draft, edits arrive with every keystroke. A draft is written to the app manifest only.
pub const CONNECTION_DRAFT_WRITE_DEBOUNCE_MS: f64 = 250.0;

/// What storage keeps of a connection, the fields that decide whether a change is written
#[derive(Debug, Clone, PartialEq)]
pub struct PersistedConnection {
    /// Does the connection belong to a committed workbook or was it online once? Only an active connection is written
    /// without a workbook.
    pub active: bool,
    pub params: Value,
    pub params_draft: Option<Value>,
    pub name: Option<String>,
    pub cache_query_results: Option<bool>,
}

fn params_value(params: &ConnectionParams) -> Value {
    serde_json::from_str(&params.to_json()).unwrap_or(Value::Null)
}

impl PersistedConnection {
    /// The persisted fields of a connection
    pub fn of_state(state: &ConnectionState) -> Self {
        Self {
            active: state.active(),
            params: params_value(state.params()),
            params_draft: state.params_draft().map(params_value),
            name: state.name().map(str::to_string),
            cache_query_results: state.cache_query_results(),
        }
    }
}

/// Do two optional params describe the same connection?
fn same_params(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => connection_params_share_equal(left, right),
        (None, None) => true,
        _ => false,
    }
}

/// What changed a connection
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionChange {
    /// The connection was deleted
    Deleted,
    /// Saving committed its params, the save writes them by itself
    ParamsCommitted,
    /// Statements touched relations
    RelationsTouched,
    /// A catalog update finished. A lookup of relations that changed nothing (`changed` false) has nothing to save.
    CatalogUpdateFinished { status: CatalogUpdateTaskStatus, refreshed: bool, changed: Option<bool> },
    /// Anything else
    Other,
}

/// A write of a connection
pub struct ConnectionWrite {
    pub key: String,
    pub task: WriteTask,
    pub debounce_ms: f64,
}

/// The writes after a change of a connection
#[derive(Default)]
pub struct ConnectionWrites {
    /// Discard the pending writes of the files of the connection first, they would recreate its folder
    pub cancel_file_writes: bool,
    pub writes: Vec<ConnectionWrite>,
}

/// The entry of a connection in the app manifest. The id comes with it, a connection that the app created holds none.
pub fn connection_entry(connection_id: &str, state: &ConnectionState) -> Value {
    let mut entry = Map::new();
    entry.insert("id".into(), json!(connection_id));
    entry.insert("params".into(), params_value(state.params()));
    if let Some(draft) = state.params_draft() {
        entry.insert("paramsDraft".into(), params_value(draft));
    }
    if let Some(name) = state.name() {
        entry.insert("name".into(), json!(name));
    }
    if let Some(caching) = state.cache_query_results() {
        entry.insert("cacheQueryResults".into(), json!(caching));
    }
    Value::Object(entry)
}

/// The copy of a connection that a workbook file keeps: its id and its saved params
pub fn workbook_copy(connection_id: &str, params: &Value) -> WorkbookConnection {
    WorkbookConnection::new(connection_id, params.clone())
}

/// The writes of the saved params of a connection: the app manifest and every workbook that references it
fn params_writes(id: &str, next: &ConnectionState, workbook_ids: &[String], out: &mut Vec<ConnectionWrite>) {
    out.push(ConnectionWrite {
        key: connection_entry_key(id),
        task: WriteTask::WriteConnectionEntry { entry: connection_entry(id, next) },
        debounce_ms: CONNECTION_WRITE_DEBOUNCE_MS,
    });
    let copy = workbook_copy(id, &params_value(next.params()));
    for workbook_id in workbook_ids {
        out.push(ConnectionWrite {
            key: workbook_connection_copy_key(workbook_id, id),
            task: WriteTask::PatchWorkbookConnection { workbook_id: workbook_id.clone(), copy: copy.clone(), replaced: Vec::new() },
            debounce_ms: CONNECTION_WRITE_DEBOUNCE_MS,
        });
    }
}

/// The writes after a change of the connection `id` that the workbooks `workbook_ids` reference.
///
/// Only connections that workbooks reference or that were activated are written. Saved params are written to the app
/// manifest and into every workbook that references the connection, drafts, names and the caching choice to the app
/// manifest only. The catalog of an active connection is written into the files of the connection, workbooks keep no
/// copy, and the relations of a connection whose database doesn't outlive the app are never written. The relations
/// are rendered when the write runs, a run of statements saves them once.
pub fn connection_writes(
    id: &str,
    prev: &PersistedConnection,
    next: &ConnectionState,
    change: &ConnectionChange,
    workbook_ids: &[String],
) -> ConnectionWrites {
    let mut out = ConnectionWrites::default();
    if *change == ConnectionChange::Deleted {
        if prev.active {
            out.cancel_file_writes = true;
            out.writes.push(ConnectionWrite {
                key: connection_entry_key(id),
                task: WriteTask::DeleteConnectionEntry { connection_id: id.to_string() },
                debounce_ms: 0.0,
            });
        }
        return out;
    }
    if workbook_ids.is_empty() && !next.active() {
        return out;
    }
    if *change != ConnectionChange::ParamsCommitted {
        let next_params = params_value(next.params());
        let next_draft = next.params_draft().map(params_value);
        let activated = !prev.active && next.active();
        if !connection_params_share_equal(&prev.params, &next_params) || activated {
            params_writes(id, next, workbook_ids, &mut out.writes);
        } else if !same_params(prev.params_draft.as_ref(), next_draft.as_ref())
            || prev.name.as_deref() != next.name()
            || prev.cache_query_results != next.cache_query_results()
        {
            out.writes.push(ConnectionWrite {
                key: connection_entry_key(id),
                task: WriteTask::WriteConnectionEntry { entry: connection_entry(id, next) },
                debounce_ms: CONNECTION_DRAFT_WRITE_DEBOUNCE_MS,
            });
        }
    }
    if !next.active() {
        return out;
    }
    let durable = catalog_is_durable(next.params());
    let file = |file_name: &str, text: TextSource| ConnectionWrite {
        key: connection_file_key(id, file_name),
        task: WriteTask::WriteConnectionFile { connection_id: id.to_string(), file_name: file_name.to_string(), text },
        debounce_ms: CONNECTION_WRITE_DEBOUNCE_MS,
    };
    if let ConnectionChange::CatalogUpdateFinished { status, refreshed, changed } = change {
        let succeeded = matches!(status, CatalogUpdateTaskStatus::Succeeded | CatalogUpdateTaskStatus::PartiallySucceeded);
        // A lookup that changed nothing has nothing to save
        if succeeded && durable && next.catalog_updates().described && (*refreshed || *changed != Some(false)) {
            let catalog = next.catalog().clone();
            let entry_id = next.relation_entry_id();
            // A reset cleared the catalog in the meantime, what is on disk is better than nothing
            let read = TextSource::Read(Box::new(move || Ok(relations_file_of_entry(&catalog.borrow(), entry_id))));
            out.writes.push(file(CATALOG_RELATIONS_FILE, read));
        }
        // Only a full refresh reads the functions
        if succeeded && *refreshed {
            let functions = next.function_script().map(|script| script.to_text()).unwrap_or_default();
            out.writes.push(file(CATALOG_FUNCTIONS_FILE, TextSource::Text(functions)));
        }
    }
    // Statements and the updates that answer them change what the relations don't say. A relation stays pending until
    // an update answered, so that a restart in between asks again.
    let answers = matches!(change, ConnectionChange::RelationsTouched | ConnectionChange::CatalogUpdateFinished { .. });
    if durable && answers {
        let state = CatalogStateFile::of_catalog(next.catalog_updates().pending_relations(), &next.catalog().borrow());
        out.writes.push(file(CATALOG_STATE_FILE, TextSource::Text(state.to_json())));
    }
    out
}

/// Schedule the writes after a change of a connection
pub fn schedule_connection_writes<W: StorageHost>(writer: &StorageWriter<W>, writes: ConnectionWrites, connection_id: &str) {
    if writes.cancel_file_writes {
        writer.cancel_pending_connection_file_writes(connection_id);
    }
    for write in writes.writes {
        // The outcome of a debounced write is not awaited, a save awaits its own writes
        drop(writer.write(&write.key, write.task, write.debounce_ms));
    }
}

/// The params that saving a connection writes: the given ones, else the draft, else the params, without the rows of
/// the form
pub fn saved_params(state: &ConnectionState, given: Option<&ConnectionParams>) -> ConnectionParams {
    given.or(state.params_draft()).unwrap_or(state.params()).without_draft_rows()
}

/// The entry of the app manifest that saving a connection writes: the saved params and no draft
pub fn saved_entry(connection_id: &str, state: &ConnectionState, params: &ConnectionParams) -> Value {
    let mut entry = connection_entry(connection_id, state);
    if let Some(fields) = entry.as_object_mut() {
        fields.shift_remove("paramsDraft");
        fields.insert("params".into(), params_value(params));
    }
    entry
}

/// The outcome of saving a connection
pub struct ConnectionSaveOutcome {
    /// The outcome of writing the app manifest, the connection is saved if it was written
    pub manifest: WriteOutcome,
    /// The outcomes of writing the copies of the workbooks, none if the manifest wasn't written
    pub workbooks: Vec<(String, WriteOutcome)>,
}

/// Write the copies of the saved params of a connection into workbooks, right away
pub async fn write_workbook_copies<W: StorageHost>(
    writer: &StorageWriter<W>,
    connection_id: &str,
    params: &Value,
    workbook_ids: &[String],
) -> Vec<(String, WriteOutcome)> {
    let copy = workbook_copy(connection_id, params);
    let pending: Vec<_> = workbook_ids
        .iter()
        .map(|workbook_id| {
            let task = WriteTask::PatchWorkbookConnection { workbook_id: workbook_id.clone(), copy: copy.clone(), replaced: Vec::new() };
            (workbook_id.clone(), writer.write_durable(&workbook_connection_copy_key(workbook_id, connection_id), task))
        })
        .collect();
    let mut out = Vec::with_capacity(pending.len());
    for (workbook_id, result) in pending {
        out.push((workbook_id, result.await));
    }
    out
}

/// Save a connection: write its entry of the app manifest first, the same key replaces pending draft writes, then
/// commit the params (`commit`) and write the copies of the workbooks. A partial failure heals forward: the next
/// restore rewrites stale copies from the manifest.
pub async fn save_connection<W: StorageHost>(
    writer: &StorageWriter<W>,
    connection_id: &str,
    entry: Value,
    params: &Value,
    workbook_ids: &[String],
    commit: impl FnOnce(),
) -> ConnectionSaveOutcome {
    let manifest = writer.write_durable(&connection_entry_key(connection_id), WriteTask::WriteConnectionEntry { entry }).await;
    if !matches!(manifest, WriteOutcome::Written) {
        return ConnectionSaveOutcome { manifest, workbooks: Vec::new() };
    }
    commit();
    let workbooks = write_workbook_copies(writer, connection_id, params, workbook_ids).await;
    ConnectionSaveOutcome { manifest, workbooks }
}
