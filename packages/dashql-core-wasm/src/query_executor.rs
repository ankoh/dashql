//! The wasm-bindgen API of the query executor (`dashql_core_runtime::executor`).
//!
//! The host is a JavaScript object (`QueryExecutorHost`): the clock, timers, fetch through the HTTP client of the
//! platform, the query result cache, the analysis of results and the channels of the host. A query comes as JSON, its
//! events go to `report` as JSON with a payload next to them: a part of the Arrow IPC stream of a result, a progress
//! update (`QueryProgressUpdate`, the host hands it to the history of the connection) or what the host failed with.
//! `execute` resolves with the outcome once the query ended.
//!
//! A result never stays in the module. The body of a successful response that carries a chunk of a result stays a
//! `Uint8Array` of the host, the module hands the same object back as a part of the result. A part that the module
//! wrote, a page of Trino or of a client function as Arrow, is copied out once and dropped.

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_core_runtime::executor::json::{event_json, failure_json, metrics_from_json, request_from_json, SpecCache};
use dashql_core_runtime::executor::{
    CacheEntry, ChannelMessage, ExecutorHost, HostTable, QueryEvent, QueryExecutor as RuntimeExecutor, QueryId,
    QueryOutcome,
};
use dashql_core_runtime::query::QueryExecutionProgress;
use tsify::Ts;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::host::CANCELLED_MESSAGE;
use dashql_core_runtime::http::{Body, CancellationToken, Headers, HostBytes, HttpHost, HttpRequest, HttpResponse};
use js_sys::{Array, Function, Object, Promise, Reflect, Uint8Array};
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

use crate::query_history::view::{ProfileLayoutView, QueryProgressView};
use crate::views::from_js;

#[wasm_bindgen(typescript_custom_section)]
const QUERY_EXECUTOR_HOST: &str = r#"
/** A request of the query executor for the HTTP client of the host */
export interface QueryExecutorHttpRequest {
    method: string;
    url: string;
    headers: [string, string][];
    body: string | null;
}
/** A response of the HTTP client of the host */
export interface QueryExecutorHttpResponse {
    status: number;
    statusText: string;
    headers: [string, string][];
    body: Uint8Array;
}
/** What a channel of the host reports while it streams a result, the batches stay with the host. The metrics are JSON. */
export type QueryExecutorChannelMessage =
    | { type: 'progress'; progress: QueryProgressView }
    | { type: 'batch'; metrics: string }
    | { type: 'end'; metrics: string };
/** A result table that the host holds */
export interface QueryExecutorHostTable {
    rows: number;
    columns: number;
    /** The record batches, 0 if unknown */
    batches?: number;
}
/** The host of the query executor */
export interface QueryExecutorHost {
    /** The time in milliseconds since the epoch */
    now(): number;
    /** Call back after a duration in milliseconds */
    setTimer(ms: number, callback: () => void): unknown;
    clearTimer(timer: unknown): void;
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void;
    /** Send a request, `abortFetch` with its id stops it */
    fetch(requestId: number, request: QueryExecutorHttpRequest): Promise<QueryExecutorHttpResponse>;
    abortFetch(requestId: number): void;
    /** An event of a query as JSON. The payload is a part of the Arrow IPC stream of a result (a Uint8Array, the body of the response of the host itself for a chunk of Hyper), a `QueryProgressUpdate` or what the host failed with. */
    report(queryId: number, event: string, payload: unknown): void;
    /** The entry of the query result cache of a key, null on a miss */
    cacheLookup(queryId: number, key: string): Promise<{ name: string; cachedAt: number } | null>;
    /** Read a cached result, the host holds it as the result of the query */
    cacheRead(queryId: number, name: string): Promise<QueryExecutorHostTable>;
    cacheTouch(queryId: number, name: string): Promise<void>;
    /** Write the result of the query into the cache */
    cacheWrite(queryId: number, key: string): Promise<void>;
    /** Analyze the result of the query on the compute database */
    analyzeResult(queryId: number): Promise<void>;
    /** The result streamed to its end: build its table from the parts of the stream or the batches of the channel, and hold it as the result of the query */
    finishResult(queryId: number): Promise<QueryExecutorHostTable>;
    /** Run the query on the channel of its connection, false if the channel returned no result */
    channelOpen(queryId: number): Promise<boolean>;
    channelNext(queryId: number): Promise<QueryExecutorChannelMessage>;
    channelCancel(queryId: number): Promise<void>;
    channelProfileDetail(queryId: number, wanted: boolean): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "QueryExecutorHost")]
    #[derive(Clone)]
    pub type JsQueryExecutorHost;

    #[wasm_bindgen(method, catch)]
    fn now(this: &JsQueryExecutorHost) -> Result<f64, JsValue>;
    #[wasm_bindgen(method, catch, js_name = setTimer)]
    fn set_timer(this: &JsQueryExecutorHost, ms: f64, callback: &Function) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = clearTimer)]
    fn clear_timer(this: &JsQueryExecutorHost, timer: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn log(this: &JsQueryExecutorHost, level: &str, message: &str, details: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn fetch(this: &JsQueryExecutorHost, request_id: f64, request: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = abortFetch)]
    fn abort_fetch(this: &JsQueryExecutorHost, request_id: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn report(this: &JsQueryExecutorHost, query_id: f64, event: &str, payload: &JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheLookup)]
    fn cache_lookup(this: &JsQueryExecutorHost, query_id: f64, key: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheRead)]
    fn cache_read(this: &JsQueryExecutorHost, query_id: f64, name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheTouch)]
    fn cache_touch(this: &JsQueryExecutorHost, query_id: f64, name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = cacheWrite)]
    fn cache_write(this: &JsQueryExecutorHost, query_id: f64, key: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = analyzeResult)]
    fn analyze_result(this: &JsQueryExecutorHost, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = finishResult)]
    fn finish_result(this: &JsQueryExecutorHost, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = channelOpen)]
    fn channel_open(this: &JsQueryExecutorHost, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = channelNext)]
    fn channel_next(this: &JsQueryExecutorHost, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = channelCancel)]
    fn channel_cancel(this: &JsQueryExecutorHost, query_id: f64) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = channelProfileDetail)]
    fn channel_profile_detail(this: &JsQueryExecutorHost, query_id: f64, wanted: bool) -> Result<(), JsValue>;
}

/// The message of a value that JS failed with
pub(crate) fn message_of(value: &JsValue) -> String {
    if let Some(error) = value.dyn_ref::<js_sys::Error>() {
        return String::from(error.message());
    }
    if let Some(message) = field(value, "message").and_then(|message| message.as_string()) {
        return message;
    }
    value.as_string().unwrap_or_else(|| "the host failed".to_string())
}

/// A host error that keeps what JS failed with
pub(crate) fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// What JS failed with, none for an error of the module
fn host_value(value: Option<&Rc<dyn std::any::Any>>) -> JsValue {
    value.and_then(|value| value.downcast_ref::<JsValue>()).cloned().unwrap_or(JsValue::UNDEFINED)
}

pub(crate) fn field(value: &JsValue, name: &str) -> Option<JsValue> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().filter(|value| !value.is_undefined() && !value.is_null())
}

/// Await a host call that returns a promise
pub(crate) async fn host_call(result: Result<JsValue, JsValue>) -> Result<JsValue, HostError> {
    let value = result.map_err(host_error)?;
    JsFuture::from(Promise::resolve(&value)).await.map_err(host_error)
}

/// A timer of the host, dropping it clears the timer
struct JsSleep {
    future: JsFuture,
    timer: JsValue,
    host: JsQueryExecutorHost,
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

/// The host of the executor over the JS object
pub struct JsHost {
    host: JsQueryExecutorHost,
    next_request: Cell<f64>,
}

/// The headers of a request or a response as `[name, value]` pairs
fn headers_value(headers: &Headers) -> Array {
    headers.iter().map(|(name, value)| Array::of2(&JsValue::from_str(name), &JsValue::from_str(value))).collect()
}

pub(crate) fn request_value(request: &HttpRequest) -> JsValue {
    let object = Object::new();
    let set = |key: &str, value: &JsValue| {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    };
    set("method", &JsValue::from_str(request.method.as_str()));
    set("url", &JsValue::from_str(&request.url));
    set("headers", &headers_value(&request.headers));
    set("body", &request.body.as_deref().map(JsValue::from_str).unwrap_or(JsValue::NULL));
    object.into()
}

pub(crate) fn response_of(value: &JsValue) -> Result<HttpResponse, HostError> {
    response_keeping(value, false)
}

/// A response of the host. A successful one may keep its body with the host, the module passes it on unread.
fn response_keeping(value: &JsValue, keep_body: bool) -> Result<HttpResponse, HostError> {
    let status = field(value, "status").and_then(|status| status.as_f64()).ok_or_else(|| HostError::new("a response without a status"))?;
    let mut response = HttpResponse::new(status.clamp(0.0, 999.0) as u16, Vec::new());
    response.status_text = field(value, "statusText").and_then(|text| text.as_string()).unwrap_or_default();
    if let Some(headers) = field(value, "headers").filter(Array::is_array) {
        for pair in Array::from(&headers).iter() {
            let pair = Array::from(&pair);
            if let (Some(name), Some(value)) = (pair.get(0).as_string(), pair.get(1).as_string()) {
                response.headers.append(&name, &value);
            }
        }
    }
    if let Some(body) = field(value, "body") {
        match body.dyn_ref::<Uint8Array>() {
            // The same object goes back to the host
            Some(bytes) if keep_body && response.status < 400 => {
                let length = bytes.length() as usize;
                response.host_body = Some(HostBytes::new(Rc::new(body), length));
            }
            Some(bytes) => response.body = bytes.to_vec(),
            None => response.body = Uint8Array::new(&body).to_vec(),
        }
    }
    Ok(response)
}

fn metrics_of(value: &JsValue, key: &str) -> dashql_core_runtime::query::QueryExecutionMetrics {
    let json = field(value, key).and_then(|metrics| metrics.as_string()).unwrap_or_default();
    metrics_from_json(&serde_json::from_str(&json).unwrap_or(Value::Null))
}

/// The progress of a channel of the host, a progress that doesn't read is an update without fields
fn channel_progress(value: Option<JsValue>) -> QueryExecutionProgress {
    let view = value.and_then(|value| serde_wasm_bindgen::from_value::<QueryProgressView>(value).ok());
    view.map(Into::into).unwrap_or_default()
}

fn channel_message(value: &JsValue) -> Result<ChannelMessage, HostError> {
    match field(value, "type").and_then(|kind| kind.as_string()).as_deref() {
        Some("progress") => Ok(ChannelMessage::Progress(Box::new(channel_progress(field(value, "progress"))))),
        Some("batch") => Ok(ChannelMessage::Batch { metrics: metrics_of(value, "metrics") }),
        Some("end") => Ok(ChannelMessage::End { metrics: metrics_of(value, "metrics") }),
        _ => Err(HostError::new("an unknown message of a channel")),
    }
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

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details: Map<String, Value> = details.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect();
        let details = serde_json::to_string(&details).unwrap_or_default();
        let _ = self.host.log(level.name(), message, &details);
    }
}

impl HttpHost for JsHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.send(request, cancellation, false)
    }
}

/// A count of a result table of the host
fn count_of(value: &JsValue, key: &str) -> u64 {
    field(value, key).and_then(|n| n.as_f64()).unwrap_or_default().max(0.0) as u64
}

/// A result table of the host
fn host_table(value: &JsValue) -> HostTable {
    HostTable { rows: count_of(value, "rows"), columns: count_of(value, "columns"), batches: count_of(value, "batches") }
}

impl JsHost {
    /// Send a request with the fetch of the host, a successful response may keep its body with the host
    fn send(&self, request: HttpRequest, cancellation: &CancellationToken, keep_body: bool) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let id = self.next_request.get() + 1.0;
        self.next_request.set(id);
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
                Some(Ok(value)) => response_keeping(&value, keep_body),
                Some(Err(value)) => Err(host_error(value)),
            }
        }
    }
}

impl ExecutorHost for JsHost {
    fn report(&self, query_id: QueryId, event: QueryEvent) {
        let json = event_json(&event).to_string();
        let payload = match event {
            // A part that the module wrote is copied out once, a part of the host goes back as it came
            QueryEvent::ResultData(Body::Bytes(bytes)) => Uint8Array::from(bytes.as_slice()).into(),
            QueryEvent::ResultData(Body::Host(bytes)) => host_value(Some(bytes.value())),
            QueryEvent::Progress(progress) => JsValue::from(QueryProgressUpdate { progress: *progress }),
            QueryEvent::Failed { failure, .. } | QueryEvent::Cancelled { failure, .. } => host_value(failure.value.as_ref()),
            _ => JsValue::UNDEFINED,
        };
        let _ = self.host.report(query_id as f64, &json, &payload);
    }

    fn cache_lookup(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<Option<CacheEntry>, HostError>> + 'static {
        let call = self.host.cache_lookup(query_id as f64, key);
        async move {
            let value = host_call(call).await?;
            Ok(field(&value, "name").and_then(|name| name.as_string()).map(|name| CacheEntry {
                name,
                cached_at: field(&value, "cachedAt").and_then(|at| at.as_f64()).unwrap_or_default(),
            }))
        }
    }

    fn cache_read(&self, query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let call = self.host.cache_read(query_id as f64, &entry.name);
        async move { host_call(call).await.map(|value| host_table(&value)) }
    }

    fn cache_touch(&self, query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.cache_touch(query_id as f64, &entry.name);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn cache_write(&self, query_id: QueryId, key: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.cache_write(query_id as f64, key);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn analyze_result(&self, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.analyze_result(query_id as f64);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn fetch_result(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.send(request, cancellation, true)
    }

    fn finish_result(&self, query_id: QueryId) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let call = self.host.finish_result(query_id as f64);
        async move { host_call(call).await.map(|value| host_table(&value)) }
    }

    fn channel_open(&self, query_id: QueryId) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let call = self.host.channel_open(query_id as f64);
        async move { host_call(call).await.map(|value| value.is_truthy()) }
    }

    fn channel_next(&self, query_id: QueryId) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static {
        let call = self.host.channel_next(query_id as f64);
        async move { channel_message(&host_call(call).await?) }
    }

    fn channel_cancel(&self, query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.host.channel_cancel(query_id as f64);
        async move { host_call(call).await.map(|_| ()) }
    }

    fn channel_profile_detail(&self, query_id: QueryId, wanted: bool) {
        let _ = self.host.channel_profile_detail(query_id as f64, wanted);
    }
}

/// The outcome of a query for JS: `{ outcome: JSON, value }`, the JSON is `{"status": "resolved", "hasResult"}` or
/// `{"status": "rejected", "failure"}`, the value what the host failed with
fn outcome_value(outcome: QueryOutcome) -> JsValue {
    let object = Object::new();
    let (json, value) = match outcome {
        QueryOutcome::Resolved { has_result } => (serde_json::json!({ "status": "resolved", "hasResult": has_result }), JsValue::UNDEFINED),
        QueryOutcome::Rejected(failure) => {
            (serde_json::json!({ "status": "rejected", "failure": failure_json(&failure) }), host_value(failure.value.as_ref()))
        }
    };
    let _ = Reflect::set(&object, &JsValue::from_str("outcome"), &JsValue::from_str(&json.to_string()));
    let _ = Reflect::set(&object, &JsValue::from_str("value"), &value);
    object.into()
}

/// A progress update of a query with its structured progress, as the executor reports it. The host hands it to the
/// history of the connection of the query (`queryProgressUpdated`), nothing of it is read in JavaScript.
#[wasm_bindgen]
pub struct QueryProgressUpdate {
    progress: QueryExecutionProgress,
}

impl QueryProgressUpdate {
    /// The progress update
    pub(crate) fn progress(&self) -> &QueryExecutionProgress {
        &self.progress
    }
}

/// The query executor of the runtime, see `dashql_core_runtime::executor`
#[wasm_bindgen]
pub struct QueryExecutor {
    executor: RuntimeExecutor<JsHost>,
    specs: RefCell<SpecCache>,
}

#[wasm_bindgen]
impl QueryExecutor {
    #[wasm_bindgen(constructor)]
    pub fn new(host: JsQueryExecutorHost) -> QueryExecutor {
        let host = Rc::new(JsHost { host, next_request: Cell::new(0.0) });
        QueryExecutor { executor: RuntimeExecutor::new(host), specs: RefCell::new(SpecCache::default()) }
    }

    /// Run a query that the host registered, the request is JSON. The failure of the caller is what the host fails the
    /// query with instead of running it. The promise resolves with the outcome once the query ended.
    pub fn execute(&self, query_id: f64, request: &str, failure: JsValue) -> Result<Promise, JsError> {
        let value: Value = serde_json::from_str(request).map_err(|e| JsError::new(&format!("invalid query request: {e}")))?;
        let mut request = request_from_json(query_id as u64, &value, &mut self.specs.borrow_mut()).map_err(|e| JsError::new(&e))?;
        if let Some(caller) = request.failure.take() {
            let value: Rc<dyn std::any::Any> = Rc::new(failure);
            request.failure = Some(dashql_core_runtime::executor::QueryFailure { value: Some(value), ..caller });
        }
        let run = self.executor.execute(request);
        Ok(future_to_promise(async move { Ok(outcome_value(run.await)) }))
    }

    /// Cancel a query, the promise resolves once it ended
    pub fn cancel(&self, query_id: f64) -> Promise {
        let cancel = self.executor.cancel(query_id as u64);
        future_to_promise(async move {
            cancel.await;
            Ok(JsValue::UNDEFINED)
        })
    }

    /// The layout of the plans of the progress of the queries that start later, null for the default one
    #[wasm_bindgen(js_name = setProgressLayout)]
    pub fn set_progress_layout(&self, layout: Option<Ts<ProfileLayoutView>>) -> Result<(), JsError> {
        let layout = layout.as_ref().map(from_js).transpose()?;
        self.executor.set_progress_layout(layout.map(Into::into));
        Ok(())
    }

    /// Is a query running?
    #[wasm_bindgen(js_name = isRunning)]
    pub fn is_running(&self, query_id: f64) -> bool {
        self.executor.is_running(query_id as u64)
    }

    /// A view starts (1) or stops (-1) showing the profile of a running query
    #[wasm_bindgen(js_name = watchProfile)]
    pub fn watch_profile(&self, query_id: f64, delta: i32) {
        self.executor.watch_profile(query_id as u64, delta);
    }

    /// Wait for the writes into the query result cache that run
    #[wasm_bindgen(js_name = flushCacheWrites)]
    pub fn flush_cache_writes(&self) -> Promise {
        let flush = self.executor.flush_cache_writes();
        future_to_promise(async move {
            flush.await;
            Ok(JsValue::UNDEFINED)
        })
    }
}
