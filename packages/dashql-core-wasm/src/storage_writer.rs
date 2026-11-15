//! The wasm-bindgen API of the storage writer (`dashql_runtime::storage::writer`).
//!
//! The host is a JavaScript object whose methods return promises (`StorageWriterHost`), the tasks of the writer run on
//! the event loop with `wasm-bindgen-futures`. Workbooks and connection entries cross as JSON text. A task comes as
//! JSON, a text that is read when the write runs is `{ "reader": <index> }` into the functions that come with it. A
//! rejected host call fails the write with the value it rejected with, the outcome of a write hands it back.

use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_runtime::storage::{
    ConnectionsUpdate, StorageHost, StorageWriter as RuntimeStorageWriter, TextSource, WriteError, WriteOutcome,
    WriteStatistics, WriteTask,
};
use js_sys::{Array, Function, Object, Promise, Reflect};
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

#[wasm_bindgen(typescript_custom_section)]
const STORAGE_WRITER_HOST: &str = r#"
/** The host of a storage writer: the clock, timers, the log and the storage. Workbooks cross as JSON text. */
export interface StorageWriterHost {
    /** The time in milliseconds since the epoch */
    now(): number;
    /** Call back after a duration in milliseconds */
    setTimer(ms: number, callback: () => void): unknown;
    clearTimer(timer: unknown): void;
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void;
    /** The workbook file as JSON, rejects if there is none */
    loadWorkbook(workbookId: string): Promise<string>;
    saveWorkbook(workbookId: string, workbook: string): Promise<void>;
    /** Rejects with an `ExternalScriptChangeError` (by its name, with `workbookId` and `fileName`) if the file changed outside the app */
    saveScript(workbookId: string, fileName: string, text: string): Promise<void>;
    deleteScript(workbookId: string, fileName: string): Promise<void>;
    renameScript(workbookId: string, from: string, to: string): Promise<void>;
    /** The names of the attachments in natural order */
    listAttachments(workbookId: string): Promise<string[]>;
    /** Update the connection entries of the app manifest exclusively. The update gets the entries as JSON, null before the connections were migrated, and returns the new ones, null if nothing changed. */
    updateConnections(update: (connections: string | null) => string | null): Promise<void>;
    saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void>;
    deleteConnectionFiles(connectionId: string): Promise<void>;
    deleteWorkbook(workbookId: string): Promise<void>;
    /** The statistics of a key changed */
    statisticsChanged(key: string, scheduledWrites: number, writes: number, writtenBytes: number, writeTimeMs: number, lastWriteMs: number | undefined): void;
    /** The writes of a workbook are held because one of its scripts changed outside the app */
    externalScriptChange(workbookId: string): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "StorageWriterHost")]
    #[derive(Clone)]
    pub type JsStorageWriterHost;

    #[wasm_bindgen(method, catch)]
    fn now(this: &JsStorageWriterHost) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = setTimer)]
    fn set_timer(this: &JsStorageWriterHost, ms: f64, callback: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = clearTimer)]
    fn clear_timer(this: &JsStorageWriterHost, timer: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn log(this: &JsStorageWriterHost, level: &str, message: &str, details: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = loadWorkbook)]
    fn load_workbook(this: &JsStorageWriterHost, workbook_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = saveWorkbook)]
    fn save_workbook(this: &JsStorageWriterHost, workbook_id: &str, workbook: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = saveScript)]
    fn save_script(this: &JsStorageWriterHost, workbook_id: &str, file_name: &str, text: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = deleteScript)]
    fn delete_script(this: &JsStorageWriterHost, workbook_id: &str, file_name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = renameScript)]
    fn rename_script(this: &JsStorageWriterHost, workbook_id: &str, from: &str, to: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = listAttachments)]
    fn list_attachments(this: &JsStorageWriterHost, workbook_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = updateConnections)]
    fn update_connections(this: &JsStorageWriterHost, update: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = saveConnectionFile)]
    fn save_connection_file(this: &JsStorageWriterHost, connection_id: &str, file_name: &str, text: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = deleteConnectionFiles)]
    fn delete_connection_files(this: &JsStorageWriterHost, connection_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = deleteWorkbook)]
    fn delete_workbook(this: &JsStorageWriterHost, workbook_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = statisticsChanged)]
    fn statistics_changed(
        this: &JsStorageWriterHost,
        key: &str,
        scheduled_writes: f64,
        writes: f64,
        written_bytes: f64,
        write_time_ms: f64,
        last_write_ms: Option<f64>,
    ) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = externalScriptChange)]
    fn external_script_change(this: &JsStorageWriterHost, workbook_id: &str) -> Result<(), JsValue>;
}

/// The message of a value that JS failed with
fn message_of(value: &JsValue) -> String {
    if let Some(error) = value.dyn_ref::<js_sys::Error>() {
        return String::from(error.message());
    }
    value.as_string().unwrap_or_else(|| "the host failed".to_string())
}

fn string_field(value: &JsValue, name: &str) -> Option<String> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().and_then(|v| v.as_string())
}

/// A host error that keeps what JS failed with
fn host_error(value: JsValue) -> HostError {
    let error = if string_field(&value, "name").as_deref() == Some("ExternalScriptChangeError") {
        let workbook_id = string_field(&value, "workbookId").unwrap_or_default();
        let file_name = string_field(&value, "fileName").unwrap_or_default();
        HostError::external_script_change(workbook_id, file_name)
    } else {
        HostError::new(message_of(&value))
    };
    error.with_value(Rc::new(value))
}

/// What a host error hands back to JS: the value the host failed with, or an error with its message
fn error_value(error: &HostError) -> JsValue {
    error
        .value()
        .and_then(|value| value.downcast_ref::<JsValue>())
        .cloned()
        .unwrap_or_else(|| JsError::new(error.message()).into())
}

/// Await a host call that returns a promise
async fn host_call(result: Result<JsValue, JsValue>) -> Result<JsValue, HostError> {
    let value = result.map_err(host_error)?;
    JsFuture::from(Promise::resolve(&value)).await.map_err(host_error)
}

/// A timer of the host, dropping it clears the timer
struct JsSleep {
    future: JsFuture,
    timer: JsValue,
    host: JsStorageWriterHost,
}

impl Future for JsSleep {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        Pin::new(&mut self.future).poll(cx).map(|_| ())
    }
}

impl Drop for JsSleep {
    fn drop(&mut self) {
        let _ = self.host.clear_timer(&self.timer);
    }
}

/// The host of the writer over the JS object
pub struct JsHost {
    host: JsStorageWriterHost,
}

impl Host for JsHost {
    fn now(&self) -> f64 {
        self.host.now().unwrap_or_default()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let mut timer = JsValue::UNDEFINED;
        let host = self.host.clone();
        let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
            // A host that can't set a timer never fires it, the task stays pending until a flush
            timer = host.set_timer(ms, &resolve).unwrap_or(JsValue::UNDEFINED);
        });
        JsSleep { future: JsFuture::from(promise), timer, host }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details: Map<String, Value> = details.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect();
        let details = serde_json::to_string(&details).unwrap_or_default();
        let _ = self.host.log(level.name(), message, &details);
    }
}

impl StorageHost for JsHost {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        let text = host_call(self.host.load_workbook(workbook_id)).await?;
        let text = text.as_string().ok_or_else(|| HostError::new(format!("the workbook file of {workbook_id} is not JSON text")))?;
        serde_json::from_str(&text).map_err(|e| HostError::new(format!("invalid workbook file of {workbook_id}: {e}")))
    }

    async fn save_workbook(&self, workbook_id: &str, workbook: &Value) -> Result<(), HostError> {
        let text = serde_json::to_string(workbook).map_err(|e| HostError::new(e.to_string()))?;
        host_call(self.host.save_workbook(workbook_id, &text)).await.map(|_| ())
    }

    async fn save_script(&self, workbook_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        host_call(self.host.save_script(workbook_id, file_name, text)).await.map(|_| ())
    }

    async fn delete_script(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError> {
        host_call(self.host.delete_script(workbook_id, file_name)).await.map(|_| ())
    }

    async fn rename_script(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError> {
        host_call(self.host.rename_script(workbook_id, from, to)).await.map(|_| ())
    }

    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        let names = host_call(self.host.list_attachments(workbook_id)).await?;
        if !Array::is_array(&names) {
            return Err(HostError::new(format!("the attachments of {workbook_id} are not a list")));
        }
        Ok(Array::from(&names).iter().filter_map(|name| name.as_string()).collect())
    }

    async fn update_connections(&self, mut update: ConnectionsUpdate) -> Result<(), HostError> {
        let closure = Closure::<dyn FnMut(JsValue) -> JsValue>::new(move |connections: JsValue| {
            let current = match connections.as_string() {
                Some(text) => match serde_json::from_str::<Vec<Value>>(&text) {
                    Ok(entries) => Some(entries),
                    // Entries that the writer can't read stay as they are
                    Err(_) => return JsValue::NULL,
                },
                None => None,
            };
            match update(current).and_then(|next| serde_json::to_string(&next).ok()) {
                Some(next) => JsValue::from_str(&next),
                None => JsValue::NULL,
            }
        });
        let result = host_call(self.host.update_connections(closure.as_ref().unchecked_ref())).await;
        // The host called the update before its promise settled
        drop(closure);
        result.map(|_| ())
    }

    async fn save_connection_file(&self, connection_id: &str, file_name: &str, text: &str) -> Result<(), HostError> {
        host_call(self.host.save_connection_file(connection_id, file_name, text)).await.map(|_| ())
    }

    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError> {
        host_call(self.host.delete_connection_files(connection_id)).await.map(|_| ())
    }

    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError> {
        host_call(self.host.delete_workbook(workbook_id)).await.map(|_| ())
    }

    fn statistics_changed(&self, key: &str, statistics: &WriteStatistics) {
        let _ = self.host.statistics_changed(
            key,
            statistics.scheduled_writes as f64,
            statistics.writes as f64,
            statistics.written_bytes as f64,
            statistics.write_time_ms,
            statistics.last_write_ms,
        );
    }

    fn external_script_change(&self, workbook_id: &str) {
        let _ = self.host.external_script_change(workbook_id);
    }
}

// Reading the tasks of the host

fn invalid(message: String) -> JsError {
    JsError::new(&format!("invalid write task: {message}"))
}

fn str_at(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn opt_str_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn bool_at(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn items(value: &Value, key: &str) -> Vec<Value> {
    value.get(key).and_then(Value::as_array).cloned().unwrap_or_default()
}

fn present(value: &Value, key: &str) -> Option<Value> {
    value.get(key).filter(|v| !v.is_null()).cloned()
}

/// A text of a task: the text, or `{ "reader": <index> }` into the readers
fn text_source(value: Option<&Value>, readers: &Array) -> Result<TextSource, JsError> {
    match value {
        Some(Value::String(text)) => Ok(TextSource::Text(text.clone())),
        Some(Value::Object(fields)) => {
            let index = fields.get("reader").and_then(Value::as_u64).and_then(|i| u32::try_from(i).ok());
            let reader = index
                .map(|i| readers.get(i))
                .and_then(|reader| reader.dyn_into::<Function>().ok())
                .ok_or_else(|| invalid("a text names a reader that is not there".to_string()))?;
            Ok(TextSource::Read(Box::new(move || reader.call0(&JsValue::NULL).map(|text| text.as_string()).map_err(host_error))))
        }
        _ => Err(invalid("a text is neither a string nor a reader".to_string())),
    }
}

fn parse_task(json: &str, readers: &Array) -> Result<WriteTask, JsError> {
    let task: Value = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;
    let workbook_id = str_at(&task, "workbookId");
    Ok(match str_at(&task, "type").as_str() {
        "writeWorkbookManifest" => WriteTask::WriteWorkbookManifest {
            workbook_id,
            connections: items(&task, "connections"),
            ephemeral: bool_at(&task, "ephemeral"),
        },
        "writeWorkbookProperties" => WriteTask::WriteWorkbookProperties {
            workbook_id,
            name: opt_str_at(&task, "name"),
            ephemeral: bool_at(&task, "ephemeral"),
            cloud: present(&task, "cloud"),
        },
        "replaceWorkbookScripts" => {
            let mut scripts = Vec::new();
            for script in items(&task, "scripts") {
                scripts.push((str_at(&script, "fileName"), text_source(script.get("text"), readers)?));
            }
            WriteTask::ReplaceWorkbookScripts {
                workbook_id,
                name: opt_str_at(&task, "name"),
                scripts,
                connection: present(&task, "connection"),
                original_file_name: opt_str_at(&task, "originalFileName"),
            }
        }
        "writeConnectionEntry" => WriteTask::WriteConnectionEntry {
            entry: present(&task, "entry").ok_or_else(|| invalid("a connection entry is missing".to_string()))?,
        },
        "deleteConnectionEntry" => WriteTask::DeleteConnectionEntry { connection_id: str_at(&task, "connectionId") },
        "writeConnectionFile" => WriteTask::WriteConnectionFile {
            connection_id: str_at(&task, "connectionId"),
            file_name: str_at(&task, "fileName"),
            text: text_source(task.get("text"), readers)?,
        },
        "patchWorkbookConnection" => WriteTask::PatchWorkbookConnection {
            workbook_id,
            copy: present(&task, "copy").ok_or_else(|| invalid("a connection copy is missing".to_string()))?,
            replaced: items(&task, "replaced").iter().filter_map(Value::as_str).map(str::to_string).collect(),
        },
        "writeScript" => WriteTask::WriteScript { workbook_id, file_name: str_at(&task, "fileName"), text: str_at(&task, "text") },
        "deleteScript" => WriteTask::DeleteScript { workbook_id, file_name: str_at(&task, "fileName") },
        "renameScript" => WriteTask::RenameScript { workbook_id, from: str_at(&task, "from"), to: str_at(&task, "to") },
        "writeWorkbookScripts" => WriteTask::WriteWorkbookScripts {
            workbook_id,
            scripts: items(&task, "scripts"),
            connections: items(&task, "connections"),
        },
        "refreshWorkbookAttachments" => WriteTask::RefreshWorkbookAttachments { workbook_id },
        other => return Err(invalid(format!("unknown type {other:?}"))),
    })
}

/// The outcome of a write for JS: `{ status, error?, unavailableWorkbook? }`
fn outcome_value(outcome: WriteOutcome) -> JsValue {
    let object = Object::new();
    let set = |key: &str, value: &JsValue| {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    };
    let status = match outcome {
        WriteOutcome::Written => "written",
        WriteOutcome::Superseded => "superseded",
        WriteOutcome::Cancelled => "cancelled",
        WriteOutcome::Deferred => "deferred",
        WriteOutcome::Failed(WriteError::Host(error)) => {
            set("error", &error_value(&error));
            "failed"
        }
        WriteOutcome::Failed(WriteError::WorkbookUnavailable { workbook_id, cause }) => {
            set("error", &error_value(&cause));
            set("unavailableWorkbook", &JsValue::from_str(&workbook_id));
            "failed"
        }
    };
    set("status", &JsValue::from_str(status));
    object.into()
}

/// The storage writer of the runtime, see `dashql_runtime::storage::writer`
#[wasm_bindgen]
pub struct StorageWriter {
    writer: RuntimeStorageWriter<JsHost>,
}

#[wasm_bindgen]
impl StorageWriter {
    /// A writer on a host that writes workbook files of a format version
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsStorageWriterHost, format_version: u32) -> StorageWriter {
        StorageWriter { writer: RuntimeStorageWriter::new(JsHost { host }, u64::from(format_version)) }
    }

    /// Schedule a debounced write, the promise resolves with its outcome
    pub fn write(&self, key: &str, task: &str, readers: &Array, debounce_ms: f64) -> Result<Promise, JsError> {
        let result = self.writer.write(key, parse_task(task, readers)?, debounce_ms);
        Ok(future_to_promise(async move { Ok(outcome_value(result.await)) }))
    }

    /// Write right away, after the running tasks of the chain of the key
    #[wasm_bindgen(js_name = writeDurable)]
    pub fn write_durable(&self, key: &str, task: &str, readers: &Array) -> Result<Promise, JsError> {
        let result = self.writer.write_durable(key, parse_task(task, readers)?);
        Ok(future_to_promise(async move { Ok(outcome_value(result.await)) }))
    }

    pub fn flush(&self) -> Promise {
        let flush = self.writer.flush();
        future_to_promise(async move {
            flush.await;
            Ok(JsValue::UNDEFINED)
        })
    }

    #[wasm_bindgen(js_name = flushWorkbook)]
    pub fn flush_workbook(&self, workbook_id: &str) -> Promise {
        let flush = self.writer.flush_workbook(workbook_id);
        future_to_promise(async move { Ok(JsValue::from_bool(flush.await)) })
    }

    pub fn settle(&self) -> Promise {
        let settle = self.writer.settle();
        future_to_promise(async move {
            settle.await;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// Delete a workbook, the promise rejects with what the host failed with
    #[wasm_bindgen(js_name = deleteWorkbook)]
    pub fn delete_workbook(&self, workbook_id: &str) -> Promise {
        let deletion = self.writer.delete_workbook(workbook_id);
        future_to_promise(async move { deletion.await.map(|_| JsValue::UNDEFINED).map_err(|error| error_value(&error)) })
    }

    pub fn pause(&self) {
        self.writer.pause();
    }

    pub fn resume(&self) {
        self.writer.resume();
    }

    #[wasm_bindgen(js_name = pauseWorkbook)]
    pub fn pause_workbook(&self, workbook_id: &str) {
        self.writer.pause_workbook(workbook_id);
    }

    #[wasm_bindgen(js_name = resumeWorkbook)]
    pub fn resume_workbook(&self, workbook_id: &str) {
        self.writer.resume_workbook(workbook_id);
    }

    #[wasm_bindgen(js_name = reviveWorkbook)]
    pub fn revive_workbook(&self, workbook_id: &str) {
        self.writer.revive_workbook(workbook_id);
    }

    #[wasm_bindgen(js_name = isWorkbookPaused)]
    pub fn is_workbook_paused(&self, workbook_id: &str) -> bool {
        self.writer.is_workbook_paused(workbook_id)
    }

    /// The pending keys of a workbook, or all of them, in the order they were scheduled
    #[wasm_bindgen(js_name = pendingKeys)]
    pub fn pending_keys(&self, workbook_id: Option<String>) -> Vec<String> {
        match workbook_id {
            Some(workbook_id) => self.writer.pending_keys_for_workbook(&workbook_id),
            None => self.writer.pending_keys(),
        }
    }

    #[wasm_bindgen(js_name = cancelPendingWrites)]
    pub fn cancel_pending_writes(&self, keys: Vec<String>) {
        self.writer.cancel_pending_writes(&keys);
    }

    #[wasm_bindgen(js_name = cancelPendingConnectionFileWrites)]
    pub fn cancel_pending_connection_file_writes(&self, connection_id: &str) {
        self.writer.cancel_pending_connection_file_writes(connection_id);
    }

    /// The latest generation of the keys of a workbook as JSON, `[[key, generation], ...]`
    #[wasm_bindgen(js_name = writeGenerations)]
    pub fn write_generations(&self, workbook_id: &str) -> String {
        let generations: Vec<Value> = self
            .writer
            .write_generations_for_workbook(workbook_id)
            .into_iter()
            .map(|(key, generation)| serde_json::json!([key, generation]))
            .collect();
        serde_json::to_string(&generations).unwrap_or_default()
    }
}
