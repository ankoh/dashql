//! The platform of the runtime: one JavaScript object that the runtime calls for its I/O (docs/wip/runtime_api.md),
//! and `JsPlatform`, the host of the services of the crate over it.
//!
//! The platform holds the handle table, the Arrow tables by handle, the compute database, the clock, the log, fetch,
//! the channels of the host, the descriptions of the queries that the runtime runs itself, the query result cache, the
//! OAuth flows, the specs of the extensions and the API of Salesforce. The runtime tells it that its state changed
//! (`changed`), the store of the app then takes the changes and reads the views. Every call into the platform catches:
//! a member that throws or is missing fails the call of the service with a `HostError` and never unwinds through the
//! module. No borrow of the platform is held while it calls JavaScript, so the platform may call the runtime again from
//! any of its members.
//!
//! The helpers of the other hosts of the bindings (the runs of workbooks, the storage) live here as well: reading the
//! fields of JS values, awaiting the promises of the host, requests and responses.

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;

use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, RunId};
use dashql_core_runtime::compute::ComputationEffect;
use dashql_core_runtime::connections::registry::RegistryEffect;
use dashql_core_runtime::executor::HostTable;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::host::CANCELLED_MESSAGE;
use dashql_core_runtime::http::{CancellationToken, Headers, HostBytes, HttpHost, HttpRequest, HttpResponse};
use js_sys::{Array, Function, Object, Promise, Reflect, Uint8Array};
use serde::Serialize;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};

use crate::runtime::computation::ComputeCallContext;

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_PLATFORM: &str = r#"
/** The I/O of the runtime, one object of the host (docs/wip/runtime_api.md). The members return promises where the runtime awaits them. */
export interface RuntimePlatform {
    /** The clock in milliseconds since epoch, and timers */
    clock: { now(): number; sleep(ms: number): Promise<void> };
    /** Log a message with its details as key value pairs, on a target of the log */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: [string, string][], target?: string): void;
    /** The handle table of the host objects that the runtime names by a number */
    handles: RuntimeHandles;
    /** The Arrow tables of the host by handle, result data never enters the module */
    tables: RuntimeTables;
    /** The compute database of the computations, null until the host set it up */
    readonly compute: ComputePlatform | null;
    /** Send requests with the HTTP client of the platform */
    http: RuntimeHttp;
    /** The channels of the host: the ones that the setups connect, and the ones that run queries themselves (the embedded Hyper, gRPC through the native proxy, the channels of tests) */
    channels: RuntimeChannels;
    /** The queries that the runtime runs itself, e.g. the metadata queries of the catalog loader and the probes of health checks */
    queries: RuntimeQueries;
    /** The query result cache, null without one */
    readonly resultCache: RuntimeResultCache | null;
    /** Random ids */
    crypto: { randomUuid(): string };
    /** The OAuth flows of the setups */
    oauth: RuntimeOAuth;
    /** The specs of the client functions of the extensions, the JSON text */
    extensions: { loadSpec(extension: string): Promise<string> };
    /** An API of Salesforce that answers the metadata of the catalog, e.g. the mock of the app. Null lets the runtime fetch it. */
    readonly salesforce: RuntimeSalesforce | null;
    /** The storage of the workbooks and the connections, the storage writer and the restore read and write through it */
    readonly storage: RuntimeStorage | null;
    /** The state of the runtime changed, the host takes the changes. Urgent changes are taken at the end of the task, the others before the next frame. */
    changed(urgent: boolean): void;
}

/** The storage of the platform: the workbook files, scripts and attachments of the workbooks, the app manifest and the files of the connections. Workbook files and connection entries cross as plain JSON values. */
export interface RuntimeStorage {
    /** The workbook file, rejects if there is none */
    loadWorkbook(workbookId: string): Promise<unknown>;
    saveWorkbook(workbookId: string, workbook: unknown): Promise<void>;
    /** Rejects with an `ExternalScriptChangeError` (by its name, with `workbookId` and `fileName`) if the file changed outside the app */
    saveScript(workbookId: string, fileName: string, text: string): Promise<void>;
    deleteScript(workbookId: string, fileName: string): Promise<void>;
    renameScript(workbookId: string, from: string, to: string): Promise<void>;
    /** The names of the attachments in natural order */
    listAttachments(workbookId: string): Promise<string[]>;
    /** Update the connection entries of the app manifest exclusively. The update gets the entries, null before the connections were migrated, and returns the new ones, null if nothing changed. */
    updateConnections(update: (connections: unknown[] | null) => unknown[] | null): Promise<void>;
    saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void>;
    deleteConnectionFiles(connectionId: string): Promise<void>;
    deleteWorkbook(workbookId: string): Promise<void>;
    /** Does the storage own the connections? A storage of a single workbook folder doesn't. */
    ownsConnections(): boolean;
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
}

/** A channel that a setup asks the host to connect */
export type RuntimeChannelRequest =
    | { type: 'trino'; endpoint: string; auth: unknown; catalog: string | null; schema: string | null; accessToken: unknown | null }
    | { type: 'salesforce'; endpoint: string; requestMetadata: Record<string, string>; attachedDatabases: { path: string; alias: string }[]; tokens: { core: unknown; dataCloud: unknown } }
    | { type: 'hyper'; kind: 'embedded' | 'grpc' | 'http'; params: any };

/** A query that the runtime runs itself */
export interface RuntimeQueryDescription {
    text: string;
    metadata: QueryMetadataView;
    /** The read timeout, null for the default of the connection */
    readTimeoutMs: number | null;
}
/** The host side of the queries that the runtime runs itself */
export interface RuntimeQueries {
    /** Describe where a query of a connection runs, the request as `executeQuery` takes it. The host keeps what it needs to run the query on a channel of its own until `forget`. */
    describe(queryId: number, connectionId: string, query: RuntimeQueryDescription): Promise<unknown>;
    /** The query ended */
    forget(queryId: number): void;
}

/** How the platform takes the user through the redirect page */
export interface RuntimeOAuthFlowInfo {
    redirectVariant: 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    redirectCallbackUrl: string | null;
    debugMode: boolean;
    flavor: string | null;
}
/** The OAuth flows of the platform. A flow belongs to a setup by the id of the setup, `abort` with the id of the flow stops it. */
export interface RuntimeOAuth {
    /** A PKCE challenge: a random verifier and the base64url of its SHA-256 digest */
    pkce(): Promise<{ value: string; verifier: string }>;
    flowInfo(setupId: string): RuntimeOAuthFlowInfo;
    /** Open the authorization URL and wait for the loopback redirect. The events are 'WINDOW_OPENED', 'WINDOW_CLOSED' and 'EXTERNAL_BROWSER_OPENED'. */
    authorizeWithLoopback(setupId: string, flow: number, url: string, callbackUrl: string, onEvent: (event: string) => void): Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
    /** Open the authorization URL and wait for the callback of the redirect page whose state has the flow id */
    authorizeWithRedirectPage(setupId: string, flow: number, url: string, flowId: string, onEvent: (event: string) => void): Promise<unknown>;
    abort(flow: number): void;
}

/** An API of Salesforce of the platform */
export interface RuntimeSalesforce {
    /** The Data Cloud metadata of a data space as JSON, null to fetch it */
    metadata(connectionId: string, dataSpace: string): Promise<string | null>;
}

/** The handle table of the host */
export interface RuntimeHandles {
    /** Keep an object under a new handle */
    register(object: unknown): number;
    /** Forget the object of a handle */
    release(handle: number): void;
    /** The object of a handle */
    get(handle: number): unknown;
    /** Keep the object of a handle under a new handle as well, e.g. a result table that a computation takes too */
    duplicate(handle: number): number;
}

/** The Arrow tables of the host by handle */
export interface RuntimeTables {
    /** Begin a table with an Arrow IPC stream, its schema and maybe batches, returns its handle */
    begin(ipc: Uint8Array): number;
    /** Append the batches of an Arrow IPC stream to a table that began */
    append(table: number, ipc: Uint8Array): void;
    /** Open a table that streams in parts of one Arrow IPC stream, a message may span parts. A channel of the host pushes its batches into it. */
    open(): number;
    /** Push the next part of the Arrow IPC stream of a table that was opened */
    push(table: number, part: Uint8Array): void;
    /** Finish a table, it is a table of the handle table from then on */
    finish(table: number): { rows: number; bytes: number; columns: number; batches: number };
    /** A table of the handle table as an Arrow IPC stream */
    read(table: number): Uint8Array;
}

/** A request of the runtime for the HTTP client of the host */
export interface RuntimeHttpRequest {
    method: string;
    url: string;
    headers: [string, string][];
    body: string | null;
}
/** A response of the HTTP client of the host */
export interface RuntimeHttpResponse {
    status: number;
    statusText: string;
    headers: [string, string][];
    body: Uint8Array;
}
/** Fetch of the platform: `abort` with the id of a request stops it */
export interface RuntimeHttp {
    fetch(id: number, request: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
    abort(id: number): void;
}

/** What a channel of the host reports while it streams a result, the batches go into the table of the query */
export type RuntimeChannelMessage =
    | { type: 'progress'; progress: QueryProgressView }
    | { type: 'batch'; metrics: QueryStreamMetrics }
    | { type: 'end'; metrics: QueryStreamMetrics };
/** The channels of the host. The setups connect them, the queries of the host run on them by query: the host knows the channel of a query from the query it described. */
export interface RuntimeChannels {
    /** Connect a channel of a setup, returns its handle */
    connect(setupId: string, request: RuntimeChannelRequest): Promise<number>;
    /** The token of the link to a Hyper that the page holds, null without */
    hyperLinkToken(connectionId: string): string | null;
    /** Run a query on its channel, its batches go into the table that was opened for it. False if the channel returned no result. */
    open(queryId: number, table: number): Promise<boolean>;
    /** The next message of the stream of a query */
    next(queryId: number): Promise<RuntimeChannelMessage>;
    /** Cancel the query of a channel at the backend */
    cancel(queryId: number): Promise<void>;
    /** Is the profile of the query shown? A channel fetches the plan and its statistics only then. */
    profileDetail(queryId: number, shown: boolean): void;
}

/** The query result cache of the platform, Parquet files that the compute database reads and writes */
export interface RuntimeResultCache {
    /** The newest file of a key, null on a miss */
    lookup(key: string): Promise<{ name: string; cachedAt: number } | null>;
    /** Read a file into a table of the handle table */
    read(name: string): Promise<{ table: number; rows: number; columns: number }>;
    /** Record a read of a file */
    touch(name: string): Promise<void>;
    /** Write a table of the handle table as the newest file of a key */
    write(key: string, table: number): Promise<void>;
}

/** The compute database of the computations, the embedded Hyper of the platform. The context of a call names the computation, the title of its task, the connection and the client context of the computation, and the run that `cancel` aborts. Tables cross as Arrow IPC streams. */
export interface ComputePlatform {
    /** Create the table of a data frame from an Arrow IPC stream */
    importTable(dataFrame: number, tableName: string, ipc: Uint8Array, context: ComputeCallContext): Promise<void>;
    /** Create the table of a data frame from a SELECT, the host tracks the SELECT as a query of the task */
    createTable(dataFrame: number, tableName: string, sql: string, context: ComputeCallContext): Promise<void>;
    /** Run a query, resolves to its result as an Arrow IPC stream */
    query(sql: string, context: ComputeCallContext): Promise<Uint8Array>;
    /** Drop the table of a data frame */
    dropTable(dataFrame: number, tableName: string): Promise<void>;
    /** Abort the calls of a run */
    cancel(run: number): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// The platform object of the host
    #[wasm_bindgen(typescript_type = "RuntimePlatform")]
    #[derive(Clone)]
    pub type JsRuntimePlatform;
}

/// What the services of the runtime do after an action of the registry
#[derive(Default)]
pub struct RegistryFollowUp {
    /// Cancel the setup of the connection that runs
    pub cancel_setup: bool,
    /// Cancel the catalog updates of the loader, with their reasons
    pub cancel_catalog_updates: Vec<(u32, &'static str)>,
}

/// An effect of the runtime on a handle of the host, applied by the store when it takes the changes
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HandleEffect {
    /// Forget the object of a handle
    Release { handle: u32 },
    /// Close the object of a handle, e.g. a channel, and forget it
    Close { handle: u32 },
    /// Abort the object of a handle, it stays until a release
    Abort { handle: u32, reason: String },
}

/// What the runtime collected for the host since the last time it took the changes
#[derive(Default)]
struct Pending {
    /// The effects on handles, in order
    effects: Vec<HandleEffect>,
    /// Was the host told, and was it urgent?
    signaled: Option<bool>,
}

struct Inner {
    object: JsRuntimePlatform,
    pending: RefCell<Pending>,
    /// The id of the last request
    last_request: Cell<f64>,
}

/// The host of the services of the crate over the platform object. Clones share the object and the pending changes.
#[derive(Clone)]
pub struct JsPlatform {
    inner: Rc<Inner>,
}

/// The message of a value that JS failed with, an error of another realm too
pub(crate) fn message_of(value: &JsValue) -> String {
    let message = value.is_object().then(|| Reflect::get(value, &JsValue::from_str("message")).ok()).flatten().and_then(|m| m.as_string());
    message.or_else(|| value.as_string()).unwrap_or_else(|| "the platform failed".to_string())
}

/// A host error that keeps what JS failed with
pub(crate) fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// What JS failed with, undefined for an error of the module
pub(crate) fn host_value(value: Option<&Rc<dyn Any>>) -> JsValue {
    value.and_then(|value| value.downcast_ref::<JsValue>()).cloned().unwrap_or(JsValue::UNDEFINED)
}

/// A field of a JS value, none for undefined and null
pub(crate) fn field(value: &JsValue, name: &str) -> Option<JsValue> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().filter(|value| !value.is_undefined() && !value.is_null())
}

/// A member of an object
fn member(object: &JsValue, name: &str) -> Result<JsValue, HostError> {
    let value = Reflect::get(object, &JsValue::from_str(name)).map_err(host_error)?;
    if value.is_undefined() || value.is_null() {
        return Err(HostError::new(format!("the platform has no {name}")));
    }
    Ok(value)
}

/// Call a method of an object
fn call(object: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
    let function = member(object, name)?.dyn_into::<Function>().map_err(|_| HostError::new(format!("{name} of the platform is no function")))?;
    function.apply(object, &args.iter().collect::<Array>()).map_err(host_error)
}

/// Await the promise of a call
async fn settled(value: Result<JsValue, HostError>) -> Result<JsValue, HostError> {
    JsFuture::from(Promise::resolve(&value?)).await.map_err(host_error)
}

/// A number of the platform as a handle, none for no handle
fn as_handle(value: &JsValue) -> Option<Handle> {
    value.as_f64().filter(|value| *value > 0.0 && *value <= Handle::MAX as f64 && value.fract() == 0.0).map(|value| value as Handle)
}

/// The headers of a request or a response as `[name, value]` pairs
fn headers_value(headers: &Headers) -> Array {
    headers.iter().map(|(name, value)| Array::of2(&JsValue::from_str(name), &JsValue::from_str(value))).collect()
}

/// A request as the HTTP client of the host takes it
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

/// A response of the host. A successful one may keep its body with the host, the module passes it on unread.
pub(crate) fn response_keeping(value: &JsValue, keep_body: bool) -> Result<HttpResponse, HostError> {
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

/// A count of a JS object
fn count_of(value: &JsValue, key: &str) -> u64 {
    field(value, key).and_then(|n| n.as_f64()).unwrap_or_default().max(0.0) as u64
}

/// A table of the host with its counts
pub(crate) fn host_table(value: &JsValue) -> HostTable {
    HostTable { rows: count_of(value, "rows"), columns: count_of(value, "columns"), batches: count_of(value, "batches") }
}

/// The details of a log message as `[key, value]` pairs
fn details_value(details: &[(&str, &str)]) -> Array {
    details.iter().map(|(key, value)| Array::of2(&JsValue::from_str(key), &JsValue::from_str(value))).collect()
}

impl JsPlatform {
    pub fn new(object: JsRuntimePlatform) -> Self {
        Self { inner: Rc::new(Inner { object, pending: RefCell::new(Pending::default()), last_request: Cell::new(0.0) }) }
    }

    fn object(&self) -> &JsValue {
        &self.inner.object
    }

    /// Tell the host that the state changed. The host is told once until it takes the changes, again only when a
    /// change becomes urgent.
    pub fn signal(&self, urgent: bool) {
        let tell = {
            let mut pending = self.inner.pending.borrow_mut();
            let tell = match pending.signaled {
                None => true,
                Some(signaled) => urgent && !signaled,
            };
            if tell {
                pending.signaled = Some(urgent);
            }
            tell
        };
        if tell {
            let _ = call(self.object(), "changed", &[JsValue::from_bool(urgent)]);
        }
    }

    /// Collect the effects of the computations on handles
    pub fn push_effects(&self, effects: &[ComputationEffect]) {
        let mut pending = self.inner.pending.borrow_mut();
        for effect in effects {
            match *effect {
                ComputationEffect::Abort { handle, reason } => pending.effects.push(HandleEffect::Abort { handle, reason: reason.to_string() }),
                ComputationEffect::Release { handle } => pending.effects.push(HandleEffect::Release { handle }),
                // The service cancels the runs of a search and drops the data frames
                ComputationEffect::AbortDataSearch { .. } | ComputationEffect::ReleaseDataFrame { .. } => {}
            }
        }
    }

    /// Collect the effects of the connections and the queries on handles, returns what the services of the runtime do
    pub fn push_registry_effects(&self, effects: &[RegistryEffect]) -> RegistryFollowUp {
        let mut follow_up = RegistryFollowUp::default();
        let mut pending = self.inner.pending.borrow_mut();
        for effect in effects {
            match *effect {
                RegistryEffect::Release { handle } => pending.effects.push(HandleEffect::Release { handle }),
                RegistryEffect::Close { handle } => pending.effects.push(HandleEffect::Close { handle }),
                RegistryEffect::Abort { handle, reason } => pending.effects.push(HandleEffect::Abort { handle, reason: reason.to_string() }),
                RegistryEffect::CancelSetup => follow_up.cancel_setup = true,
                RegistryEffect::CancelCatalogUpdate { task_id, reason } => follow_up.cancel_catalog_updates.push((task_id, reason)),
            }
        }
        follow_up
    }

    /// Close a handle with the next changes, e.g. a channel that a setup doesn't hand out
    pub fn push_close(&self, handle: Handle) {
        self.inner.pending.borrow_mut().effects.push(HandleEffect::Close { handle });
    }

    /// Release a handle with the next changes
    pub fn push_release(&self, handle: Handle) {
        self.inner.pending.borrow_mut().effects.push(HandleEffect::Release { handle });
    }

    /// Take the effects on handles, the host is told again with the next change
    pub fn take_effects(&self) -> Vec<HandleEffect> {
        let mut pending = self.inner.pending.borrow_mut();
        pending.signaled = None;
        std::mem::take(&mut pending.effects)
    }

    /// Log a message on a target
    pub fn log_on(&self, level: LogLevel, message: &str, details: &[(&str, &str)], target: &str) {
        let args = [JsValue::from_str(level.name()), JsValue::from_str(message), details_value(details).into(), JsValue::from_str(target)];
        let _ = call(self.object(), "log", &args);
    }

    /// Keep an object in the handle table of the host
    pub fn register(&self, object: &JsValue) -> Result<Handle, HostError> {
        let handles = member(self.object(), "handles")?;
        as_handle(&call(&handles, "register", std::slice::from_ref(object))?).ok_or_else(|| HostError::new("the handle table returned no handle"))
    }

    /// The object of a handle, undefined for none
    pub fn handle(&self, handle: Handle) -> JsValue {
        member(self.object(), "handles").and_then(|handles| call(&handles, "get", &[JsValue::from_f64(handle as f64)])).unwrap_or(JsValue::UNDEFINED)
    }

    /// Keep the object of a handle under a new handle as well
    pub fn duplicate(&self, handle: Handle) -> Result<Handle, HostError> {
        let handles = member(self.object(), "handles")?;
        as_handle(&call(&handles, "duplicate", &[JsValue::from_f64(handle as f64)])?).ok_or_else(|| HostError::new("the handle table returned no handle"))
    }

    /// Read a table of the handle table as an Arrow IPC stream
    pub fn read_table(&self, table: Handle) -> Result<Vec<u8>, HostError> {
        let tables = member(self.object(), "tables")?;
        let ipc = call(&tables, "read", &[JsValue::from_f64(table as f64)])?;
        if !ipc.is_object() {
            return Err(HostError::new("the table is no Arrow IPC stream"));
        }
        // The bytes may come from another realm, they are copied by value
        Ok(Uint8Array::new(&ipc).to_vec())
    }

    /// Open a table that streams in parts
    pub fn open_table(&self) -> Result<Handle, HostError> {
        let tables = member(self.object(), "tables")?;
        as_handle(&call(&tables, "open", &[])?).ok_or_else(|| HostError::new("the tables returned no handle"))
    }

    /// Push the next part of a table that streams
    pub fn push_table(&self, table: Handle, part: &JsValue) -> Result<(), HostError> {
        let tables = member(self.object(), "tables")?;
        call(&tables, "push", &[JsValue::from_f64(table as f64), part.clone()])?;
        Ok(())
    }

    /// Finish a table, it is a table of the handle table from then on
    pub fn finish_table(&self, table: Handle) -> Result<HostTable, HostError> {
        let tables = member(self.object(), "tables")?;
        Ok(host_table(&call(&tables, "finish", &[JsValue::from_f64(table as f64)])?))
    }

    /// The id of the next request or flow of the platform
    fn next_id(&self) -> f64 {
        let id = self.inner.last_request.get() + 1.0;
        self.inner.last_request.set(id);
        id
    }

    /// Connect a channel of a setup, the handle of the channel
    pub fn connect_channel(&self, setup_id: &str, request: &JsValue) -> impl Future<Output = Result<Handle, HostError>> + 'static {
        let call = member(self.object(), "channels").and_then(|channels| call(&channels, "connect", &[JsValue::from_str(setup_id), request.clone()]));
        async move {
            let value = settled(call).await?;
            as_handle(&value).ok_or_else(|| HostError::new("the platform connected no channel"))
        }
    }

    /// The token of the link to a Hyper that the page holds
    pub fn hyper_link_token(&self, connection_id: &str) -> Option<String> {
        let channels = member(self.object(), "channels").ok()?;
        call(&channels, "hyperLinkToken", &[JsValue::from_str(connection_id)]).ok()?.as_string()
    }

    /// Describe a query that the runtime runs itself, the promise of its request
    pub fn describe_query(&self, query_id: f64, connection_id: &str, description: &JsValue) -> Promise {
        let described = member(self.object(), "queries")
            .and_then(|queries| call(&queries, "describe", &[JsValue::from_f64(query_id), JsValue::from_str(connection_id), description.clone()]));
        match described {
            Ok(value) => Promise::resolve(&value),
            Err(error) => Promise::reject(&JsError::new(error.message()).into()),
        }
    }

    /// A query that the runtime ran itself ended
    pub fn forget_query(&self, query_id: f64) {
        if let Ok(queries) = member(self.object(), "queries") {
            let _ = call(&queries, "forget", &[JsValue::from_f64(query_id)]);
        }
    }

    /// The OAuth flows of the platform
    fn oauth(&self) -> Result<JsValue, HostError> {
        member(self.object(), "oauth")
    }

    /// A PKCE challenge of the platform
    pub fn oauth_pkce(&self) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        settled(self.oauth().and_then(|oauth| call(&oauth, "pkce", &[])))
    }

    /// How the platform takes the user of a setup through the redirect page
    pub fn oauth_flow_info(&self, setup_id: &str) -> JsValue {
        self.oauth().and_then(|oauth| call(&oauth, "flowInfo", &[JsValue::from_str(setup_id)])).unwrap_or(JsValue::NULL)
    }

    /// Run an OAuth flow of a setup until its callback, the token stops it. `method` is the member of the flow, `args`
    /// follow the id of the setup and the id of the flow.
    pub fn oauth_authorize(
        &self,
        method: &str,
        setup_id: &str,
        args: &[JsValue],
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let flow = self.next_id();
        let oauth = self.oauth();
        let mut all = vec![JsValue::from_str(setup_id), JsValue::from_f64(flow)];
        all.extend_from_slice(args);
        // A flow that is cancelled rejects after the runtime stopped waiting, its rejection is handled right away. The
        // handler lives as long as the page, a flow is rare.
        let sent = oauth.clone().and_then(|oauth| call(&oauth, method, &all)).map(|sent| {
            let promise = Promise::resolve(&sent);
            let handler = Closure::<dyn FnMut(JsValue)>::new(|_| {});
            let _ = promise.catch(&handler);
            handler.forget();
            promise
        });
        let token = cancellation.clone();
        async move {
            let promise = sent?;
            match token.run(JsFuture::from(promise)).await {
                None => {
                    if let Ok(oauth) = oauth {
                        let _ = call(&oauth, "abort", &[JsValue::from_f64(flow)]);
                    }
                    Err(HostError::new(CANCELLED_MESSAGE))
                }
                Some(result) => result.map_err(host_error),
            }
        }
    }

    /// Load the spec of the client functions of an extension, the JSON text
    pub fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static {
        let call = member(self.object(), "extensions").and_then(|extensions| call(&extensions, "loadSpec", &[JsValue::from_str(extension)]));
        async move { settled(call).await?.as_string().ok_or_else(|| HostError::new("a spec that isn't text")) }
    }

    /// The Data Cloud metadata of a data space from the API of Salesforce of the platform as JSON, none to fetch it
    pub fn salesforce_metadata(&self, connection_id: &str, data_space: &str) -> impl Future<Output = Result<Option<String>, HostError>> + 'static {
        let call = member(self.object(), "salesforce")
            .ok()
            .map(|salesforce| call(&salesforce, "metadata", &[JsValue::from_str(connection_id), JsValue::from_str(data_space)]));
        async move {
            let Some(call) = call else { return Ok(None) };
            Ok(settled(call).await?.as_string())
        }
    }

    /// Call a member of the storage of the platform
    pub fn storage_call(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        let storage = member(self.object(), "storage").map_err(|_| HostError::new("the platform has no storage"))?;
        call(&storage, name, args)
    }

    /// A random id
    pub fn random_uuid(&self) -> Result<String, HostError> {
        let crypto = member(self.object(), "crypto")?;
        call(&crypto, "randomUuid", &[])?.as_string().ok_or_else(|| HostError::new("the platform returned no id"))
    }

    /// The compute database, an error until the host set it up
    fn compute(&self) -> Result<JsValue, HostError> {
        member(self.object(), "compute").map_err(|_| HostError::new("the platform has no compute database"))
    }

    /// Is there a compute database?
    pub fn has_compute(&self) -> bool {
        self.compute().is_ok()
    }

    /// The query result cache, an error without one
    fn result_cache(&self) -> Result<JsValue, HostError> {
        member(self.object(), "resultCache").map_err(|_| HostError::new("the platform has no query result cache"))
    }

    /// Call a member of the channels of the host
    fn channels(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        call(&member(self.object(), "channels")?, name, args)
    }

    /// Run a query on its channel of the host, the batches go into the table
    pub fn channel_open(&self, query_id: f64, table: Handle) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let call = self.channels("open", &[JsValue::from_f64(query_id), JsValue::from_f64(table as f64)]);
        async move { settled(call).await.map(|value| value.is_truthy()) }
    }

    /// The next message of the stream of a query on a channel
    pub fn channel_next(&self, query_id: f64) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let call = self.channels("next", &[JsValue::from_f64(query_id)]);
        settled(call)
    }

    /// Cancel the query of a channel at the backend
    pub fn channel_cancel(&self, query_id: f64) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.channels("cancel", &[JsValue::from_f64(query_id)]);
        async move { settled(call).await.map(|_| ()) }
    }

    /// Is the profile of a query on a channel shown?
    pub fn channel_profile_detail(&self, query_id: f64, shown: bool) {
        let _ = self.channels("profileDetail", &[JsValue::from_f64(query_id), JsValue::from_bool(shown)]);
    }

    /// Look up a key in the query result cache
    pub fn cache_lookup(&self, key: &str) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let call = self.result_cache().and_then(|cache| call(&cache, "lookup", &[JsValue::from_str(key)]));
        settled(call)
    }

    /// Read a cached file into a table
    pub fn cache_read(&self, name: &str) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let call = self.result_cache().and_then(|cache| call(&cache, "read", &[JsValue::from_str(name)]));
        settled(call)
    }

    /// Record a read of a cached file
    pub fn cache_touch(&self, name: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.result_cache().and_then(|cache| call(&cache, "touch", &[JsValue::from_str(name)]));
        async move { settled(call).await.map(|_| ()) }
    }

    /// Write a table as the newest file of a key. The host takes the table when it is called.
    pub fn cache_write(&self, key: &str, table: Handle) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.result_cache().and_then(|cache| call(&cache, "write", &[JsValue::from_str(key), JsValue::from_f64(table as f64)]));
        async move { settled(call).await.map(|_| ()) }
    }

    /// Send a request with the fetch of the platform, a successful response may keep its body with the host
    pub fn send(&self, request: HttpRequest, cancellation: &CancellationToken, keep_body: bool) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let id = self.next_id();
        let http = member(self.object(), "http");
        let token = cancellation.clone();
        let sent = if token.is_cancelled() {
            None
        } else {
            Some(http.clone().and_then(|http| call(&http, "fetch", &[JsValue::from_f64(id), request_value(&request)])))
        };
        async move {
            let Some(sent) = sent else {
                return Err(HostError::new(CANCELLED_MESSAGE));
            };
            let promise = Promise::resolve(&sent?);
            match token.run(JsFuture::from(promise)).await {
                None => {
                    if let Ok(http) = http {
                        let _ = call(&http, "abort", &[JsValue::from_f64(id)]);
                    }
                    Err(HostError::new(CANCELLED_MESSAGE))
                }
                Some(Ok(value)) => response_keeping(&value, keep_body),
                Some(Err(value)) => Err(host_error(value)),
            }
        }
    }
}

/// The context of a call of the compute platform as a JS object
fn context_js(context: &ComputeContext) -> Result<JsValue, HostError> {
    let context = ComputeCallContext {
        table_id: context.table_id,
        title: context.title.to_string(),
        connection_id: context.connection_id.clone(),
        client_context: context.client_context.clone(),
        run: context.run,
    };
    Ts::from_rust(&context).map(JsValue::from).map_err(|e| HostError::new(e.to_string()))
}

impl Host for JsPlatform {
    fn now(&self) -> f64 {
        member(self.object(), "clock")
            .and_then(|clock| call(&clock, "now", &[]))
            .ok()
            .and_then(|now| now.as_f64())
            .unwrap_or_else(js_sys::Date::now)
    }

    fn sleep(&self, ms: f64) -> impl std::future::Future<Output = ()> + 'static {
        let slept = member(self.object(), "clock").and_then(|clock| call(&clock, "sleep", &[JsValue::from_f64(ms)]));
        async move {
            let _ = settled(slept).await;
        }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let _ = call(self.object(), "log", &[JsValue::from_str(level.name()), JsValue::from_str(message), details_value(details).into()]);
    }
}

impl HttpHost for JsPlatform {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.send(request, cancellation, false)
    }
}

impl ComputeHost for JsPlatform {
    async fn import_table(&self, data_frame: u64, table_name: &str, ipc: Vec<u8>, context: &ComputeContext) -> Result<(), HostError> {
        let compute = self.compute()?;
        let bytes = Uint8Array::from(ipc.as_slice());
        let args = [JsValue::from_f64(data_frame as f64), JsValue::from_str(table_name), bytes.into(), context_js(context)?];
        settled(call(&compute, "importTable", &args)).await?;
        Ok(())
    }

    async fn create_table(&self, data_frame: u64, table_name: &str, sql: &str, context: &ComputeContext) -> Result<(), HostError> {
        let compute = self.compute()?;
        let args = [JsValue::from_f64(data_frame as f64), JsValue::from_str(table_name), JsValue::from_str(sql), context_js(context)?];
        settled(call(&compute, "createTable", &args)).await?;
        Ok(())
    }

    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError> {
        let compute = self.compute()?;
        let value = settled(call(&compute, "query", &[JsValue::from_str(sql), context_js(context)?])).await?;
        if !value.is_object() {
            return Err(HostError::new("the compute database returned no Arrow IPC stream"));
        }
        // The bytes may come from another realm, they are copied by value
        Ok(Uint8Array::new(&value).to_vec())
    }

    async fn drop_table(&self, data_frame: u64, table_name: &str) -> Result<(), HostError> {
        let compute = self.compute()?;
        settled(call(&compute, "dropTable", &[JsValue::from_f64(data_frame as f64), JsValue::from_str(table_name)])).await?;
        Ok(())
    }

    fn register_table(&self, ipc: &[u8]) -> Result<Handle, HostError> {
        let tables = member(self.object(), "tables")?;
        let table = call(&tables, "begin", &[Uint8Array::from(ipc).into()])?;
        let handle = as_handle(&table).ok_or_else(|| HostError::new("the tables returned no handle"))?;
        call(&tables, "finish", &[table])?;
        Ok(handle)
    }

    fn release(&self, handle: Handle) {
        if let Ok(handles) = member(self.object(), "handles") {
            let _ = call(&handles, "release", &[JsValue::from_f64(handle as f64)]);
        }
    }

    fn cancel(&self, run: RunId) {
        if let Ok(compute) = self.compute() {
            let _ = call(&compute, "cancel", &[JsValue::from_f64(run as f64)]);
        }
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        self.push_effects(effects);
        self.signal(false);
    }
}

/// A token of the lifetime of a computation in the handle table, the runtime aborts and releases it with the
/// computation
pub fn lifetime_token() -> JsValue {
    Object::new().into()
}
