//! The platform of the runtime: one JavaScript object that the runtime calls for its I/O (docs/wip/runtime_api.md),
//! and `JsPlatform`, the host of the services of the crate over it.
//!
//! The platform holds the handle table, the Arrow tables by handle, the compute database, the clock and the log. The
//! runtime tells it that its state changed (`changed`), the store of the app then takes the changes and reads the
//! views. Every call into the platform catches: a member that throws or is missing fails the call of the service with a
//! `HostError` and never unwinds through the module. No borrow of the platform is held while it calls JavaScript, so
//! the platform may call the runtime again from any of its members.

use std::cell::RefCell;
use std::rc::Rc;

use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, RunId};
use dashql_core_runtime::compute::ComputationEffect;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
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
    /** Log a message with its details as key value pairs */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: [string, string][]): void;
    /** The handle table of the host objects that the runtime names by a number */
    handles: { register(object: unknown): number; release(handle: number): void };
    /** The Arrow tables of the host by handle, result data never enters the module */
    tables: RuntimeTables;
    /** The compute database of the computations, null until the host set it up */
    readonly compute: ComputePlatform | null;
    /** The state of the runtime changed, the host takes the changes. Urgent changes are taken at the end of the task, the others before the next frame. */
    changed(urgent: boolean): void;
}

/** The Arrow tables of the host by handle */
export interface RuntimeTables {
    /** Begin a table with an Arrow IPC stream, its schema and maybe batches, returns its handle */
    begin(ipc: Uint8Array): number;
    /** Append the batches of an Arrow IPC stream to a table that began */
    append(table: number, ipc: Uint8Array): void;
    /** Finish a table, it is a table of the handle table from then on */
    finish(table: number): { rows: number; bytes: number };
    /** A table of the handle table as an Arrow IPC stream */
    read(table: number): Uint8Array;
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

/// An effect of the runtime on a handle of the host, applied by the store when it takes the changes
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HandleEffect {
    /// Forget the object of a handle
    Release { handle: u32 },
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

fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
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

impl JsPlatform {
    pub fn new(object: JsRuntimePlatform) -> Self {
        Self { inner: Rc::new(Inner { object, pending: RefCell::new(Pending::default()) }) }
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

    /// Take the effects on handles, the host is told again with the next change
    pub fn take_effects(&self) -> Vec<HandleEffect> {
        let mut pending = self.inner.pending.borrow_mut();
        pending.signaled = None;
        std::mem::take(&mut pending.effects)
    }

    /// Keep an object in the handle table of the host
    pub fn register(&self, object: &JsValue) -> Result<Handle, HostError> {
        let handles = member(self.object(), "handles")?;
        as_handle(&call(&handles, "register", std::slice::from_ref(object))?).ok_or_else(|| HostError::new("the handle table returned no handle"))
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

    /// The compute database, an error until the host set it up
    fn compute(&self) -> Result<JsValue, HostError> {
        member(self.object(), "compute").map_err(|_| HostError::new("the platform has no compute database"))
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
        let pairs: Array = details.iter().map(|(key, value)| Array::of2(&JsValue::from_str(key), &JsValue::from_str(value))).collect();
        let _ = call(self.object(), "log", &[JsValue::from_str(level.name()), JsValue::from_str(message), pairs.into()]);
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
