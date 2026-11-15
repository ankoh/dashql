//! The wasm-bindgen API of the catalog loader (`dashql_core_runtime::catalog_loader::service`).
//!
//! The host is a JavaScript object (`CatalogLoaderHost`): the clock, timers, the log, fetch through the HTTP client of
//! the platform, the registry of connections that applies the start and the end of an update, the query executor that
//! runs the metadata queries and the specs of the client functions. The loader follows the Rust connections of the
//! registry (`follow`), the host tells it when the registry changed (`observe`).

use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_core_runtime::catalog_loader::{CatalogLoaderHost, CatalogLoaderService, CatalogQuery, CatalogUpdateOutcome, QueryBatches};
use dashql_core_runtime::connections::{CatalogUpdateTask, CatalogUpdateTaskStatus, CatalogUpdateVariant, RelationName};
use dashql_core_runtime::executor::ipc;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::host::CANCELLED_MESSAGE;
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use js_sys::{Function, Object, Promise, Reflect, Uint8Array};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

use super::connection::Connection;
use super::query_executor::{host_call, host_error, request_value, response_of};

#[wasm_bindgen(typescript_custom_section)]
const CATALOG_LOADER_HOST: &str = r#"
/** A metadata query of a catalog update */
export interface CatalogLoaderQuery {
    sql: string;
    /** The `QueryType` of the runtime */
    queryType: number;
    title: string;
    /** The read timeout, null for the default of the connection */
    readTimeoutMs: number | null;
}
/** How a catalog update ended */
export interface CatalogLoaderOutcome {
    status: 'succeeded' | 'partiallySucceeded' | 'failed' | 'cancelled';
    /** The error of an update that didn't succeed, the databases that failed of a partial one */
    error: string | null;
    catalogChanged: boolean;
    /** Are the scripts of the connection analyzed again? */
    announces: boolean;
}
/** The host of the catalog loader */
export interface CatalogLoaderHost {
    /** The time in milliseconds since the epoch */
    now(): number;
    /** Call back after a duration in milliseconds */
    setTimer(ms: number, callback: () => void): unknown;
    clearTimer(timer: unknown): void;
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string, target: string): void;
    /** Send a request, `abortFetch` with its id stops it */
    fetch(requestId: number, request: QueryExecutorHttpRequest): Promise<QueryExecutorHttpResponse>;
    abortFetch(requestId: number): void;
    /** An update started, `variant` 0 is a full refresh and 1 a lookup of the relations, a JSON array */
    updateStarted(connectionId: string, taskId: number, variant: number, relations: string): void;
    /** Abort a running update, its cancellation calls `cancel` of the loader */
    abortUpdate(connectionId: string, taskId: number, reason: string): void;
    /** An update ended */
    updateFinished(connectionId: string, taskId: number, outcome: CatalogLoaderOutcome): void;
    /** Run a metadata query of an update, the Arrow IPC stream of its result, null for none. `abortQuery` with the request id stops it. */
    runQuery(requestId: number, connectionId: string, taskId: number, query: CatalogLoaderQuery): Promise<Uint8Array | null>;
    abortQuery(requestId: number): void;
    /** The Data Cloud metadata of a data space from an API of the platform as JSON, null to fetch it */
    salesforceMetadata(connectionId: string, dataSpace: string): Promise<string | null>;
    /** The spec of the client functions of an extension, JSON */
    loadSpec(extension: string): Promise<string>;
    /** The catalog of a connection changed outside of an update */
    catalogChanged(connectionId: string): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "CatalogLoaderHost")]
    #[derive(Clone)]
    pub type JsCatalogLoaderHost;

    #[wasm_bindgen(method, catch)]
    fn now(this: &JsCatalogLoaderHost) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = setTimer)]
    fn set_timer(this: &JsCatalogLoaderHost, ms: f64, callback: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = clearTimer)]
    fn clear_timer(this: &JsCatalogLoaderHost, timer: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn log(this: &JsCatalogLoaderHost, level: &str, message: &str, details: &str, target: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn fetch(this: &JsCatalogLoaderHost, request_id: f64, request: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = abortFetch)]
    fn abort_fetch(this: &JsCatalogLoaderHost, request_id: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = updateStarted)]
    fn update_started(this: &JsCatalogLoaderHost, connection_id: &str, task_id: u32, variant: u8, relations: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = abortUpdate)]
    fn abort_update(this: &JsCatalogLoaderHost, connection_id: &str, task_id: u32, reason: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = updateFinished)]
    fn update_finished(this: &JsCatalogLoaderHost, connection_id: &str, task_id: u32, outcome: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = runQuery)]
    fn run_query(this: &JsCatalogLoaderHost, request_id: f64, connection_id: &str, task_id: u32, query: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = abortQuery)]
    fn abort_query(this: &JsCatalogLoaderHost, request_id: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = salesforceMetadata)]
    fn salesforce_metadata(this: &JsCatalogLoaderHost, connection_id: &str, data_space: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = loadSpec)]
    fn load_spec(this: &JsCatalogLoaderHost, extension: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = catalogChanged)]
    fn catalog_changed(this: &JsCatalogLoaderHost, connection_id: &str) -> Result<(), JsValue>;
}

/// A timer of the host, dropping it clears the timer
struct JsSleep {
    future: JsFuture,
    timer: JsValue,
    host: JsCatalogLoaderHost,
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

/// The host of the loader over the JS object
pub struct JsHost {
    host: JsCatalogLoaderHost,
    next_request: Cell<f64>,
}

impl JsHost {
    fn next_request(&self) -> f64 {
        let id = self.next_request.get() + 1.0;
        self.next_request.set(id);
        id
    }
}

fn set(object: &Object, key: &str, value: &JsValue) {
    let _ = Reflect::set(object, &JsValue::from_str(key), value);
}

fn relation_json(relation: &RelationName) -> Value {
    json!({ "databaseName": relation.database_name, "schemaName": relation.schema_name, "tableName": relation.table_name })
}

/// Relation names from their JSON, an array of `{databaseName, schemaName, tableName}`
fn relations_of(text: &str) -> Result<Vec<RelationName>, JsError> {
    let value: Value = serde_json::from_str(text).map_err(|e| JsError::new(&format!("invalid relations: {e}")))?;
    let Value::Array(names) = value else {
        return Err(JsError::new("relation names must be an array"));
    };
    let field = |name: &Value, key: &str| name.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    Ok(names
        .iter()
        .map(|name| RelationName {
            database_name: field(name, "databaseName"),
            schema_name: field(name, "schemaName"),
            table_name: field(name, "tableName"),
        })
        .collect())
}

fn outcome_value(outcome: &CatalogUpdateOutcome) -> JsValue {
    let object = Object::new();
    let status = match outcome.status {
        CatalogUpdateTaskStatus::Succeeded | CatalogUpdateTaskStatus::Started => "succeeded",
        CatalogUpdateTaskStatus::PartiallySucceeded => "partiallySucceeded",
        CatalogUpdateTaskStatus::Failed => "failed",
        CatalogUpdateTaskStatus::Cancelled => "cancelled",
    };
    set(&object, "status", &JsValue::from_str(status));
    set(&object, "error", &outcome.error.as_deref().map(JsValue::from_str).unwrap_or(JsValue::NULL));
    set(&object, "catalogChanged", &JsValue::from_bool(outcome.catalog_changed));
    set(&object, "announces", &JsValue::from_bool(outcome.announces()));
    object.into()
}

fn query_value(query: &CatalogQuery) -> JsValue {
    let object = Object::new();
    set(&object, "sql", &JsValue::from_str(&query.sql));
    set(&object, "queryType", &JsValue::from_f64(query.query_type as u8 as f64));
    set(&object, "title", &JsValue::from_str(&query.title));
    set(&object, "readTimeoutMs", &query.read_timeout_ms.map(|ms| JsValue::from_f64(ms.into())).unwrap_or(JsValue::NULL));
    object.into()
}

impl Host for JsHost {
    fn now(&self) -> f64 {
        self.host.now().unwrap_or_default()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let mut timer = JsValue::UNDEFINED;
        let host = self.host.clone();
        let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
            timer = host.set_timer(ms, &resolve).unwrap_or(JsValue::UNDEFINED);
        });
        JsSleep { future: JsFuture::from(promise), timer, host }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    /// The detail `target` names the target of the log
    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let target = details.iter().find(|(key, _)| *key == "target").map_or("catalog_loader", |(_, value)| value);
        let details: Map<String, Value> = details
            .iter()
            .filter(|(key, _)| *key != "target")
            .map(|(k, v)| (k.to_string(), Value::String(v.to_string())))
            .collect();
        let details = serde_json::to_string(&details).unwrap_or_default();
        let _ = self.host.log(level.name(), message, &details, target);
    }
}

impl HttpHost for JsHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let id = self.next_request();
        let host = self.host.clone();
        let token = cancellation.clone();
        let sent = if token.is_cancelled() { None } else { Some(self.host.fetch(id, &request_value(&request))) };
        async move {
            let Some(sent) = sent else {
                return Err(HostError::new(CANCELLED_MESSAGE));
            };
            let promise = Promise::resolve(&sent.map_err(host_error)?);
            match token.run(JsFuture::from(promise)).await {
                None => {
                    let _ = host.abort_fetch(id);
                    Err(HostError::new(CANCELLED_MESSAGE))
                }
                Some(Ok(value)) => response_of(&value),
                Some(Err(value)) => Err(host_error(value)),
            }
        }
    }
}

impl CatalogLoaderHost for JsHost {
    fn update_started(&self, connection_id: &str, task: &CatalogUpdateTask) {
        let variant = match task.variant {
            CatalogUpdateVariant::FullCatalogRefresh => 0,
            CatalogUpdateVariant::RelationRefresh => 1,
        };
        let relations = Value::Array(task.touched_relations.iter().map(relation_json).collect()).to_string();
        let _ = self.host.update_started(connection_id, task.task_id, variant, &relations);
    }

    fn abort_update(&self, connection_id: &str, task_id: u32, reason: &str) {
        let _ = self.host.abort_update(connection_id, task_id, reason);
    }

    fn update_finished(&self, connection_id: &str, task_id: u32, outcome: &CatalogUpdateOutcome) {
        let _ = self.host.update_finished(connection_id, task_id, &outcome_value(outcome));
    }

    fn run_query(
        &self,
        connection_id: &str,
        task_id: u32,
        query: &CatalogQuery,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<QueryBatches, HostError>> + 'static {
        let id = self.next_request();
        let host = self.host.clone();
        let token = cancellation.clone();
        let sent = if token.is_cancelled() { None } else { Some(self.host.run_query(id, connection_id, task_id, &query_value(query))) };
        async move {
            let Some(sent) = sent else {
                return Err(HostError::new(CANCELLED_MESSAGE));
            };
            let promise = Promise::resolve(&sent.map_err(host_error)?);
            let value = match token.run(JsFuture::from(promise)).await {
                None => {
                    let _ = host.abort_query(id);
                    return Err(HostError::new(CANCELLED_MESSAGE));
                }
                Some(result) => result.map_err(host_error)?,
            };
            if value.is_null() || value.is_undefined() {
                return Ok(Vec::new());
            }
            let bytes = Uint8Array::new(&value).to_vec();
            let (_, batches) = ipc::read_stream(&bytes).map_err(HostError::new)?;
            Ok(batches)
        }
    }

    fn salesforce_metadata(&self, connection_id: &str, data_space: &str) -> impl Future<Output = Result<Option<Value>, HostError>> + 'static {
        let call = self.host.salesforce_metadata(connection_id, data_space);
        async move {
            let value = host_call(call).await?;
            let Some(text) = value.as_string() else { return Ok(None) };
            serde_json::from_str(&text).map(Some).map_err(|e| HostError::new(format!("invalid Salesforce metadata: {e}")))
        }
    }

    fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static {
        let call = self.host.load_spec(extension);
        async move {
            let value = host_call(call).await?;
            value.as_string().ok_or_else(|| HostError::new("a spec that isn't text"))
        }
    }

    fn catalog_changed(&self, connection_id: &str) {
        let _ = self.host.catalog_changed(connection_id);
    }
}

/// The catalog loader of the runtime, see `dashql_core_runtime::catalog_loader::service`
#[wasm_bindgen]
pub struct CatalogLoader {
    service: CatalogLoaderService<JsHost>,
}

#[wasm_bindgen]
impl CatalogLoader {
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsCatalogLoaderHost) -> CatalogLoader {
        let host = Rc::new(JsHost { host, next_request: Cell::new(0.0) });
        CatalogLoader { service: CatalogLoaderService::new(host) }
    }

    /// Follow the Rust connection of a connection of the registry, it replaces another connection of the id
    pub fn follow(&self, connection_id: &str, connection: &Connection) {
        self.service.follow(connection_id, &connection.followed());
    }

    /// The registry changed and holds the connections of the ids, in their order
    pub fn observe(&self, connection_ids: Vec<String>) {
        self.service.observe(&connection_ids);
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update
    pub fn enqueue(&self, connection_id: &str, force: bool) {
        self.service.enqueue(connection_id, force);
    }

    /// The cancellation of an update fired
    pub fn cancel(&self, task_id: u32, reason: &str) {
        self.service.cancel(task_id, reason);
    }

    /// Start an update of a connection outside of the schedule, the relations are JSON or none for all of the catalog.
    /// Returns `{ taskId, done }`, `done` resolves once the update ended and rejects if it couldn't start.
    pub fn update(&self, connection_id: &str, relations: Option<String>) -> Result<JsValue, JsError> {
        let relations = relations.as_deref().map(relations_of).transpose()?;
        let (task_id, done) = self.service.update(connection_id, relations);
        let done = future_to_promise(async move {
            done.await.map(|_| JsValue::UNDEFINED).map_err(|error| JsError::new(error.message()).into())
        });
        let object = Object::new();
        set(&object, "taskId", &JsValue::from_f64(task_id.into()));
        set(&object, "done", &done);
        Ok(object.into())
    }

    /// Start scheduling, e.g. again after `stop`
    pub fn start(&self) {
        self.service.start();
    }

    /// Stop scheduling, running updates finish
    pub fn stop(&self) {
        self.service.stop();
    }
}
