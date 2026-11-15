//! The wasm-bindgen API of the persistence of connections (`dashql_core_runtime::connection_persistence`).
//!
//! The registry of the app applies the actions of a connection, the module decides what storage keeps of the change and
//! writes it through a `StorageWriter` of the module. The persisted fields of the connection before the change and the
//! change cross as JSON.

use dashql_core_runtime::connection_persistence::{
    connection_writes, save_connection, saved_entry, saved_params, schedule_connection_writes, write_workbook_copies,
    ConnectionChange, ConnectionWrite, ConnectionWrites, PersistedConnection,
};
use dashql_core_runtime::connections::{CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionParams, ConnectionState};
use dashql_core_runtime::storage::keys::connection_entry_key;
use dashql_core_runtime::storage::{WriteOutcome, WriteTask};
use js_sys::{Array, Function, Object, Promise, Reflect};
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::connection::Connection;
use super::storage_writer::{outcome_value, StorageWriter};

fn invalid(message: impl AsRef<str>) -> JsError {
    JsError::new(message.as_ref())
}

fn parse(text: &str) -> Result<Value, JsError> {
    serde_json::from_str(text).map_err(|e| invalid(format!("invalid JSON: {e}")))
}

/// A change from its JSON: `{ type, taskId?, status?, changed? }`
fn change(text: &str, state: &ConnectionState) -> Result<ConnectionChange, JsError> {
    let value = parse(text)?;
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("other");
    Ok(match kind {
        "paramsCommitted" => ConnectionChange::ParamsCommitted,
        "relationsTouched" => ConnectionChange::RelationsTouched,
        "catalogUpdateFinished" => {
            let status = match value.get("status").and_then(Value::as_str) {
                Some("succeeded") => CatalogUpdateTaskStatus::Succeeded,
                Some("partiallySucceeded") => CatalogUpdateTaskStatus::PartiallySucceeded,
                Some("failed") => CatalogUpdateTaskStatus::Failed,
                Some("cancelled") => CatalogUpdateTaskStatus::Cancelled,
                other => return Err(invalid(format!("no final status of a catalog update: {other:?}"))),
            };
            // An update that the connection doesn't know counts as a refresh
            let task_id = value.get("taskId").and_then(Value::as_u64).and_then(|id| u32::try_from(id).ok());
            let task = task_id.and_then(|id| state.catalog_updates().tasks_finished.get(&id));
            let refreshed = task.is_none_or(|task| task.variant != CatalogUpdateVariant::RelationRefresh);
            ConnectionChange::CatalogUpdateFinished { status, refreshed, changed: value.get("changed").and_then(Value::as_bool) }
        }
        _ => ConnectionChange::Other,
    })
}

fn set(object: &Object, key: &str, value: &JsValue) {
    let _ = Reflect::set(object, &JsValue::from_str(key), value);
}

/// The outcomes of the copies of workbooks: `[{ workbookId, result }]`
fn copies_value(copies: Vec<(String, WriteOutcome)>) -> JsValue {
    let out = Array::new();
    for (workbook_id, outcome) in copies {
        let entry = Object::new();
        set(&entry, "workbookId", &JsValue::from_str(&workbook_id));
        set(&entry, "result", &outcome_value(outcome));
        out.push(&entry);
    }
    out.into()
}

/// The persistence of connections
#[wasm_bindgen]
pub struct ConnectionPersistence;

#[wasm_bindgen]
impl ConnectionPersistence {
    /// Schedule the writes after a change of the connection `connection_id` that the workbooks `workbook_ids` reference.
    /// `prev` holds the persisted fields before the change as JSON, `{active, params, paramsDraft?, name?,
    /// cacheQueryResults?}`. The id comes with the call, a connection that the app created holds none.
    #[wasm_bindgen(js_name = scheduleWrites)]
    pub fn schedule_writes(
        writer: &StorageWriter,
        connection: &Connection,
        connection_id: &str,
        prev: &str,
        change_json: &str,
        workbook_ids: Vec<String>,
    ) -> Result<(), JsError> {
        let state = connection.state();
        let prev = PersistedConnection::from_json(&parse(prev)?).ok_or_else(|| invalid("invalid persisted connection"))?;
        let change = change(change_json, &state)?;
        let writes = connection_writes(connection_id, &prev, &state, &change, &workbook_ids);
        schedule_connection_writes(&writer.runtime(), writes, connection_id);
        Ok(())
    }

    /// Schedule the writes of a deleted connection, an active one leaves the app manifest with its files
    #[wasm_bindgen(js_name = scheduleDeleteWrites)]
    pub fn schedule_delete_writes(writer: &StorageWriter, connection_id: &str, active: bool) {
        if !active {
            return;
        }
        let writes = ConnectionWrites {
            cancel_file_writes: true,
            writes: vec![ConnectionWrite {
                key: connection_entry_key(connection_id),
                task: WriteTask::DeleteConnectionEntry { connection_id: connection_id.to_string() },
                debounce_ms: 0.0,
            }],
        };
        schedule_connection_writes(&writer.runtime(), writes, connection_id);
    }

    /// Save a connection: the given params as JSON, else its draft, else its params. Writes the app manifest, calls
    /// `commit` with the saved params as JSON once it is written, then writes the copies of the workbooks. Resolves
    /// with `{ params, manifest, workbooks: [{ workbookId, result }] }`.
    pub fn save(
        writer: &StorageWriter,
        connection: &Connection,
        connection_id: String,
        saved: Option<String>,
        workbook_ids: Vec<String>,
        commit: Function,
    ) -> Result<Promise, JsError> {
        let state = connection.state();
        let given = saved.as_deref().map(ConnectionParams::from_json).transpose().map_err(|e| invalid(e.message))?;
        let params = saved_params(&state, given.as_ref());
        let entry = saved_entry(&connection_id, &state, &params);
        let params_json = params.to_json();
        let params: Value = serde_json::from_str(&params_json).unwrap_or(Value::Null);
        let writer = writer.runtime();
        Ok(future_to_promise(async move {
            let commit_params = params_json.clone();
            let outcome = save_connection(&writer, &connection_id, entry, &params, &workbook_ids, move || {
                // A commit that throws leaves the copies as they are, the next restore heals them
                let _ = commit.call1(&JsValue::NULL, &JsValue::from_str(&commit_params));
            })
            .await;
            let out = Object::new();
            set(&out, "params", &js_sys::JSON::parse(&params_json).unwrap_or(JsValue::NULL));
            set(&out, "manifest", &outcome_value(outcome.manifest));
            set(&out, "workbooks", &copies_value(outcome.workbooks));
            Ok(out.into())
        }))
    }

    /// Write the copies of saved params of a connection into workbooks again, resolves with `[{ workbookId, result }]`
    #[wasm_bindgen(js_name = writeCopies)]
    pub fn write_copies(writer: &StorageWriter, connection_id: String, params: &str, workbook_ids: Vec<String>) -> Result<Promise, JsError> {
        let params = parse(params)?;
        let writer = writer.runtime();
        Ok(future_to_promise(async move {
            Ok(copies_value(write_workbook_copies(&writer, &connection_id, &params, &workbook_ids).await))
        }))
    }
}
