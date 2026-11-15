//! The wasm-bindgen API of the computations of result tables (`dashql_core_runtime::compute`).
//!
//! An action is a method call. Ids, versions and names are typed arguments, the nested values of a task or a result
//! (column groups, filter tables, summaries, cross filters) are JS objects of the views in `view.rs`. An action returns
//! a `ComputationOutcome` with the effects for the host. The state is read per computation: a computation changes its
//! revision with every change, the host reads only the computations whose revision moved, a snapshot of their fields.
//!
//! The Arrow tables of the state are Rust values with ids. The host registers a table of its own as Arrow IPC
//! (`registerArrowTable`) and names it by its id in the next action, and reads a table of the state as Arrow IPC
//! (`arrowTableIpc`). The data frames and the lifetimes are ids of the host.
//!
//! The tasks run in Rust (`dashql_core_runtime::compute::service`) on the compute database of the host
//! (`ComputeHost` in the generated declarations): `analyzeTable` analyzes a result, `runTask` runs a scheduled task.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use dashql_core::error::Error;
use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, RunId};
use dashql_core_runtime::compute::service::ComputeService;
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{
    self as rt, ArrowTable, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ColumnSummary, ComputationVersion, DataSearchColumn,
    DataSearchTable, FilterTable, FilteredColumnAggregate, OrderingTable, SkippedColumnGroup, TableAggregation,
};
use dashql_core_runtime::compute::{ComputationAction, ComputationEffect, ComputationState, SearchKind};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use js_sys::{Function, Promise, Reflect, Uint8Array};
use serde_json::{Map, Value};
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{future_to_promise, spawn_local, JsFuture};

use super::js_error;
use super::views::{from_js, to_js, value_to_js};

mod view;

use view::{
    ComputationColumnAggregate, ComputationColumnGroup, ComputationColumnTask, ComputationCrossFilter, ComputationDataSearchTable,
    ComputationFilterTable, ComputationFilteredAggregate, ComputationOrderingTable, ComputationOutcome, ComputationProgressUpdate,
    ComputationSchedulerTaskSnapshot, ComputationSnapshot, ComputationTableAggregation, ComputationTask, ComputeCallContext,
};

fn invalid(message: String) -> JsError {
    js_error(Error::invalid_argument(message))
}

/// The tables that an action names by id: the tables that the host registered for the action and the tables of the
/// state. An unknown id names a table without columns.
struct Tables<'a> {
    registered: &'a BTreeMap<u64, Arc<ResultTable>>,
    state: &'a ComputationState,
}

impl Tables<'_> {
    fn get(&self, id: u64) -> ArrowTable {
        if let Some(table) = self.registered.get(&id) {
            return ArrowTable::new(id, table.clone());
        }
        self.state.arrow_table(id).unwrap_or_else(|| ArrowTable::new(id, Arc::new(ResultTable::empty())))
    }

    fn filter(&self, v: ComputationFilterTable) -> FilterTable {
        FilterTable {
            input_row_number_column_name: v.input_row_number_column_name,
            table: self.get(v.table.id),
            data_frame: v.data_frame,
            version: v.version.into(),
        }
    }

    fn ordering(&self, v: ComputationOrderingTable) -> OrderingTable {
        OrderingTable {
            input_row_number_column_name: v.input_row_number_column_name,
            ordering_constraints: v.ordering_constraints.into_iter().map(Into::into).collect(),
            table: self.get(v.table.id),
            data_frame: v.data_frame,
            version: v.version.into(),
            data_search_request_id: v.data_search_request_id,
        }
    }

    fn data_search(&self, v: ComputationDataSearchTable) -> DataSearchTable {
        DataSearchTable {
            input_row_number_column_name: v.input_row_number_column_name,
            table: self.get(v.table.id),
            data_frame: v.data_frame,
            version: v.version.into(),
            request_id: v.request_id,
        }
    }

    fn aggregation(&self, v: Option<ComputationTableAggregation>) -> TableAggregation {
        let v = v.unwrap_or(ComputationTableAggregation { table: 0, data_frame: 0, count_star_field_name: String::new() });
        TableAggregation { table: self.get(v.table), data_frame: v.data_frame, count_star_field_name: v.count_star_field_name }
    }

    fn aggregate(&self, v: Option<ComputationColumnAggregate>) -> ColumnAggregate {
        let summary = |s: view::ComputationColumnSummary| ColumnSummary { table: self.get(s.id), data_frame: s.data_frame, analysis: None };
        match v {
            Some(ComputationColumnAggregate::Ordinal(s)) => ColumnAggregate::Ordinal(summary(s)),
            Some(ComputationColumnAggregate::String(s)) => ColumnAggregate::String(summary(s)),
            Some(ComputationColumnAggregate::List(s)) => ColumnAggregate::List(summary(s)),
            Some(ComputationColumnAggregate::Skipped) | None => ColumnAggregate::Skipped,
        }
    }

    fn filtered(&self, v: ComputationFilteredAggregate) -> FilteredColumnAggregate {
        FilteredColumnAggregate {
            aggregate: self.aggregate(Some(v.aggregate)),
            filter_version: v.filter_version.into(),
            data_search_request_id: v.data_search_request_id,
        }
    }

    fn column_task(&self, v: ComputationColumnTask) -> ColumnAggregationTask {
        ColumnAggregationTask {
            table_id: v.table_id,
            table_version: v.table_version.into(),
            column_id: v.column_id,
            column_entry: v.column_entry.map(ColumnGroup::from).unwrap_or_else(|| {
                ColumnGroup::Skipped(SkippedColumnGroup { input_field_name: String::new(), input_field_type: String::new(), input_field_nullable: false })
            }),
            input_data_frame: v.input_data_frame,
            table_aggregate: self.aggregation(v.table_aggregate),
        }
    }

    fn task(&self, v: ComputationTask) -> rt::ComputationTask {
        let groups = |groups: Vec<ComputationColumnGroup>| groups.into_iter().map(ColumnGroup::from).collect();
        match v {
            ComputationTask::TableFiltering { table_id, table_version, input_data_table, input_data_frame, row_number_column_name, filters } => {
                rt::ComputationTask::TableFiltering(rt::TableFilteringTask {
                    table_id,
                    table_version: table_version.into(),
                    input_data_table: self.get(input_data_table.id),
                    input_data_frame,
                    row_number_column_name,
                    filters: filters.into_iter().map(Into::into).collect(),
                })
            }
            ComputationTask::TableOrdering {
                table_id,
                table_version,
                input_data_table,
                input_data_frame,
                filter_table,
                data_search_table,
                row_number_column_name,
                ordering_constraints,
            } => rt::ComputationTask::TableOrdering(rt::TableOrderingTask {
                table_id,
                table_version: table_version.into(),
                input_data_table: self.get(input_data_table.id),
                input_data_frame,
                filter_table: filter_table.map(|t| self.filter(t)),
                data_search_table: data_search_table.map(|t| self.data_search(t)),
                row_number_column_name,
                ordering_constraints: ordering_constraints.into_iter().map(Into::into).collect(),
            }),
            ComputationTask::TableAggregation { table_id, table_version, column_entries, input_data_frame } => {
                rt::ComputationTask::TableAggregation(rt::TableAggregationTask {
                    table_id,
                    table_version: table_version.into(),
                    column_entries: groups(column_entries),
                    input_data_frame,
                })
            }
            ComputationTask::SystemColumns {
                table_id,
                table_version,
                column_entries,
                input_table,
                input_data_frame,
                row_number_field_name,
                table_aggregate,
            } => rt::ComputationTask::SystemColumns(rt::SystemColumnsTask {
                table_id,
                table_version: table_version.into(),
                column_entries: groups(column_entries),
                input_table: self.get(input_table.id),
                input_data_frame,
                row_number_field_name,
                table_aggregate: self.aggregation(table_aggregate),
            }),
            ComputationTask::ColumnAggregation(task) => rt::ComputationTask::ColumnAggregation(self.column_task(task)),
            ComputationTask::FilteredColumnAggregation { column, filter_table, data_search_table, selection_row_count, unfiltered_aggregate } => {
                rt::ComputationTask::FilteredColumnAggregation(rt::FilteredColumnAggregationTask {
                    column: self.column_task(column),
                    filter_table: filter_table.map(|t| self.filter(t)),
                    data_search_table: data_search_table.map(|t| self.data_search(t)),
                    selection_row_count,
                    unfiltered_aggregate: self.aggregate(unfiltered_aggregate),
                })
            }
            ComputationTask::DataSearch { table_id, table_version, input_data_frame, row_number_column_name, columns, pattern, request_id } => {
                rt::ComputationTask::DataSearch(rt::DataSearchTask {
                    table_id,
                    table_version: table_version.into(),
                    input_data_frame,
                    row_number_column_name,
                    columns: columns
                        .into_iter()
                        .map(|c| DataSearchColumn { column_idx: c.column_idx, column_group_idx: c.column_group_idx, field_name: c.field_name })
                        .collect(),
                    pattern,
                    request_id,
                })
            }
        }
    }
}

/// The version that a task of the scheduler is computed for
fn task_version(task: &rt::ComputationTask) -> ComputationVersion {
    match task {
        rt::ComputationTask::TableFiltering(task) => task.table_version,
        rt::ComputationTask::TableOrdering(task) => task.table_version,
        rt::ComputationTask::TableAggregation(task) => task.table_version,
        rt::ComputationTask::SystemColumns(task) => task.table_version,
        rt::ComputationTask::ColumnAggregation(task) => task.table_version,
        rt::ComputationTask::FilteredColumnAggregation(task) => task.column.table_version,
        rt::ComputationTask::DataSearch(task) => task.table_version,
    }
}

fn id(value: f64) -> u64 {
    if value.is_finite() && value >= 0.0 {
        value as u64
    } else {
        0
    }
}

fn time(value: f64) -> i64 {
    if value.is_finite() {
        value as i64
    } else {
        0
    }
}

fn search_kind(data: bool) -> SearchKind {
    if data {
        SearchKind::Data
    } else {
        SearchKind::Columns
    }
}

#[wasm_bindgen(typescript_custom_section)]
const COMPUTE_HOST: &str = r#"
/** The compute database of the computations, the embedded Hyper of the platform. The context of a call names the computation, the title of its task, the connection and the client context of the computation, and the run that `cancel` aborts. Tables cross as Arrow IPC streams. */
export interface ComputeHost {
    /** Log a message, the details are a JSON object of strings */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: string): void;
    /** Create the table of a data frame from an Arrow IPC stream */
    importTable(dataFrame: number, tableName: string, ipc: Uint8Array, context: ComputeCallContext): Promise<void>;
    /** Create the table of a data frame from a SELECT, the host tracks the SELECT as a query of the task */
    createTable(dataFrame: number, tableName: string, sql: string, context: ComputeCallContext): Promise<void>;
    /** Run a query, resolves to its result as an Arrow IPC stream */
    query(sql: string, context: ComputeCallContext): Promise<Uint8Array>;
    /** Drop the table of a data frame, unless the host still reads it */
    dropTable(dataFrame: number, tableName: string): Promise<void>;
    /** Abort the calls of a run */
    cancel(run: number): void;
    /** A task changed the state, the effects of its actions in order */
    changed(effects: ComputationEffect[]): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "ComputeHost")]
    #[derive(Clone)]
    pub type JsComputeHostObject;

    #[wasm_bindgen(method, catch)]
    fn log(this: &JsComputeHostObject, level: &str, message: &str, details: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch, js_name = importTable)]
    fn import_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str, ipc: &Uint8Array, context: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = createTable)]
    fn create_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str, sql: &str, context: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn query(this: &JsComputeHostObject, sql: &str, context: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch, js_name = dropTable)]
    fn drop_table(this: &JsComputeHostObject, data_frame: f64, table_name: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(method, catch)]
    fn cancel(this: &JsComputeHostObject, run: f64) -> Result<(), JsValue>;
    #[wasm_bindgen(method, catch)]
    fn changed(this: &JsComputeHostObject, effects: &JsValue) -> Result<(), JsValue>;
}

/// The message of a value that JS failed with, an error of another realm too
fn message_of(value: &JsValue) -> String {
    if let Some(message) = value.is_object().then(|| Reflect::get(value, &JsValue::from_str("message")).ok()).flatten().and_then(|m| m.as_string()) {
        return message;
    }
    value.as_string().unwrap_or_else(|| "the compute host failed".to_string())
}

fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// Await a host call that returns a promise
async fn host_call(result: Result<JsValue, JsValue>) -> Result<JsValue, HostError> {
    let value = result.map_err(host_error)?;
    JsFuture::from(Promise::resolve(&value)).await.map_err(host_error)
}

/// The context of a host call as a JS object
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

/// The compute host over the JS object, which the host sets after creating the computations
#[derive(Default)]
pub struct JsComputeHost {
    host: RefCell<Option<JsComputeHostObject>>,
}

impl JsComputeHost {
    fn object(&self) -> Result<JsComputeHostObject, HostError> {
        self.host.borrow().clone().ok_or_else(|| HostError::new("the computations have no compute host"))
    }
}

impl Host for JsComputeHost {
    fn now(&self) -> f64 {
        js_sys::Date::now()
    }

    fn sleep(&self, ms: f64) -> impl std::future::Future<Output = ()> + 'static {
        let promise = Promise::new(&mut |resolve: Function, _reject: Function| {
            let global = js_sys::global();
            let set_timeout = Reflect::get(&global, &JsValue::from_str("setTimeout")).ok().and_then(|f| f.dyn_into::<Function>().ok());
            let scheduled = set_timeout.is_some_and(|set_timeout| set_timeout.call2(&global, &resolve, &JsValue::from_f64(ms)).is_ok());
            if !scheduled {
                let _ = resolve.call0(&JsValue::UNDEFINED);
            }
        });
        async move {
            let _ = JsFuture::from(promise).await;
        }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let details: Map<String, Value> = details.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect();
        if let Some(host) = self.host.borrow().as_ref() {
            let _ = host.log(level.name(), message, &Value::Object(details).to_string());
        }
    }
}

impl ComputeHost for JsComputeHost {
    async fn import_table(&self, data_frame: u64, table_name: &str, ipc: Vec<u8>, context: &ComputeContext) -> Result<(), HostError> {
        let host = self.object()?;
        let bytes = Uint8Array::from(ipc.as_slice());
        host_call(host.import_table(data_frame as f64, table_name, &bytes, &context_js(context)?)).await?;
        Ok(())
    }

    async fn create_table(&self, data_frame: u64, table_name: &str, sql: &str, context: &ComputeContext) -> Result<(), HostError> {
        let host = self.object()?;
        host_call(host.create_table(data_frame as f64, table_name, sql, &context_js(context)?)).await?;
        Ok(())
    }

    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError> {
        let host = self.object()?;
        let value = host_call(host.query(sql, &context_js(context)?)).await?;
        // The bytes may come from another realm, e.g. a frame that shares the module, they are copied by value
        if !value.is_object() {
            return Err(HostError::new("the compute host returned no Arrow IPC stream"));
        }
        Ok(Uint8Array::new(&value).to_vec())
    }

    async fn drop_table(&self, data_frame: u64, table_name: &str) -> Result<(), HostError> {
        let host = self.object()?;
        host_call(host.drop_table(data_frame as f64, table_name)).await?;
        Ok(())
    }

    fn cancel(&self, run: RunId) {
        if let Some(host) = self.host.borrow().as_ref() {
            let _ = host.cancel(run as f64);
        }
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        let host = self.host.borrow().clone();
        if let Some(host) = host {
            if let Ok(effects) = value_to_js(&view::effects(effects)) {
                let _ = host.changed(&effects);
            }
        }
    }
}

/// The error of a task as a JS error
fn task_error(error: Error) -> JsValue {
    JsError::new(error.what()).into()
}

/// The computations of the result tables and the tasks of the scheduler
#[wasm_bindgen]
pub struct Computations {
    service: ComputeService<JsComputeHost>,
    /// The tables that the host registered for its next action
    registered: RefCell<BTreeMap<u64, Arc<ResultTable>>>,
}

impl Computations {
    /// Read the values of an action with the tables it names
    fn read<T>(&self, read: impl FnOnce(&Tables) -> T) -> T {
        let registered = self.registered.borrow();
        self.service.read(|state| read(&Tables { registered: &registered, state }))
    }

    /// Apply an action, the registered tables that it didn't take go
    fn apply(&self, action: ComputationAction) -> Result<Ts<ComputationOutcome>, JsError> {
        let outcome = self.service.apply(action).map_err(js_error);
        self.registered.borrow_mut().clear();
        to_js(&ComputationOutcome::from(outcome?))
    }

    fn table(&self, table: f64) -> ArrowTable {
        self.read(|tables| tables.get(id(table)))
    }

    fn column_groups(column_groups: &[Ts<ComputationColumnGroup>]) -> Result<Vec<ColumnGroup>, JsError> {
        column_groups.iter().map(|group| from_js(group).map(ColumnGroup::from)).collect()
    }
}

impl Default for Computations {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Computations {
    /// A state without computations
    #[wasm_bindgen(constructor)]
    pub fn new() -> Computations {
        Computations { service: ComputeService::new(JsComputeHost::default()), registered: RefCell::new(BTreeMap::new()) }
    }

    /// Set the compute host, the tasks run on its compute database
    #[wasm_bindgen(js_name = setHost)]
    pub fn set_host(&self, host: JsComputeHostObject) {
        *self.service.host().host.borrow_mut() = Some(host);
    }

    /// A new id of a data frame, an Arrow table or a lifetime of the host
    #[wasm_bindgen(js_name = allocateId)]
    pub fn allocate_id(&self) -> f64 {
        self.service.allocate_id() as f64
    }

    /// Register a table of the host as Arrow IPC, the next action names it by the returned id
    #[wasm_bindgen(js_name = registerArrowTable)]
    pub fn register_arrow_table(&self, ipc: &[u8]) -> Result<f64, JsError> {
        let table = ResultTable::from_ipc_stream(ipc).map_err(js_error)?;
        let id = self.service.allocate_id();
        self.registered.borrow_mut().insert(id, Arc::new(table));
        Ok(id as f64)
    }

    /// A table of the state as Arrow IPC
    #[wasm_bindgen(js_name = arrowTableIpc)]
    pub fn arrow_table_ipc(&self, table: f64) -> Result<Vec<u8>, JsError> {
        let table = id(table);
        let found = self.service.read(|state| state.arrow_table(table));
        let found = found.ok_or_else(|| invalid(format!("the state holds no table {table}")))?;
        found.table.to_ipc_stream().map_err(js_error)
    }

    /// The tables that the state holds
    #[wasm_bindgen(js_name = arrowTableIds)]
    pub fn arrow_table_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.arrow_tables().into_iter().map(|id| id as f64).collect())
    }

    // Services

    /// Analyze a result as the computation of a table: the result as Arrow IPC, the connection that ran its query and
    /// the client context of the queries of a computation without one. Resolves once the summaries of the columns are
    /// computed, rejects with the error of a failed task.
    #[wasm_bindgen(js_name = analyzeTable)]
    pub fn analyze_table(
        &self,
        table_id: f64,
        ipc: &[u8],
        connection_id: Option<String>,
        client_context: Option<String>,
        column_aggregates: bool,
    ) -> Result<Promise, JsError> {
        let table = ResultTable::from_ipc_stream(ipc).map_err(js_error)?;
        let options = AnalyzeTableOptions { column_aggregates };
        let analysis = self.service.analyze_table(id(table_id), table, connection_id, client_context, options);
        Ok(future_to_promise(async move { analysis.await.map(|_| JsValue::UNDEFINED).map_err(task_error) }))
    }

    /// Run a scheduled task on the compute host. Resolves once its result is applied, rejects with its error.
    #[wasm_bindgen(js_name = runTask)]
    pub fn run_task(&self, task_id: f64) -> Promise {
        let run = self.service.run_task(id(task_id));
        future_to_promise(async move { run.await.map(|_| JsValue::UNDEFINED).map_err(task_error) })
    }

    /// Cancel the run of a task, it fails
    #[wasm_bindgen(js_name = cancelTask)]
    pub fn cancel_task(&self, task_id: f64) {
        self.service.cancel_task(id(task_id));
    }

    // Actions

    /// Schedule a task. The outcome holds the id of the task unless it was dropped.
    #[wasm_bindgen(js_name = scheduleTask)]
    pub fn schedule_task(&self, task: Ts<ComputationTask>, now: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        let task = from_js(&task)?;
        let task = self.read(|tables| tables.task(task));
        self.apply(ComputationAction::ScheduleTask { task, now: time(now) })
    }

    /// The scheduler reports progress of a task, the update holds what changed
    #[wasm_bindgen(js_name = updateSchedulerTask)]
    pub fn update_scheduler_task(&self, task_id: f64, progress: Ts<ComputationProgressUpdate>, now: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        let progress = from_js(&progress)?.into();
        self.apply(ComputationAction::UpdateSchedulerTask { task_id: id(task_id), progress, now: time(now) })
    }

    #[wasm_bindgen(js_name = unregisterSchedulerTask)]
    pub fn unregister_scheduler_task(&self, task_id: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::UnregisterSchedulerTask { task_id: id(task_id) })
    }

    /// Start the computation of a result table, a table that the host registered
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = computationFromQueryResult)]
    pub fn computation_from_query_result(
        &self,
        table_id: f64,
        data_table: f64,
        fields: Vec<String>,
        column_groups: Vec<Ts<ComputationColumnGroup>>,
        lifetime: f64,
        connection_id: Option<String>,
        client_context: Option<String>,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let column_groups = Self::column_groups(&column_groups)?;
        self.apply(ComputationAction::ComputationFromQueryResult {
            table_id: id(table_id),
            data_table: self.table(data_table),
            fields,
            column_groups,
            lifetime: id(lifetime),
            connection_id,
            client_context,
        })
    }

    #[wasm_bindgen(js_name = deleteComputation)]
    pub fn delete_computation(&self, table_id: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::DeleteComputation { table_id: id(table_id) })
    }

    #[wasm_bindgen(js_name = createdDataFrame)]
    pub fn created_data_frame(&self, table_id: f64, data_frame: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::CreatedDataFrame { table_id: id(table_id), data_frame: id(data_frame) })
    }

    #[wasm_bindgen(js_name = tableOrderingSucceeded)]
    pub fn table_ordering_succeeded(&self, table_id: f64, ordering: Ts<ComputationOrderingTable>, now: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        let ordering = from_js(&ordering)?;
        let ordering = self.read(|tables| tables.ordering(ordering));
        self.apply(ComputationAction::TableOrderingSucceeded { table_id: id(table_id), ordering, now: time(now) })
    }

    #[wasm_bindgen(js_name = clearTableOrdering)]
    pub fn clear_table_ordering(&self, table_id: f64) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::ClearTableOrdering { table_id: id(table_id) })
    }

    /// A filter was computed for a version, none if no filter is active
    #[wasm_bindgen(js_name = tableFilteringSucceeded)]
    pub fn table_filtering_succeeded(
        &self,
        table_id: f64,
        data_version: f64,
        filter_version: f64,
        filter: Option<Ts<ComputationFilterTable>>,
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let filter = filter.as_ref().map(from_js).transpose()?;
        let filter = filter.map(|filter| self.read(|tables| tables.filter(filter)));
        self.apply(ComputationAction::TableFilteringSucceeded {
            table_id: id(table_id),
            version: ComputationVersion::new(id(data_version), id(filter_version)),
            filter,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = tableAggregationSucceeded)]
    pub fn table_aggregation_succeeded(
        &self,
        table_id: f64,
        aggregation: Ts<ComputationTableAggregation>,
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let aggregation = from_js(&aggregation)?;
        let aggregation = self.read(|tables| tables.aggregation(Some(aggregation)));
        self.apply(ComputationAction::TableAggregationSucceeded { table_id: id(table_id), aggregation, now: time(now) })
    }

    /// The system columns were computed: a table that the host registered and the column groups
    #[wasm_bindgen(js_name = systemColumnsSucceeded)]
    pub fn system_columns_succeeded(
        &self,
        table_id: f64,
        data_table: f64,
        data_frame: f64,
        column_groups: Vec<Ts<ComputationColumnGroup>>,
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let column_groups = Self::column_groups(&column_groups)?;
        self.apply(ComputationAction::SystemColumnsSucceeded {
            table_id: id(table_id),
            data_table: self.table(data_table),
            data_frame: id(data_frame),
            column_groups,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = columnAggregationSucceeded)]
    pub fn column_aggregation_succeeded(
        &self,
        table_id: f64,
        column_id: u32,
        aggregate: Ts<ComputationColumnAggregate>,
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let aggregate = from_js(&aggregate)?;
        let aggregate = self.read(|tables| tables.aggregate(Some(aggregate)));
        self.apply(ComputationAction::ColumnAggregationSucceeded { table_id: id(table_id), column_id, aggregate, now: time(now) })
    }

    /// The summary of a column over the selected rows was computed for a version, none if there is no selection
    #[wasm_bindgen(js_name = filteredColumnAggregationSucceeded)]
    pub fn filtered_column_aggregation_succeeded(
        &self,
        table_id: f64,
        column_id: u32,
        data_version: f64,
        filter_version: f64,
        aggregate: Option<Ts<ComputationFilteredAggregate>>,
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let aggregate = aggregate.as_ref().map(from_js).transpose()?;
        let aggregate = aggregate.map(|aggregate| self.read(|tables| tables.filtered(aggregate)));
        self.apply(ComputationAction::FilteredColumnAggregationSucceeded {
            table_id: id(table_id),
            column_id,
            version: ComputationVersion::new(id(data_version), id(filter_version)),
            aggregate,
            now: time(now),
        })
    }

    /// Set the cross filters, the selections of the columns
    #[wasm_bindgen(js_name = setCrossFilters)]
    pub fn set_cross_filters(&self, table_id: f64, filters: Vec<Ts<ComputationCrossFilter>>) -> Result<Ts<ComputationOutcome>, JsError> {
        let filters = filters.iter().map(from_js).collect::<Result<Vec<_>, _>>()?;
        self.apply(ComputationAction::SetCrossFilters { table_id: id(table_id), filters: view::cross_filters(filters) })
    }

    /// Request a search of the data or of the columns, an empty pattern ends the search
    #[wasm_bindgen(js_name = setResultSearchPattern)]
    pub fn set_result_search_pattern(&self, table_id: f64, data: bool, pattern: String) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::SetResultSearchPattern { table_id: id(table_id), kind: search_kind(data), pattern })
    }

    #[wasm_bindgen(js_name = columnSearchSucceeded)]
    pub fn column_search_succeeded(
        &self,
        table_id: f64,
        data_frame: f64,
        request_id: f64,
        matching_column_groups: Vec<u32>,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::ColumnSearchSucceeded {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            matching_column_groups,
        })
    }

    /// A search of the data matched rows: the table of the matches, and the matching columns of the rows, the columns
    /// of the row `rows[i]` are `columns[offsets[i]..offsets[i + 1]]`
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = dataSearchSucceeded)]
    pub fn data_search_succeeded(
        &self,
        table_id: f64,
        data_frame: f64,
        request_id: f64,
        search: Ts<ComputationDataSearchTable>,
        rows: &[f64],
        offsets: &[u32],
        columns: &[u32],
        now: f64,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        let search = from_js(&search)?;
        let search = self.read(|tables| tables.data_search(search));
        if offsets.len() != rows.len().saturating_add(1) && !(rows.is_empty() && offsets.is_empty()) {
            return Err(invalid("the matching rows need an offset each and an end".into()));
        }
        let mut matching_rows = BTreeMap::new();
        for (i, row) in rows.iter().enumerate() {
            let (Some(begin), Some(end)) = (offsets.get(i), offsets.get(i.saturating_add(1))) else {
                break;
            };
            let row_columns = columns.get(*begin as usize..*end as usize).unwrap_or_default();
            matching_rows.insert(id(*row), row_columns.to_vec());
        }
        self.apply(ComputationAction::DataSearchSucceeded {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            search,
            matching_rows,
            now: time(now),
        })
    }

    #[wasm_bindgen(js_name = dataSearchFailed)]
    pub fn data_search_failed(&self, table_id: f64, data_frame: f64, request_id: f64, error: String) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::DataSearchFailed {
            table_id: id(table_id),
            data_frame: id(data_frame),
            request_id: id(request_id),
            error,
        })
    }

    #[wasm_bindgen(js_name = resultSearchFailed)]
    pub fn result_search_failed(
        &self,
        table_id: f64,
        data_frame: f64,
        data: bool,
        request_id: f64,
        error: String,
    ) -> Result<Ts<ComputationOutcome>, JsError> {
        self.apply(ComputationAction::ResultSearchFailed {
            table_id: id(table_id),
            data_frame: id(data_frame),
            kind: search_kind(data),
            request_id: id(request_id),
            error,
        })
    }

    // Reading the state

    /// The revision of the state, it changes with every change
    pub fn revision(&self) -> f64 {
        self.service.read(|state| state.revision() as f64)
    }

    /// The id of the next scheduled task
    #[wasm_bindgen(js_name = nextTaskId)]
    pub fn next_task_id(&self) -> f64 {
        self.service.read(|state| state.next_task_id() as f64)
    }

    /// The tables with a computation
    #[wasm_bindgen(js_name = tableIds)]
    pub fn table_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.computations().map(|(id, _)| id as f64).collect())
    }

    /// The revision of the computation of a table, none without one
    #[wasm_bindgen(js_name = computationRevision)]
    pub fn computation_revision(&self, table_id: f64) -> Option<f64> {
        self.service.read(|state| state.computation(id(table_id)).map(|computation| computation.revision() as f64))
    }

    /// The fields of the computation of a table
    #[wasm_bindgen(js_name = computationSnapshot)]
    pub fn computation_snapshot(&self, table_id: f64) -> Result<Ts<ComputationSnapshot>, JsError> {
        self.service.read(|state| {
            let computation =
                state.computation(id(table_id)).ok_or_else(|| invalid(format!("no computation of the table {table_id}")))?;
            to_js(&ComputationSnapshot::from(computation))
        })
    }

    /// The tasks of the scheduler
    #[wasm_bindgen(js_name = schedulerTaskIds)]
    pub fn scheduler_task_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.scheduler_tasks().map(|(id, _)| id as f64).collect())
    }

    /// The table and the version of a task of the scheduler, a scheduled filtering is computed for the next filter
    /// version
    #[wasm_bindgen(js_name = schedulerTaskSnapshot)]
    pub fn scheduler_task_snapshot(&self, task_id: f64) -> Result<Option<Ts<ComputationSchedulerTaskSnapshot>>, JsError> {
        self.service.read(|state| {
            let Some(task) = state.scheduler_task(id(task_id)) else {
                return Ok(None);
            };
            to_js(&ComputationSchedulerTaskSnapshot { table_id: task.table_id(), version: task_version(task).into() }).map(Some)
        })
    }

    /// The tasks that the state knows: the tasks of the scheduler and the ones that the computations track
    #[wasm_bindgen(js_name = taskIds)]
    pub fn task_ids(&self) -> Vec<f64> {
        self.service.read(|state| state.task_ids().into_iter().map(|id| id as f64).collect())
    }

    /// Does the state hold a data frame?
    #[wasm_bindgen(js_name = holdsDataFrame)]
    pub fn holds_data_frame(&self, data_frame: f64) -> bool {
        self.service.read(|state| state.holds_data_frame(id(data_frame)))
    }

    /// Does the state hold an Arrow table?
    #[wasm_bindgen(js_name = holdsArrowTable)]
    pub fn holds_arrow_table(&self, table: f64) -> bool {
        self.service.read(|state| state.holds_arrow_table(id(table)))
    }
}
