//! The wasm-bindgen API of the runs of workbooks (`dashql_core_runtime::workbook_run`).
//!
//! The host is a JavaScript object (`WorkbookRunHost`): the clock, the log, the statements, which it hands to the
//! query executor, the query result cache, the mounts of materialized results and attachments, and what the run
//! reports. A statement goes to `execute` as JSON, the host returns its query with a promise of the result and one of
//! the end. The options, the state, the events of the scripts and the outcome cross as views (`workbook_run/view.rs`).
//! `Runtime.startWorkbookRun` starts a run of a workbook of the runtime and returns a `WorkbookRun`, which stops it and
//! settles with the outcome. The run changes the workbook of the runtime, the runtime tells the platform.

use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_core_runtime::executor::QueryId;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::workbook::RunPlanRequest;
use dashql_core_runtime::workbook_run::json::request_json;
use dashql_core_runtime::workbook_run::plan::result_keys;
use dashql_core_runtime::workbook_run::{
    start_run, RetainedFile, RunHandle, RunHost, RunState, ScriptEvent, StatementFailure, StatementHandle, StatementRequest,
};
use js_sys::{Function, Object, Promise, Reflect};
use serde_json::{Map, Value};
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

use std::cell::RefCell;

use dashql_core_runtime::workbook::Workbook;

use crate::host::JsPlatform;
use crate::runtime::Runtime;

mod view;

use view::{WorkbookResultKeys, WorkbookRunOptions, WorkbookRunResult, WorkbookRunState, WorkbookScriptRunEvent};

/// A view as a JS value, undefined if it doesn't convert
fn js_value<T: tsify::Tsify + serde::Serialize>(view: &T) -> JsValue {
    Ts::from_rust(view).map(JsValue::from).unwrap_or(JsValue::UNDEFINED)
}

#[wasm_bindgen(typescript_custom_section)]
const WORKBOOK_RUN_HOST: &str = r#"
/** What the result keys of a workbook ask of the host */
export interface WorkbookResultKeyHost {
    /** The result key of a signature on a connection, null if the connection has no key */
    resultKey(connectionId: string, signature: string): Promise<string | null>;
    /** Does a connection cache query results? */
    cachesResults(connectionId: string): boolean;
}
/** How a statement of a run ended: whether it has a result, or what it failed with */
export type WorkbookRunStatementEnd = { hasResult: boolean } | { error: unknown; cacheMiss: boolean };
/** The host of a run of a workbook */
export interface WorkbookRunHost extends WorkbookResultKeyHost {
    now(): number;
    setTimer(ms: number, callback: () => void): unknown;
    clearTimer(timer: unknown): void;
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void;
    /** Run a statement, the request is JSON. `ready` resolves once the result arrived, a failed statement may never resolve it. */
    execute(request: string): { queryId: number; ready: Promise<void>; done: Promise<WorkbookRunStatementEnd> };
    /** Cancel a statement, resolves once it ended */
    cancel(connectionId: string, queryId: number): Promise<void>;
    canRun(connectionId: string): boolean;
    maxConcurrentQueries(connectionId: string): number;
    preparesConnections(): boolean;
    prepareConnection(connectionId: string): Promise<void>;
    hasCache(): boolean;
    /** Keep the newest file of a key until the run releases it, null without one */
    cacheRetain(key: string): Promise<{ id: number; name: string } | null>;
    cacheRelease(id: number): Promise<void>;
    /** The directory of the materialized results of the run, null without the compute database */
    mountPrefix(): string | null;
    mountFileName(key: string | null): string;
    /** Write the result of a statement as Parquet file, resolves with its rows */
    mountWrite(path: string, queryId: number): Promise<number>;
    mountUse(path: string): Promise<void>;
    mountRelease(): Promise<void>;
    mountsAttachments(): boolean;
    mountAttachments(): Promise<void>;
    /** The state of the run */
    state(state: WorkbookRunState): void;
    /** An event of a script, a failure comes with what the host failed with */
    scriptEvent(file: string, event: WorkbookScriptRunEvent, error: unknown): void;
    cooperate(): Promise<void>;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "WorkbookResultKeyHost")]
    #[derive(Clone)]
    pub type JsResultKeyHost;

    #[wasm_bindgen(method, catch, js_name = resultKey)]
    fn result_key(this: &JsResultKeyHost, connection_id: &str, signature: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cachesResults)]
    fn caches_results(this: &JsResultKeyHost, connection_id: &str) -> Result<bool, JsValue>;

    #[wasm_bindgen(typescript_type = "WorkbookRunHost")]
    #[derive(Clone)]
    pub type JsWorkbookRunHost;

    #[wasm_bindgen(method, catch)]
    fn now(this: &JsWorkbookRunHost) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = setTimer)]
    fn set_timer(this: &JsWorkbookRunHost, ms: f64, callback: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = clearTimer)]
    fn clear_timer(this: &JsWorkbookRunHost, timer: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn log(this: &JsWorkbookRunHost, level: &str, message: &str, details: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn execute(this: &JsWorkbookRunHost, request: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn cancel(this: &JsWorkbookRunHost, connection_id: &str, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = resultKey)]
    fn run_result_key(this: &JsWorkbookRunHost, connection_id: &str, signature: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cachesResults)]
    fn run_caches_results(this: &JsWorkbookRunHost, connection_id: &str) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = canRun)]
    fn can_run(this: &JsWorkbookRunHost, connection_id: &str) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = maxConcurrentQueries)]
    fn max_concurrent_queries(this: &JsWorkbookRunHost, connection_id: &str) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = preparesConnections)]
    fn prepares_connections(this: &JsWorkbookRunHost) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = prepareConnection)]
    fn prepare_connection(this: &JsWorkbookRunHost, connection_id: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = hasCache)]
    fn has_cache(this: &JsWorkbookRunHost) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheRetain)]
    fn cache_retain(this: &JsWorkbookRunHost, key: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheRelease)]
    fn cache_release(this: &JsWorkbookRunHost, id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountPrefix)]
    fn mount_prefix(this: &JsWorkbookRunHost) -> Result<Option<String>, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountFileName)]
    fn mount_file_name(this: &JsWorkbookRunHost, key: Option<String>) -> Result<String, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountWrite)]
    fn mount_write(this: &JsWorkbookRunHost, path: &str, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountUse)]
    fn mount_use(this: &JsWorkbookRunHost, path: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountRelease)]
    fn mount_release(this: &JsWorkbookRunHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountsAttachments)]
    fn mounts_attachments(this: &JsWorkbookRunHost) -> Result<bool, JsValue>;
    #[wasm_bindgen(method, catch, js_name = mountAttachments)]
    fn mount_attachments(this: &JsWorkbookRunHost) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn state(this: &JsWorkbookRunHost, state: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = scriptEvent)]
    fn script_event(this: &JsWorkbookRunHost, file: &str, event: &JsValue, error: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn cooperate(this: &JsWorkbookRunHost) -> Result<JsValue, JsValue>;
}

/// The message of a value that JS failed with
fn message_of(value: &JsValue) -> String {
    if let Some(error) = value.dyn_ref::<js_sys::Error>() {
        return String::from(error.message());
    }
    if let Some(message) = field(value, "message").and_then(|message| message.as_string()) {
        return message;
    }
    value.as_string().unwrap_or_else(|| "the host failed".to_string())
}

/// A host error that keeps what JS failed with
fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// What JS failed with, undefined for an error of the module
fn host_value(value: Option<&Rc<dyn std::any::Any>>) -> JsValue {
    value.and_then(|value| value.downcast_ref::<JsValue>()).cloned().unwrap_or(JsValue::UNDEFINED)
}

fn field(value: &JsValue, name: &str) -> Option<JsValue> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().filter(|value| !value.is_undefined() && !value.is_null())
}

/// Await a host call that returns a promise
async fn host_call(result: Result<JsValue, JsValue>) -> Result<JsValue, HostError> {
    let value = result.map_err(host_error)?;
    JsFuture::from(Promise::resolve(&value)).await.map_err(host_error)
}

/// A statement failure of what JS failed with
fn statement_failure(value: JsValue, cache_miss: bool) -> StatementFailure {
    StatementFailure { message: message_of(&value), cache_miss, value: Some(Rc::new(value)) }
}

/// A timer of the host, dropping it clears the timer
struct JsSleep {
    future: JsFuture,
    timer: JsValue,
    host: JsWorkbookRunHost,
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

/// The host of a run over the JS object, on a workbook of the runtime
pub struct JsRunHost {
    host: JsWorkbookRunHost,
    /// The platform of the runtime, told when the run changes the workbook
    platform: JsPlatform,
    /// Does the runtime still hold the workbook of the run?
    live: Box<dyn Fn() -> bool>,
}

impl Host for JsRunHost {
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

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details: Map<String, Value> = details.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect();
        let details = serde_json::to_string(&details).unwrap_or_default();
        let _ = self.host.log(level.name(), message, &details);
    }
}

impl RunHost for JsRunHost {
    fn execute(&self, request: StatementRequest) -> Result<StatementHandle, StatementFailure> {
        let value = self.host.execute(&request_json(&request).to_string()).map_err(|error| statement_failure(error, false))?;
        let query_id = field(&value, "queryId").and_then(|id| id.as_f64()).ok_or_else(|| StatementFailure::new("a statement without a query"))?;
        let ready = field(&value, "ready").map(|ready| JsFuture::from(Promise::resolve(&ready)));
        let done = JsFuture::from(Promise::resolve(&field(&value, "done").unwrap_or(JsValue::UNDEFINED)));
        Ok(StatementHandle {
            query_id: query_id.max(0.0) as QueryId,
            ready: Box::pin(async move {
                if let Some(ready) = ready {
                    let _ = ready.await;
                }
            }),
            done: Box::pin(async move {
                let end = done.await.map_err(|error| statement_failure(error, false))?;
                if let Some(error) = Reflect::get(&end, &JsValue::from_str("error")).ok().filter(|_| has_key(&end, "error")) {
                    let cache_miss = field(&end, "cacheMiss").is_some_and(|miss| miss.is_truthy());
                    return Err(statement_failure(error, cache_miss));
                }
                Ok(field(&end, "hasResult").is_some_and(|has| has.is_truthy()))
            }),
        })
    }

    fn cancel(&self, connection_id: &str, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        let call = self.host.cancel(connection_id, query_id as f64);
        async move {
            let _ = host_call(call).await;
        }
    }

    fn result_key(&self, connection_id: &str, signature: &str) -> impl Future<Output = Option<String>> + 'static {
        let call = self.host.run_result_key(connection_id, signature);
        async move { host_call(call).await.ok().and_then(|key| key.as_string()) }
    }

    fn caches_results(&self, connection_id: &str) -> bool {
        self.host.run_caches_results(connection_id).unwrap_or(false)
    }

    fn can_run(&self, connection_id: &str) -> bool {
        self.host.can_run(connection_id).unwrap_or(true)
    }

    fn max_concurrent_queries(&self, connection_id: &str) -> usize {
        self.host.max_concurrent_queries(connection_id).ok().filter(|n| n.is_finite() && *n >= 1.0).map_or(1, |n| n as usize)
    }

    fn prepares_connections(&self) -> bool {
        self.host.prepares_connections().unwrap_or(false)
    }

    fn prepare_connection(&self, connection_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.prepare_connection(connection_id);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn has_cache(&self) -> bool {
        self.host.has_cache().unwrap_or(false)
    }

    fn cache_retain(&self, key: &str) -> impl Future<Output = Result<Option<RetainedFile>, HostError>> + 'static {
        let call = self.host.cache_retain(key);
        async move {
            let value = host_call(call).await?;
            let id = field(&value, "id").and_then(|id| id.as_f64());
            let name = field(&value, "name").and_then(|name| name.as_string());
            Ok(id.zip(name).map(|(id, name)| RetainedFile { id: id.max(0.0) as u64, name }))
        }
    }

    fn cache_release(&self, file: u64) -> impl Future<Output = ()> + 'static {
        let call = self.host.cache_release(file as f64);
        async move {
            let _ = host_call(call).await;
        }
    }

    fn mount_prefix(&self) -> Option<String> {
        self.host.mount_prefix().ok().flatten()
    }

    fn mount_file_name(&self, key: Option<&str>) -> String {
        self.host.mount_file_name(key.map(str::to_string)).unwrap_or_default()
    }

    fn mount_write(&self, path: &str, query_id: QueryId) -> impl Future<Output = Result<u64, HostError>> + 'static {
        let call = self.host.mount_write(path, query_id as f64);
        async move { host_call(call).await.map(|rows| rows.as_f64().unwrap_or_default().max(0.0) as u64) }
    }

    fn mount_use(&self, path: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.mount_use(path);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn mount_release(&self) -> impl Future<Output = ()> + 'static {
        let call = self.host.mount_release();
        async move {
            let _ = host_call(call).await;
        }
    }

    fn mounts_attachments(&self) -> bool {
        self.host.mounts_attachments().unwrap_or(false)
    }

    fn mount_attachments(&self) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.mount_attachments();
        async move { host_call(call).await.map(|_| ()) }
    }

    fn workbook_live(&self) -> bool {
        (self.live)()
    }

    fn workbook_changed(&self) {
        self.platform.signal(true);
    }

    fn state(&self, state: &RunState) {
        let _ = self.host.state(&js_value(&WorkbookRunState::from(state)));
    }

    fn script_event(&self, file: &str, event: &ScriptEvent) {
        let error = match event {
            ScriptEvent::Failed { failure } => host_value(failure.value.as_ref()),
            _ => JsValue::UNDEFINED,
        };
        let _ = self.host.script_event(file, &js_value(&WorkbookScriptRunEvent::from(event)), &error);
    }

    fn cooperate(&self) -> impl Future<Output = ()> + 'static {
        let call = self.host.cooperate();
        async move {
            let _ = host_call(call).await;
        }
    }
}

/// Does an object have a key, also with the value undefined?
fn has_key(value: &JsValue, key: &str) -> bool {
    value.is_object() && Reflect::has(value, &JsValue::from_str(key)).unwrap_or(false)
}

/// A run of a workbook: it stops with `cancel`, `result` settles once it ended
#[wasm_bindgen]
pub struct WorkbookRun {
    handle: RunHandle<JsRunHost>,
    result: Promise,
}

#[wasm_bindgen]
impl WorkbookRun {
    /// Stop the run, the running statements are cancelled
    pub fn cancel(&self) {
        self.handle.cancel();
    }

    /// Resolves once the run ended with `{ outcome, error }`: the outcome (the queries of the outputs, the failure,
    /// whether a statement was handed to the host), a `WorkbookRunResult`, and what the host failed with
    pub fn result(&self) -> Promise {
        self.result.clone()
    }
}

/// A workbook of the runtime by id
fn workbook_of(runtime: &Runtime, workbook_id: &str) -> Result<Rc<RefCell<Workbook>>, JsError> {
    runtime.workbooks.get(workbook_id).ok_or_else(|| JsError::new(&format!("no workbook registered with id {workbook_id}")))
}

#[wasm_bindgen]
impl Runtime {
    /// Start a run of the scripts of a workbook
    #[wasm_bindgen(js_name = startWorkbookRun)]
    pub fn start_workbook_run(&self, workbook_id: &str, host: JsWorkbookRunHost, options: Ts<WorkbookRunOptions>) -> Result<WorkbookRun, JsError> {
        let options = options.to_rust()?.into();
        let workbook = workbook_of(self, workbook_id)?;
        let workbooks = Rc::downgrade(&self.workbooks);
        let held = Rc::downgrade(&workbook);
        let id = workbook_id.to_string();
        let live = Box::new(move || match (workbooks.upgrade(), held.upgrade()) {
            (Some(workbooks), Some(held)) => workbooks.get(&id).is_some_and(|current| Rc::ptr_eq(&current, &held)),
            _ => false,
        });
        let host = JsRunHost { host, platform: self.platform.clone(), live };
        let (handle, run) = start_run(Rc::new(host), workbook, options);
        let result = future_to_promise(async move {
            let result = run.await;
            let object = Object::new();
            let error = result.failure.as_ref().map(|failure| host_value(failure.value.as_ref())).unwrap_or(JsValue::UNDEFINED);
            let _ = Reflect::set(&object, &JsValue::from_str("outcome"), &js_value(&WorkbookRunResult::from(&result)));
            let _ = Reflect::set(&object, &JsValue::from_str("error"), &error);
            Ok(object.into())
        });
        Ok(WorkbookRun { handle, result })
    }

    /// Analyze every script of a workbook for a run and publish its declarations, twice: the analyses at the catalog
    /// revisions that the publishing left. Throws the message of a script that doesn't analyze.
    #[wasm_bindgen(js_name = analyzeForRun)]
    pub fn analyze_for_run(&self, workbook_id: &str) -> Result<(), JsError> {
        let workbook = workbook_of(self, workbook_id)?;
        let analyzed = workbook.try_borrow_mut().map_err(|_| JsError::new("the workbook is busy"))?.analyze_for_run();
        self.platform.signal(true);
        analyzed.map_err(|message| JsError::new(&message))
    }

    /// The plan of a run of a workbook with the analyses as they are, a packed `ExecutionGraph`: of the targets with
    /// what they need, of every script without
    #[wasm_bindgen(js_name = planRun)]
    pub fn plan_run(&self, workbook_id: &str, targets: Option<Vec<u32>>, mount_prefix: String) -> Result<Vec<u8>, JsError> {
        let workbook = workbook_of(self, workbook_id)?;
        let request = RunPlanRequest { targets: targets.as_deref(), mount_prefix: &mount_prefix, ..RunPlanRequest::default() };
        let graph = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?.plan_run(&request);
        Ok(finish!(graph))
    }

    /// The result keys of the scripts of a workbook, a `WorkbookResultKeys`: null for a script without a key, a run
    /// reads and writes the files of the reusable ones. Plans the targets, every script without, with the analyses as
    /// they are, all null if the plan is invalid.
    #[wasm_bindgen(js_name = resultKeys)]
    pub fn result_keys(&self, workbook_id: &str, targets: Option<Vec<u32>>, host: JsResultKeyHost) -> Result<Promise, JsError> {
        let workbook = workbook_of(self, workbook_id)?;
        let (graph, connections) = {
            let workbook = workbook.try_borrow().map_err(|_| JsError::new("the workbook is busy"))?;
            let request = RunPlanRequest { targets: targets.as_deref(), mount_prefix: "/mnt/external/dashql-keys", ..RunPlanRequest::default() };
            let connections: Vec<String> = workbook.scripts().iter().map(|script| script.connection().connection_id.clone()).collect();
            (workbook.plan_run(&request), connections)
        };
        let connections = Rc::new(connections);
        Ok(future_to_promise(async move {
            if !graph.valid {
                return Ok(js_value(&WorkbookResultKeys(connections.iter().map(|_| None).collect())));
            }
            let keys_host = host.clone();
            let keys_connections = connections.clone();
            let keys = result_keys(
                &graph,
                move |script, signature| {
                    let connection = keys_connections.get(script as usize).cloned().unwrap_or_default();
                    let call = keys_host.result_key(&connection, &signature);
                    async move { host_call(call).await.ok().and_then(|key| key.as_string()) }
                },
                |script| connections.get(script as usize).is_some_and(|connection| host.caches_results(connection).unwrap_or(false)),
            )
            .await;
            Ok(js_value(&WorkbookResultKeys::from(keys.as_slice())))
        }))
    }
}
