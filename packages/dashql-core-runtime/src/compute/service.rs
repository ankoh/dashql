//! The tasks of the computations as services on a compute host.
//!
//! `ComputeService` owns the computation state and runs the tasks of the scheduler on the compute database of the
//! host: a run allocates the data frame of its output, creates its table from the SQL of the plan, reads it back,
//! finishes the plan and applies the action of the result. It reports the progress of the task, drops the data frame
//! of a task that failed, and the service drops the data frames that the state releases. The analysis of a result is
//! a sequence of tasks: the import of the result with row numbers, the statistics, the system columns, then the summary
//! of every ordinal and string column.
//!
//! The tables that a run reads stay with the host: the run reads what it needs, e.g. the statistics or the bins of a
//! summary, and hands the table over to the host (`ComputeHost::register_table`), the state names it by its handle.
//!
//! Every run can be cancelled: aborting the lifetime of a computation cancels its runs, `AbortDataSearch` the run of
//! the search, `cancel_task` the run of a task. A cancelled run drops its future, tells the host to abort its calls and
//! fails its task.
//!
//! The state sits behind a `RefCell` that no task borrows across an await. A task tells the host after its actions
//! that the state changed.
//!
//! Ported from `processTask` of `packages/dashql-app/src/compute/computation_scheduler.tsx` and `analyzeTable` of
//! `packages/dashql-runtime/src/compute/analyze_table.ts`.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::rc::Rc;
use std::sync::Arc;

use arrow_schema::SchemaRef;

use crate::handles::Handle;
use dashql_core::error::{Error, Result};

use crate::host::signal::{cancellable, CancelHandle};
use crate::host::LogLevel;

use super::host::{ComputeContext, ComputeHost, RunId};
use super::tasks::analyze_table::{
    column_aggregation_tasks, start_table_analysis, system_columns_task, table_aggregation_task, AnalyzeTableOptions,
};
use super::tasks::column_aggregation::{plan_column_aggregation, plan_filtered_column_aggregation, ColumnAggregateResult};
use super::tasks::data_search::plan_data_search;
use super::tasks::result_table::ResultTable;
use super::tasks::system_columns::plan_system_columns;
use super::tasks::table_aggregation::plan_table_aggregation;
use super::tasks::table_filtering::plan_table_filtering;
use super::tasks::table_ordering::plan_table_ordering;
use super::tasks::{data_frame_table_name, TableStats, TaskQuery};
use super::types::{
    ArrowTable, ColumnAggregate, ColumnGroup, ColumnSummary, ColumnSummaryAnalysis, ComputationTask, DataFrameId,
    DataSearchTable, FilterTable, FilteredColumnAggregate, LifetimeId, OrderingTable, TableAggregation, TableId, TaskId,
    TaskProgressUpdate, TaskStatus, Timestamp,
};
use super::{ComputationAction, ComputationEffect, ComputationOutcome, ComputationState};

/// The title of the import of a result
const IMPORT_TITLE: &str = "Table import";

/// What a task computed, the values of the action that it applied
#[derive(Clone, Debug, PartialEq)]
pub enum TaskOutput {
    /// The rows that pass the filters, none without filters
    Filtering(Option<FilterTable>),
    /// The ordered rows
    Ordering(OrderingTable),
    /// The statistics with the column groups that name their fields
    TableAggregation(TableAggregation, Vec<ColumnGroup>),
    /// The table and the data frame with the system columns, and the column groups that use them
    SystemColumns(ArrowTable, DataFrameId, Vec<ColumnGroup>),
    /// The summary of a column
    ColumnAggregation(ColumnAggregate),
    /// The summary of a column over the selected rows
    FilteredColumnAggregation(FilteredColumnAggregate),
    /// The rows that a data search matched
    DataSearch(DataSearchTable),
}

/// A run of a task or of an import
struct Run {
    /// The computation
    table_id: TableId,
    /// The lifetime of the computation
    lifetime: LifetimeId,
    /// The task
    task: Option<TaskId>,
    /// The request of a data search
    search: Option<u64>,
    /// Cancels the run
    cancel: CancelHandle,
}

thread_local! {
    /// The next id of a data frame, an Arrow table, a lifetime or a run. The services of a thread share it: the tables
    /// of their data frames are named by id, and services may share a compute database.
    static NEXT_ID: std::cell::Cell<u64> = const { std::cell::Cell::new(1) };
}

struct Inner {
    state: ComputationState,
    /// The running runs
    runs: BTreeMap<RunId, Run>,
}

impl Inner {
    fn allocate(&mut self) -> u64 {
        NEXT_ID.with(|next| {
            let id = next.get();
            next.set(id.saturating_add(1));
            id
        })
    }

    /// Remove the runs that match
    fn take_runs(&mut self, matches: impl Fn(&Run) -> bool) -> Vec<(RunId, Run)> {
        let ids: Vec<RunId> = self.runs.iter().filter(|(_, run)| matches(run)).map(|(id, _)| *id).collect();
        ids.into_iter().filter_map(|id| self.runs.remove(&id).map(|run| (id, run))).collect()
    }
}

struct Shared<H: ComputeHost> {
    host: H,
    inner: RefCell<Inner>,
}

/// What a run needs of its computation
struct ComputationInfo {
    lifetime: LifetimeId,
    connection_id: Option<String>,
    client_context: Option<String>,
    /// The schema of the table of the computation
    schema: SchemaRef,
}

/// The computations with the service that runs their tasks, see the module
pub struct ComputeService<H: ComputeHost> {
    shared: Rc<Shared<H>>,
}

impl<H: ComputeHost> Clone for ComputeService<H> {
    fn clone(&self) -> Self {
        Self { shared: self.shared.clone() }
    }
}

impl<H: ComputeHost> ComputeService<H> {
    /// A service without computations
    pub fn new(host: H) -> Self {
        let inner = Inner { state: ComputationState::new(), runs: BTreeMap::new() };
        Self { shared: Rc::new(Shared { host, inner: RefCell::new(inner) }) }
    }

    pub fn host(&self) -> &H {
        &self.shared.host
    }

    /// Read the state
    pub fn read<R>(&self, read: impl FnOnce(&ComputationState) -> R) -> R {
        read(&self.shared.inner.borrow().state)
    }

    /// A new id of a data frame. The ids of the host share the counter with the ones of the tasks and with the other
    /// services of the thread.
    pub fn allocate_id(&self) -> u64 {
        self.shared.inner.borrow_mut().allocate()
    }

    /// Apply an action of the host. The service drops the data frames that the state released and cancels the runs
    /// of aborted computations and searches, the host applies the effects of the outcome that are its own.
    pub fn apply(&self, action: ComputationAction) -> Result<ComputationOutcome> {
        apply(&self.shared, action, false)
    }

    /// Cancel the run of a task, it fails
    pub fn cancel_task(&self, task_id: TaskId) {
        let runs = self.shared.inner.borrow_mut().take_runs(|run| run.task == Some(task_id));
        cancel_runs(&self.shared, runs);
    }

    /// Is a task running?
    pub fn is_running(&self, task_id: TaskId) -> bool {
        self.shared.inner.borrow().runs.values().any(|run| run.task == Some(task_id))
    }

    /// Analyze a result: start its computation, import it with row numbers, compute the statistics, the system
    /// columns and the summaries of its columns. The result is a table of the host, the handles of the table and of
    /// the lifetime of the computation go to the state; a result without columns has nothing to analyze and releases
    /// them. The analysis stops without an error once the computation is gone, e.g. replaced by the computation of a
    /// later result.
    pub fn analyze_table(
        &self,
        table_id: TableId,
        table: ResultTable,
        handles: AnalysisHandles,
        connection_id: Option<String>,
        client_context: Option<String>,
        options: AnalyzeTableOptions,
    ) -> impl Future<Output = Result<()>> + 'static {
        let shared = self.shared.clone();
        async move { analyze(&shared, table_id, table, handles, connection_id, client_context, options).await }
    }

    /// Run a scheduled task: report its progress, compute its result, apply it and unregister the task
    pub fn run_task(&self, task_id: TaskId) -> impl Future<Output = Result<TaskOutput>> + 'static {
        let shared = self.shared.clone();
        async move { run_task(&shared, task_id).await }
    }
}

fn now<H: ComputeHost>(shared: &Shared<H>) -> Timestamp {
    let now = shared.host.now();
    if now.is_finite() {
        now as Timestamp
    } else {
        0
    }
}

/// The handles of the host of an analysis: the result and the lifetime of its computation
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AnalysisHandles {
    /// The result, a table of the host
    pub table: Handle,
    /// The lifetime of the computation
    pub lifetime: LifetimeId,
}

/// A table that a run read: the rows for the finish of its plan and the Arrow IPC stream for the host
struct ReadTable {
    table: ResultTable,
    ipc: Vec<u8>,
}

impl ReadTable {
    /// The rows and the schema, what the state keeps of the table besides its handle
    fn shape(&self) -> (u64, SchemaRef) {
        (self.table.num_rows() as u64, self.table.schema().clone())
    }
}

/// Hand a table that a run read over to the host, the state names it by its handle
fn adopt<H: ComputeHost>(shared: &Shared<H>, ipc: &[u8], (rows, schema): (u64, SchemaRef)) -> Result<ArrowTable> {
    let handle = shared
        .host
        .register_table(ipc)
        .map_err(|e| Error::invalid_argument(format!("handing a table over to the host failed: {e}")))?;
    Ok(ArrowTable::new(handle, rows, schema))
}

fn cancel_runs<H: ComputeHost>(shared: &Shared<H>, runs: Vec<(RunId, Run)>) {
    for (id, run) in runs {
        run.cancel.cancel();
        shared.host.cancel(id);
    }
}

/// Drop the table of a data frame in a task of the host
fn drop_data_frame<H: ComputeHost>(shared: &Rc<Shared<H>>, data_frame: DataFrameId) {
    let task_shared = shared.clone();
    shared.host.spawn(Box::pin(async move {
        let name = data_frame_table_name(data_frame);
        if let Err(error) = task_shared.host.drop_table(data_frame, &name).await {
            let error = error.to_string();
            task_shared.host.log(LogLevel::Warn, "Failed to drop a data frame", &[("table", &name), ("error", &error)]);
        }
    }));
}

/// Apply an action, drop the released data frames and cancel the aborted runs. A task tells the host that the state
/// changed.
fn apply<H: ComputeHost>(shared: &Rc<Shared<H>>, action: ComputationAction, notify: bool) -> Result<ComputationOutcome> {
    let (outcome, cancelled) = {
        let mut inner = shared.inner.borrow_mut();
        let outcome = inner.state.apply(action)?;
        let mut cancelled = Vec::new();
        for effect in &outcome.effects {
            match effect {
                ComputationEffect::Abort { handle, .. } => {
                    cancelled.extend(inner.take_runs(|run| run.lifetime == *handle));
                }
                ComputationEffect::AbortDataSearch { table_id, request_id } => {
                    cancelled.extend(inner.take_runs(|run| run.table_id == *table_id && run.search == Some(*request_id)));
                }
                ComputationEffect::Release { .. } | ComputationEffect::ReleaseDataFrame { .. } => {}
            }
        }
        (outcome, cancelled)
    };
    cancel_runs(shared, cancelled);
    for effect in &outcome.effects {
        if let ComputationEffect::ReleaseDataFrame { data_frame } = effect {
            drop_data_frame(shared, *data_frame);
        }
    }
    if notify && (outcome.changed || !outcome.effects.is_empty()) {
        shared.host.changed(&outcome.effects);
    }
    Ok(outcome)
}

/// What a run needs of a computation, none without it
fn computation_info<H: ComputeHost>(shared: &Shared<H>, table_id: TableId) -> Option<ComputationInfo> {
    let inner = shared.inner.borrow();
    let computation = inner.state.computation(table_id)?;
    Some(ComputationInfo {
        lifetime: computation.lifetime,
        connection_id: computation.connection_id.clone(),
        client_context: computation.client_context.clone(),
        schema: computation.data_table.schema.clone(),
    })
}

fn cancelled_error(title: &str) -> Error {
    Error::invalid_argument(format!("{title} was cancelled"))
}

/// Run a future as a run of a computation that can be cancelled. The future gets the context of the run.
async fn in_run<H, F, T>(
    shared: &Rc<Shared<H>>,
    table_id: TableId,
    info: &ComputationInfo,
    title: &'static str,
    task: Option<TaskId>,
    search: Option<u64>,
    future: impl FnOnce(ComputeContext) -> F,
) -> Result<T>
where
    H: ComputeHost,
    F: Future<Output = Result<T>>,
{
    let run = shared.inner.borrow_mut().allocate();
    let context = ComputeContext {
        table_id,
        title,
        connection_id: info.connection_id.clone(),
        client_context: info.client_context.clone(),
        run,
    };
    let (future, cancel) = cancellable(future(context));
    shared.inner.borrow_mut().runs.insert(run, Run { table_id, lifetime: info.lifetime, task, search, cancel });
    let result = future.await;
    shared.inner.borrow_mut().runs.remove(&run);
    result.unwrap_or_else(|| Err(cancelled_error(title)))
}

/// Create the table of a query and read it back
async fn run_query<H: ComputeHost>(
    shared: &Shared<H>,
    query: &TaskQuery,
    context: &ComputeContext,
) -> Result<ReadTable> {
    let host = &shared.host;
    host.create_table(query.data_frame, &query.table_name, &query.sql, context).await.map_err(|e| query.failed(e))?;
    let ipc = host.query(&query.read_sql, context).await.map_err(|e| query.failed(e))?;
    let table = ResultTable::from_ipc_stream(&ipc).map_err(|e| query.failed(e))?;
    Ok(ReadTable { table, ipc })
}

/// The statistics of a table aggregation, the values that the runtime read of its table
fn stats_of(aggregation: &TableAggregation) -> Result<TableStats> {
    let unknown = || Error::invalid_argument("the statistics of the table are unknown");
    let row = aggregation.table.stats.clone().ok_or_else(unknown)?;
    let count_star_field_name = aggregation.count_star_field_name.clone();
    Ok(TableStats { data_frame: aggregation.data_frame, row, count_star_field_name })
}

/// The summary of a column of the state, its table goes to the host
fn column_aggregate<H: ComputeHost>(
    shared: &Shared<H>,
    read: &ReadTable,
    result: ColumnAggregateResult,
) -> Result<ColumnAggregate> {
    let shape = read.shape();
    Ok(match result {
        ColumnAggregateResult::Ordinal { data_frame, analysis, .. } => ColumnAggregate::Ordinal(ColumnSummary {
            table: adopt(shared, &read.ipc, shape)?,
            data_frame,
            analysis: Some(Arc::new(ColumnSummaryAnalysis::Ordinal(analysis))),
        }),
        ColumnAggregateResult::String { data_frame, analysis, .. } => ColumnAggregate::String(ColumnSummary {
            table: adopt(shared, &read.ipc, shape)?,
            data_frame,
            analysis: Some(Arc::new(ColumnSummaryAnalysis::String(analysis))),
        }),
    })
}

/// Compute the result of a task into the data frame of its output, returns the action of the result
async fn execute<H: ComputeHost>(
    shared: &Shared<H>,
    task: &ComputationTask,
    schema: &SchemaRef,
    output: DataFrameId,
    context: &ComputeContext,
) -> Result<(ComputationAction, TaskOutput)> {
    let table_id = task.table_id();
    match task {
        ComputationTask::TableFiltering(task) => {
            let Some(plan) = plan_table_filtering(task, output) else {
                let action = ComputationAction::TableFilteringSucceeded {
                    table_id,
                    version: task.table_version,
                    filter: None,
                    now: now(shared),
                };
                return Ok((action, TaskOutput::Filtering(None)));
            };
            let read = run_query(shared, &plan.query, context).await?;
            let filter = plan.finish(read.table.clone())?;
            let filter = FilterTable {
                input_row_number_column_name: filter.input_row_number_column_name,
                table: adopt(shared, &read.ipc, read.shape())?,
                data_frame: filter.data_frame,
                version: filter.version,
            };
            let action = ComputationAction::TableFilteringSucceeded {
                table_id,
                version: task.table_version,
                filter: Some(filter.clone()),
                now: now(shared),
            };
            Ok((action, TaskOutput::Filtering(Some(filter))))
        }
        ComputationTask::TableOrdering(task) => {
            let plan = plan_table_ordering(task, output);
            let read = run_query(shared, &plan.query, context).await?;
            let ordering = plan.finish(read.table.clone())?;
            let ordering = OrderingTable {
                input_row_number_column_name: ordering.input_row_number_column_name,
                ordering_constraints: ordering.ordering_constraints,
                table: adopt(shared, &read.ipc, read.shape())?,
                data_frame: ordering.data_frame,
                version: ordering.version,
                data_search_request_id: ordering.data_search_request_id,
            };
            let action = ComputationAction::TableOrderingSucceeded { table_id, ordering: ordering.clone(), now: now(shared) };
            Ok((action, TaskOutput::Ordering(ordering)))
        }
        ComputationTask::TableAggregation(task) => {
            let plan = plan_table_aggregation(task, output);
            let read = run_query(shared, &plan.query, context).await?;
            let aggregation = plan.finish(schema, read.table.clone())?;
            let stats = aggregation.stats;
            let mut table = adopt(shared, &read.ipc, read.shape())?;
            table.stats = Some(stats.row);
            let table_aggregation = TableAggregation {
                table,
                data_frame: stats.data_frame,
                count_star_field_name: stats.count_star_field_name,
            };
            let action = ComputationAction::TableAggregationSucceeded {
                table_id,
                aggregation: table_aggregation.clone(),
                now: now(shared),
            };
            Ok((action, TaskOutput::TableAggregation(table_aggregation, aggregation.column_groups)))
        }
        ComputationTask::SystemColumns(task) => {
            let plan = plan_system_columns(task, &task.input_table.schema, output)?;
            let read = run_query(shared, &plan.query, context).await?;
            let columns = plan.finish(read.table.clone())?;
            let table = adopt(shared, &read.ipc, read.shape())?;
            let action = ComputationAction::SystemColumnsSucceeded {
                table_id,
                data_table: table.clone(),
                data_frame: columns.data_frame,
                column_groups: columns.column_groups.clone(),
                now: now(shared),
            };
            Ok((action, TaskOutput::SystemColumns(table, columns.data_frame, columns.column_groups)))
        }
        ComputationTask::ColumnAggregation(task) => {
            let plan = plan_column_aggregation(task, schema, output)?;
            let read = run_query(shared, &plan.query, context).await?;
            let result = plan.finish(&stats_of(&task.table_aggregate)?, read.table.clone())?;
            let aggregate = column_aggregate(shared, &read, result)?;
            let action = ComputationAction::ColumnAggregationSucceeded {
                table_id,
                column_id: task.column_id,
                aggregate: aggregate.clone(),
                now: now(shared),
            };
            Ok((action, TaskOutput::ColumnAggregation(aggregate)))
        }
        ComputationTask::FilteredColumnAggregation(task) => {
            let plan = plan_filtered_column_aggregation(task, schema, output)?;
            let read = run_query(shared, &plan.plan.query, context).await?;
            let filtered = plan.finish(&stats_of(&task.column.table_aggregate)?, read.table.clone())?;
            let aggregate = FilteredColumnAggregate {
                aggregate: column_aggregate(shared, &read, filtered.aggregate)?,
                filter_version: filtered.filter_version,
                data_search_request_id: filtered.data_search_request_id,
            };
            let action = ComputationAction::FilteredColumnAggregationSucceeded {
                table_id,
                column_id: task.column.column_id,
                version: task.column.table_version,
                aggregate: Some(aggregate.clone()),
                now: now(shared),
            };
            Ok((action, TaskOutput::FilteredColumnAggregation(aggregate)))
        }
        ComputationTask::DataSearch(task) => {
            let plan = plan_data_search(task, output);
            let read = run_query(shared, &plan.query, context).await?;
            let search = plan.finish(read.table.clone())?;
            let table = DataSearchTable {
                input_row_number_column_name: search.input_row_number_column_name,
                table: adopt(shared, &read.ipc, read.shape())?,
                data_frame: search.data_frame,
                version: search.version,
                request_id: search.request_id,
            };
            let action = ComputationAction::DataSearchSucceeded {
                table_id,
                data_frame: task.input_data_frame,
                request_id: task.request_id,
                search: table.clone(),
                matching_rows: search.matching_rows,
                now: now(shared),
            };
            Ok((action, TaskOutput::DataSearch(table)))
        }
    }
}

/// The progress of a task that starts or fails
fn progress(shared: &Shared<impl ComputeHost>, status: TaskStatus, error: Option<String>) -> TaskProgressUpdate {
    let now = now(shared);
    match status {
        TaskStatus::Failed => TaskProgressUpdate {
            status: Some(status),
            failed_at: Some(now),
            failed_with_error: error,
            ..Default::default()
        },
        _ => TaskProgressUpdate { status: Some(status), started_at: Some(now), ..Default::default() },
    }
}

async fn run_task<H: ComputeHost>(shared: &Rc<Shared<H>>, task_id: TaskId) -> Result<TaskOutput> {
    let Some(task) = shared.inner.borrow().state.scheduler_task(task_id).cloned() else {
        return Err(Error::invalid_argument(format!("the scheduler has no task {task_id}")));
    };
    let table_id = task.table_id();
    let title = task.title();
    let unregister = |shared: &Rc<Shared<H>>| apply(shared, ComputationAction::UnregisterSchedulerTask { task_id }, true);
    let Some(info) = computation_info(shared, table_id) else {
        unregister(shared)?;
        return Err(Error::invalid_argument(format!("the table {table_id} has no computation")));
    };
    let running = progress(shared, TaskStatus::Running, None);
    apply(shared, ComputationAction::UpdateSchedulerTask { task_id, progress: running, now: now(shared) }, true)?;

    let started = shared.host.now();
    let output = shared.inner.borrow_mut().allocate();
    let search = match &task {
        ComputationTask::DataSearch(search) => Some(search.request_id),
        _ => None,
    };
    let result = in_run(shared, table_id, &info, title, Some(task_id), search, |context| {
        let shared = shared.clone();
        let task = task.clone();
        let schema = info.schema.clone();
        async move { execute(&shared, &task, &schema, output, &context).await }
    })
    .await;
    match result {
        Ok((action, output)) => {
            let duration = format!("{}", (shared.host.now() - started).max(0.0).floor());
            let table = table_id.to_string();
            shared.host.log(LogLevel::Info, &format!("{title} succeeded"), &[("table", &table), ("duration", &duration)]);
            apply(shared, action, true)?;
            unregister(shared)?;
            Ok(output)
        }
        Err(error) => {
            drop_data_frame(shared, output);
            let message = error.to_string();
            let table = table_id.to_string();
            shared.host.log(LogLevel::Warn, &format!("{title} failed"), &[("table", &table), ("error", &message)]);
            if let ComputationTask::DataSearch(search) = &task {
                let failed = ComputationAction::DataSearchFailed {
                    table_id,
                    data_frame: search.input_data_frame,
                    request_id: search.request_id,
                    error: message.clone(),
                };
                apply(shared, failed, true)?;
            }
            let failed = progress(shared, TaskStatus::Failed, Some(message));
            apply(shared, ComputationAction::UpdateSchedulerTask { task_id, progress: failed, now: now(shared) }, true)?;
            unregister(shared)?;
            Err(error)
        }
    }
}

/// Schedule a task and run it, none if its computation is gone
async fn schedule_and_run<H: ComputeHost>(shared: &Rc<Shared<H>>, task: ComputationTask) -> Result<Option<TaskOutput>> {
    let outcome = apply(shared, ComputationAction::ScheduleTask { task, now: now(shared) }, true)?;
    match outcome.task_id {
        Some(task_id) => run_task(shared, task_id).await.map(Some),
        None => Ok(None),
    }
}

/// The analysis of a result, see `ComputeService::analyze_table`
async fn analyze<H: ComputeHost>(
    shared: &Rc<Shared<H>>,
    table_id: TableId,
    table: ResultTable,
    handles: AnalysisHandles,
    connection_id: Option<String>,
    client_context: Option<String>,
    options: AnalyzeTableOptions,
) -> Result<()> {
    // The handles go to the state with the computation, an analysis that doesn't start it releases them
    let release = || {
        shared.host.release(handles.table);
        shared.host.release(handles.lifetime);
    };
    let input = shared.inner.borrow_mut().allocate();
    let start = match start_table_analysis(&table, input) {
        Ok(Some(start)) => start,
        Ok(None) => {
            release();
            return Ok(());
        }
        Err(error) => {
            release();
            return Err(error);
        }
    };
    let data_table = ArrowTable::new(handles.table, table.num_rows() as u64, table.schema().clone());
    let lifetime = handles.lifetime;
    let started = ComputationAction::ComputationFromQueryResult {
        table_id,
        data_table: data_table.clone(),
        fields: start.fields,
        column_groups: start.column_groups.clone(),
        lifetime,
        connection_id,
        client_context,
    };
    if let Err(error) = apply(shared, started, true) {
        release();
        return Err(error);
    }
    let Some(info) = computation_info(shared, table_id) else {
        return Ok(());
    };

    // Import the result with the row numbers as the first data frame
    let import = start.import;
    let ipc = import.table.to_ipc_stream()?;
    let imported = in_run(shared, table_id, &info, IMPORT_TITLE, None, None, |context| {
        let shared = shared.clone();
        let name = import.table_name.clone();
        async move {
            let failed = |e: crate::host::HostError| Error::invalid_argument(format!("importing the result failed: {e}"));
            shared.host.import_table(input, &name, ipc, &context).await.map_err(failed)
        }
    })
    .await;
    if let Err(error) = imported {
        drop_data_frame(shared, input);
        return Err(error);
    }
    apply(shared, ComputationAction::CreatedDataFrame { table_id, data_frame: input }, true)?;

    // The statistics
    let Some(TaskOutput::TableAggregation(aggregation, column_groups)) =
        schedule_and_run(shared, table_aggregation_task(table_id, start.column_groups, input).into()).await?
    else {
        return Ok(());
    };

    // The system columns
    let task = system_columns_task(table_id, column_groups, data_table, input, start.row_number_field_name, aggregation.clone());
    let Some(TaskOutput::SystemColumns(table, data_frame, column_groups)) = schedule_and_run(shared, task.into()).await? else {
        return Ok(());
    };

    // The summaries of the columns
    let started = shared.host.now();
    let tasks = column_aggregation_tasks(table_id, &column_groups, data_frame, &aggregation, options);
    let count = tasks.len();
    for task in tasks {
        if schedule_and_run(shared, ComputationTask::ColumnAggregation(task)).await?.is_none() {
            return Ok(());
        }
    }
    if count > 0 {
        let (table_name, rows, count) = (table_id.to_string(), table.rows().to_string(), count.to_string());
        let duration = format!("{}", (shared.host.now() - started).max(0.0).floor());
        let details = [("table", table_name.as_str()), ("rows", &rows), ("aggregates", &count), ("duration", &duration)];
        shared.host.log(LogLevel::Info, "Computed column aggregates", &details);
    }
    Ok(())
}

impl From<super::types::TableAggregationTask> for ComputationTask {
    fn from(task: super::types::TableAggregationTask) -> Self {
        ComputationTask::TableAggregation(task)
    }
}

impl From<super::types::SystemColumnsTask> for ComputationTask {
    fn from(task: super::types::SystemColumnsTask) -> Self {
        ComputationTask::SystemColumns(task)
    }
}
