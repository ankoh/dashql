//! The wasm-bindgen API of the restore of the stored state (`dashql_core_runtime::restore`).
//!
//! The host is the host of the storage writer with the reads of the restore (`RestoreHost`), the restore writes through
//! a `StorageWriter` of the module. The restored connections and workbooks cross as the classes of the module
//! (`Connection`, `Workbook`), what the registries need next to them and the progress as views (`view.rs`).

use std::future::Future;

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_core::catalog::{Catalog as CoreCatalog, EntryIdSource};
use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::connections::ConnectionState;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::restore::{
    AppRestore as RuntimeRestore, LiveConnection, RestoreHost, RestoreOptions, RestoreProgress, RestoredState as RuntimeState,
};
use dashql_core_runtime::storage::{ConnectionsUpdate, StorageHost, WriteStatistics};
use dashql_core_runtime::workbook::Workbook as RuntimeWorkbook;
use dashql_core_runtime::workbook_format::restore::RestoreConnection;
use js_sys::Promise;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::future_to_promise;

use super::connection::Connection;
use super::storage_writer::{host_call, JsHost, JsStorageWriterHost, StorageWriter};
use super::views::{from_js, to_js, JsonValue};
use super::workbook::view::WorkbookDataFile;
use super::workbook::{connection as script_connection, Workbook};
use super::{Catalog, ENTRY_IDS};

mod view;

use view::{RestoreProgress as ProgressView, RestoreScriptFile, RestoredStateView};

#[wasm_bindgen(typescript_custom_section)]
const RESTORE_HOST: &str = r#"
/** The host of a restore: the host of a storage writer and the reads of the restore */
export interface RestoreHost extends StorageWriterHost {
    /** Does the storage own the connections? A storage of a single workbook folder doesn't. */
    ownsConnections(): boolean;
    /** A fresh UUID */
    newUuid(): string;
    /** The workbooks of the workbook tree in the order of the sidebar, as their ids */
    listWorkbooks(): Promise<string[]>;
    /** The connection entries of the app manifest, null if the manifest has none */
    loadManifestConnections(): Promise<unknown[] | null>;
    /** The script files of a workbook */
    loadScripts(workbookId: string): Promise<RestoreScriptFile[]>;
    /** The data files of a workbook */
    listDataFiles(workbookId: string): Promise<WorkbookDataFile[]>;
    /** A file of a connection, null if it doesn't exist */
    loadConnectionFile(connectionId: string, fileName: string): Promise<string | null>;
    /** The progress of the restore changed */
    restoreProgress(progress: RestoreProgress): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "RestoreHost")]
    #[derive(Clone)]
    pub type JsRestoreHost;

    #[wasm_bindgen(method, catch, js_name = ownsConnections)]
    fn owns_connections(this: &JsRestoreHost) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = newUuid)]
    fn new_uuid(this: &JsRestoreHost) -> Result<String, JsValue>;
    #[wasm_bindgen(method, catch, js_name = listWorkbooks)]
    fn list_workbooks(this: &JsRestoreHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = loadManifestConnections)]
    fn load_manifest_connections(this: &JsRestoreHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = loadScripts)]
    fn load_scripts(this: &JsRestoreHost, workbook_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = listDataFiles)]
    fn list_data_files(this: &JsRestoreHost, workbook_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = loadConnectionFile)]
    fn load_connection_file(this: &JsRestoreHost, connection_id: &str, file_name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = restoreProgress)]
    fn restore_progress(this: &JsRestoreHost, progress: &JsValue) -> Result<(), JsValue>;
}

/// The views of a list that the host handed over
fn items<T: DeserializeOwned>(value: JsValue, what: &str) -> Result<Vec<T>, HostError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| HostError::new(format!("{what} can't be read: {e}")))
}

/// The host of the restore over the JS object: the storage operations of the writer and the reads of the restore
struct JsRestore {
    base: JsHost,
    host: JsRestoreHost,
}

impl Host for JsRestore {
    fn now(&self) -> f64 {
        self.base.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.base.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.base.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.base.log(level, message, details);
    }
}

impl StorageHost for JsRestore {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        self.base.load_workbook(workbook_id).await
    }
    async fn save_workbook(&self, workbook_id: &str, workbook: &Value) -> Result<(), HostError> {
        self.base.save_workbook(workbook_id, workbook).await
    }
    async fn save_script(&self, workbook_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        self.base.save_script(workbook_id, file_name, text).await
    }
    async fn delete_script(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError> {
        self.base.delete_script(workbook_id, file_name).await
    }
    async fn rename_script(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError> {
        self.base.rename_script(workbook_id, from, to).await
    }
    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        self.base.list_attachments(workbook_id).await
    }
    async fn update_connections(&self, update: ConnectionsUpdate) -> Result<(), HostError> {
        self.base.update_connections(update).await
    }
    async fn save_connection_file(&self, connection_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        self.base.save_connection_file(connection_id, file_name, text).await
    }
    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError> {
        self.base.delete_connection_files(connection_id).await
    }
    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError> {
        self.base.delete_workbook(workbook_id).await
    }
    fn statistics_changed(&self, key: &str, statistics: &WriteStatistics) {
        self.base.statistics_changed(key, statistics);
    }
    fn external_script_change(&self, workbook_id: &str) {
        self.base.external_script_change(workbook_id);
    }
}

impl RestoreHost for JsRestore {
    fn owns_connections(&self) -> bool {
        self.host.owns_connections().unwrap_or(false)
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        items(host_call(self.host.list_workbooks()).await?, "the workbooks")
    }

    async fn load_manifest_connections(&self) -> Result<Option<Vec<Value>>, HostError> {
        match JsonValue::of(&host_call(self.host.load_manifest_connections()).await?).0 {
            Value::Array(entries) => Ok(Some(entries)),
            _ => Ok(None),
        }
    }

    async fn load_scripts(&self, workbook_id: &str) -> Result<Vec<(String, String)>, HostError> {
        let scripts: Vec<RestoreScriptFile> = items(host_call(self.host.load_scripts(workbook_id)).await?, "the scripts")?;
        Ok(scripts.into_iter().map(|script| (script.name, script.sql)).collect())
    }

    async fn list_data_files(&self, workbook_id: &str) -> Result<Vec<DataFile>, HostError> {
        let files: Vec<WorkbookDataFile> = items(host_call(self.host.list_data_files(workbook_id)).await?, "the data files")?;
        Ok(files.into_iter().map(DataFile::from).collect())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        Ok(host_call(self.host.load_connection_file(connection_id, file_name)).await?.as_string())
    }

    fn restore_progress(&self, progress: &RestoreProgress) {
        if let Ok(progress) = to_js(&ProgressView::from(progress)) {
            let _ = self.host.restore_progress(&progress.into());
        }
    }
}

/// What a restore restored. The connections and workbooks are taken out once, by index.
#[wasm_bindgen]
pub struct RestoredState {
    connections: Vec<Option<ConnectionState>>,
    workbooks: Vec<Option<RuntimeWorkbook>>,
    view: RestoredStateView,
}

impl From<RuntimeState> for RestoredState {
    fn from(state: RuntimeState) -> Self {
        let view = RestoredStateView::from(&state);
        RestoredState {
            connections: state.connections.into_iter().map(Some).collect(),
            workbooks: state.workbooks.into_iter().map(|workbook| Some(workbook.workbook)).collect(),
            view,
        }
    }
}

#[wasm_bindgen]
impl RestoredState {
    /// The connections, the workbooks and the invalid workbooks in the order of the indexes, and the progress
    pub fn view(&self) -> Result<Ts<RestoredStateView>, JsError> {
        to_js(&self.view)
    }

    /// Take a restored connection, none if it was taken
    #[wasm_bindgen(js_name = takeConnection)]
    pub fn take_connection(&mut self, index: u32) -> Option<Connection> {
        self.connections.get_mut(index as usize).and_then(Option::take).map(Connection::from_state)
    }

    /// Take a restored workbook, none if it was taken
    #[wasm_bindgen(js_name = takeWorkbook)]
    pub fn take_workbook(&mut self, index: u32) -> Option<Workbook> {
        self.workbooks.get_mut(index as usize).and_then(Option::take).map(Workbook::from_runtime)
    }
}

/// A restore of the stored state, it runs once
#[wasm_bindgen]
pub struct AppRestore {
    restore: Option<RuntimeRestore<JsRestore, JsHost>>,
}

#[wasm_bindgen]
impl AppRestore {
    /// A restore that reads through a host and writes through a storage writer, the editors of the restored workbooks
    /// count offsets in `offset_unit`
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsRestoreHost, writer: &StorageWriter, offset_unit: u8) -> AppRestore {
        let base = JsHost { host: host.clone().unchecked_into::<JsStorageWriterHost>() };
        let uuids = host.clone();
        let options = RestoreOptions {
            offset_unit: EditorOffsetUnit(offset_unit),
            new_catalog: Box::new(|| CoreCatalog::with_entry_ids(ENTRY_IDS.with(EntryIdSource::clone))),
            new_uuid: Box::new(move || uuids.new_uuid().unwrap_or_default()),
        };
        let restore = RuntimeRestore::new(JsRestore { base, host }, writer.runtime(), options);
        AppRestore { restore: Some(restore) }
    }

    /// A connection that the app holds already: its stored params and the connection of its scripts
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = addLiveConnection)]
    pub fn add_live_connection(
        &mut self,
        connection_id: &str,
        stored_params: Ts<JsonValue>,
        catalog: &Catalog,
        dialect: u8,
        local: bool,
        params: Option<String>,
        default_database: &str,
        default_schema: &str,
    ) -> Result<(), JsError> {
        let restore = self.restore.as_mut().ok_or_else(|| JsError::new("the restore ran already"))?;
        let stored = from_js(&stored_params)?.0;
        let script_connection = script_connection(connection_id, catalog, dialect, local, params, default_database, default_schema);
        let connection = RestoreConnection {
            connection_id: connection_id.to_string(),
            params: stored,
            params_draft: None,
            name: None,
            cache_query_results: None,
        };
        restore.add_live_connection(LiveConnection { connection, script_connection });
        Ok(())
    }

    /// Restore the connections of the app manifest and the workbooks of the workbook tree, resolves with a
    /// `RestoredState`
    pub fn restore(&mut self) -> Result<Promise, JsError> {
        let restore = self.restore.take().ok_or_else(|| JsError::new("the restore ran already"))?;
        Ok(future_to_promise(async move { Ok(RestoredState::from(restore.restore().await).into()) }))
    }

    /// Restore a single stored workbook against the live connections, resolves with a `RestoredState` and rejects if
    /// the workbook can't be restored
    #[wasm_bindgen(js_name = restoreWorkbook)]
    pub fn restore_workbook(&mut self, workbook_id: String) -> Result<Promise, JsError> {
        let restore = self.restore.take().ok_or_else(|| JsError::new("the restore ran already"))?;
        Ok(future_to_promise(async move {
            match restore.restore_workbook(&workbook_id).await {
                Ok(state) => Ok(RestoredState::from(state).into()),
                Err(error) => Err(JsError::new(&error.message).into()),
            }
        }))
    }
}
