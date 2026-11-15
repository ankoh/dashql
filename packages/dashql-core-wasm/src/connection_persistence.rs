//! The wasm-bindgen API of the persistence of connections (`dashql_core_runtime::connection_persistence`).
//!
//! The registry of the app applies the actions of a connection, the module decides what storage keeps of the change and
//! writes it through a `StorageWriter` of the module. The persisted fields of the connection before the change, the
//! change and the outcomes cross as views (`view.rs`).

use dashql_core_runtime::connection_persistence::{
    connection_writes, save_connection, saved_entry, saved_params, schedule_connection_writes, write_workbook_copies,
    ConnectionChange, ConnectionWrite, ConnectionWrites, PersistedConnection,
};
use dashql_core_runtime::connections::{CatalogUpdateVariant, ConnectionState};
use dashql_core_runtime::storage::keys::connection_entry_key;
use dashql_core_runtime::storage::WriteTask;
use js_sys::{Function, Promise};
use serde_json::Value;
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::connection::view::JsonParams;
use super::connection::Connection;
use super::js_error;
use super::storage_writer::StorageWriter;
use super::views::{from_js, to_js, value_to_js, JsonValue};

mod view;

use view::{ConnectionPersistenceChange, ConnectionSaveOutcome, PersistedConnectionFields};

/// The change of the runtime, an update that the connection doesn't know counts as a refresh
fn change(change: ConnectionPersistenceChange, state: &ConnectionState) -> ConnectionChange {
    type C = ConnectionPersistenceChange;
    match change {
        C::Other => ConnectionChange::Other,
        C::ParamsCommitted => ConnectionChange::ParamsCommitted,
        C::RelationsTouched => ConnectionChange::RelationsTouched,
        C::CatalogUpdateFinished { task_id, status, changed } => {
            let task = state.catalog_updates().tasks_finished.get(&task_id);
            let refreshed = task.is_none_or(|task| task.variant != CatalogUpdateVariant::RelationRefresh);
            ConnectionChange::CatalogUpdateFinished { status: status.into(), refreshed, changed }
        }
    }
}

/// The persistence of connections
#[wasm_bindgen]
pub struct ConnectionPersistence;

#[wasm_bindgen]
impl ConnectionPersistence {
    /// Schedule the writes after a change of the connection `connection_id` that the workbooks `workbook_ids` reference.
    /// `prev` holds the persisted fields before the change. The id comes with the call, a connection that the app
    /// created holds none.
    #[wasm_bindgen(js_name = scheduleWrites)]
    pub fn schedule_writes(
        writer: &StorageWriter,
        connection: &Connection,
        connection_id: &str,
        prev: Ts<PersistedConnectionFields>,
        change: Ts<ConnectionPersistenceChange>,
        workbook_ids: Vec<String>,
    ) -> Result<(), JsError> {
        let state = connection.state();
        let prev = PersistedConnection::from(from_js(&prev)?);
        if prev.params.is_null() {
            return Err(JsError::new("invalid persisted connection: the params are missing"));
        }
        let change = self::change(from_js(&change)?, &state);
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

    /// Save a connection: the given params, else its draft, else its params. Writes the app manifest, calls `commit`
    /// with the saved params once it is written, then writes the copies of the workbooks. Resolves with a
    /// `ConnectionSaveOutcome`.
    pub fn save(
        writer: &StorageWriter,
        connection: &Connection,
        connection_id: String,
        saved: Option<Ts<JsonParams>>,
        workbook_ids: Vec<String>,
        commit: Function,
    ) -> Result<Promise, JsError> {
        let state = connection.state();
        let given = saved.map(|saved| from_js(&saved)?.connection_params().map_err(js_error)).transpose()?;
        let params = saved_params(&state, given.as_ref());
        let entry = saved_entry(&connection_id, &state, &params);
        let params = JsonValue(Value::Object(params.to_object()));
        let commit_params = to_js(&params)?;
        let writer = writer.runtime();
        Ok(future_to_promise(async move {
            let outcome = save_connection(&writer, &connection_id, entry, &params.0, &workbook_ids, move || {
                // A commit that throws leaves the copies as they are, the next restore heals them
                let _ = commit.call1(&JsValue::NULL, &JsValue::from(commit_params));
            })
            .await;
            let workbooks = view::copies(outcome.workbooks);
            let outcome = ConnectionSaveOutcome { params, manifest: outcome.manifest.into(), workbooks };
            Ok(to_js(&outcome).map_err(JsValue::from)?.into())
        }))
    }

    /// Write the copies of saved params of a connection into workbooks again, resolves with a `ConnectionCopyOutcome[]`
    #[wasm_bindgen(js_name = writeCopies)]
    pub fn write_copies(
        writer: &StorageWriter,
        connection_id: String,
        params: Ts<JsonValue>,
        workbook_ids: Vec<String>,
    ) -> Result<Promise, JsError> {
        let params = from_js(&params)?.0;
        let writer = writer.runtime();
        Ok(future_to_promise(async move {
            let copies = view::copies(write_workbook_copies(&writer, &connection_id, &params, &workbook_ids).await);
            Ok(value_to_js(&copies)?)
        }))
    }
}
