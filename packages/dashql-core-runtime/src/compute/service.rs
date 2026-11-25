//! The tasks of the computations as services on a compute host.
//!
//! `ComputeService` owns the computation state and runs the tasks of the scheduler on the compute database of the
//! host: a run allocates the data frame of its output, creates its table from the SQL of the plan, reads it back,
//! finishes the plan and applies the action of the result. It reports the progress of the task, drops the data frame
//! of a task that failed, and the service drops the data frames that the state releases. The analysis of a result is
//! a sequence of tasks: the import of the result with row numbers, the statistics, the system columns, then the summary
//! of every ordinal and string column.
//!
//! The tables stay with the host, result data never enters the module: the host imports a result by its handle and
//! keeps the rows that a filter, an ordering, a search or the system columns read under a new handle
//! (`ComputeHost::query_table`). A run reads only the small tables that it parses, the statistics, the bins and the
//! frequent values of a summary and the count of a selection, and hands them over (`ComputeHost::register_table`). The
//! state names a table by its handle.
//!
//! Every run can be cancelled: aborting the lifetime of a computation cancels its runs, `AbortDataSearch` the run of
//! the search, `cancel_task` the run of a task, `cancel_run` a run by its id. A cancelled run drops its future and tells
//! the host to abort its calls, its task ends cancelled. A task whose call the host cancelled
//! (`HostError::is_cancelled`) ends cancelled too.
//!
//! The state sits behind a `RefCell` that no task borrows across an await. A task tells the host after its actions
//! that the state changed.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::rc::Rc;
use std::sync::Arc;

use arrow_schema::SchemaRef;

use crate::handles::Handle;
use dashql_core::error::{Error, Result};

use crate::host::signal::{cancellable, CancelHandle};
use crate::host::{HostError, LogLevel};

use super::cross_filters::CrossFilters;
use super::host::{ComputeContext, ComputeHost, KeptTable, RunId, TableShape};
use super::tasks::analyze_table::{
    column_aggregation_tasks, start_table_analysis, system_columns_task, table_aggregation_task, AnalyzeTableOptions,
};
use super::tasks::column_aggregation::{
    plan_column_aggregation, plan_filtered_column_aggregation, ColumnAggregateResult,
};
use super::tasks::data_search::{
    build_column_search_sql, collect_searchable_result_columns, parse_column_search_matches, plan_data_search,
    DATA_SEARCH_ROW_FIELD,
};
use super::tasks::result_table::ResultTable;
use super::tasks::system_columns::plan_system_columns;
use super::tasks::table_aggregation::plan_table_aggregation;
use super::tasks::table_filtering::plan_table_filtering;
use super::tasks::table_ordering::plan_table_ordering;
use super::tasks::{data_frame_table_name, preview_data_frame_sql, TableStats, TaskQuery};
use super::types::{
    same_ordering, ArrowTable, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ColumnSummary,
    ColumnSummaryAnalysis, ComputationTask, DataFrameId, DataSearchTable, DataSearchTask, FilterTable,
    FilteredColumnAggregate, FilteredColumnAggregationTask, LifetimeId, OrderByConstraint, OrderingTable,
    TableAggregation, TableFilteringTask, TableId, TableOrderingTask, TaskId, TaskProgressUpdate, TaskStatus,
    Timestamp,
};
use super::{ComputationAction, ComputationEffect, ComputationOutcome, ComputationState, SearchKind, TableComputation};
use crate::catalog_loader::sql::quote_identifier;

/// The title of the import of a result
const IMPORT_TITLE: &str = "Table import";
/// The title of the read of the first rows of a result
const PREVIEW_TITLE: &str = "Result preview";

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

/// A run of a task, of an import or of a search of the columns
struct Run {
    /// The computation
    table_id: TableId,
    /// The lifetime of the computation
    lifetime: LifetimeId,
    /// The task
    task: Option<TaskId>,
    /// The request of a data search
    search: Option<u64>,
    /// The request of a search of the columns
    column_search: Option<u64>,
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
    /// The summaries over the selected rows that count their selection before they are scheduled, by table and column
    counting: std::collections::BTreeSet<(TableId, u32)>,
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
        let inner = Inner { state: ComputationState::new(), runs: BTreeMap::new(), counting: Default::default() };
        Self { shared: Rc::new(Shared { host, inner: RefCell::new(inner) }) }
    }

    pub fn host(&self) -> &H {
        &self.shared.host
    }

    /// Read the state
    pub fn read<R>(&self, read: impl FnOnce(&ComputationState) -> R) -> R {
        read(&self.shared.inner.borrow().state)
    }

    /// Read the state, none while a task holds it
    pub fn try_read<R>(&self, read: impl FnOnce(&ComputationState) -> R) -> Option<R> {
        self.shared.inner.try_borrow().ok().map(|inner| read(&inner.state))
    }

    /// Tests of a host: call a function while the state is borrowed, as a task would hold it. None if it is held.
    pub fn hold<R>(&self, f: impl FnOnce() -> R) -> Option<R> {
        let _held = self.shared.inner.try_borrow_mut().ok()?;
        Some(f())
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

    /// Cancel the run of a task, it ends cancelled
    pub fn cancel_task(&self, task_id: TaskId) {
        let runs = self.shared.inner.borrow_mut().take_runs(|run| run.task == Some(task_id));
        cancel_runs(&self.shared, runs);
    }

    /// Cancel a run by its id, e.g. the run of a query of a task that the user stopped: its future is dropped, the host
    /// aborts its calls and its task ends cancelled. False for a run that doesn't run.
    pub fn cancel_run(&self, run: RunId) -> bool {
        let taken = self.shared.inner.borrow_mut().runs.remove(&run);
        let Some(taken) = taken else { return false };
        cancel_runs(&self.shared, vec![(run, taken)]);
        true
    }

    /// Is a task running?
    pub fn is_running(&self, task_id: TaskId) -> bool {
        self.shared.inner.borrow().runs.values().any(|run| run.task == Some(task_id))
    }

    /// Analyze a result: start its computation, import it with row numbers, compute the statistics, the system
    /// columns and the summaries of its columns. The result is a table of the host that the analysis knows by its
    /// rows and its schema, the handles of the table and of the lifetime of the computation go to the state; a result
    /// without columns has nothing to analyze and releases them. The analysis stops without an error once the
    /// computation is gone, e.g. replaced by the computation of a later result.
    pub fn analyze_table(
        &self,
        table_id: TableId,
        table: TableShape,
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

/// A small table that a run read to parse it: the rows for the finish of its plan and the Arrow IPC stream for the host
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
fn apply<H: ComputeHost>(
    shared: &Rc<Shared<H>>,
    action: ComputationAction,
    notify: bool,
) -> Result<ComputationOutcome> {
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
                    cancelled
                        .extend(inner.take_runs(|run| run.table_id == *table_id && run.search == Some(*request_id)));
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

/// Why a run ended without its value
enum RunError {
    /// Its token or a call of the host was cancelled
    Cancelled,
    /// It failed
    Failed(Error),
}

type RunResult<T> = std::result::Result<T, RunError>;

impl From<Error> for RunError {
    fn from(error: Error) -> Self {
        RunError::Failed(error)
    }
}

impl RunError {
    /// The error of a run of a title
    fn into_error(self, title: &str) -> Error {
        match self {
            RunError::Cancelled => cancelled_error(title),
            RunError::Failed(error) => error,
        }
    }
}

/// The error of a call of the host in a run: cancelled if the host cancelled the call, else the error that `failed`
/// makes of it
fn host_failed(error: HostError, failed: impl FnOnce(HostError) -> Error) -> RunError {
    if error.is_cancelled() {
        RunError::Cancelled
    } else {
        RunError::Failed(failed(error))
    }
}

/// What a run runs for: a task, a data search or a search of the columns
#[derive(Clone, Copy, Default)]
struct RunOf {
    task: Option<TaskId>,
    search: Option<u64>,
    column_search: Option<u64>,
}

/// Run a future as a run of a computation that can be cancelled. The future gets the context of the run. A run whose
/// token was cancelled ends cancelled.
async fn in_run<H, F, T>(
    shared: &Rc<Shared<H>>,
    table_id: TableId,
    info: &ComputationInfo,
    title: &'static str,
    of: RunOf,
    future: impl FnOnce(ComputeContext) -> F,
) -> RunResult<T>
where
    H: ComputeHost,
    F: Future<Output = RunResult<T>>,
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
    let RunOf { task, search, column_search } = of;
    shared
        .inner
        .borrow_mut()
        .runs
        .insert(run, Run { table_id, lifetime: info.lifetime, task, search, column_search, cancel });
    let result = future.await;
    shared.inner.borrow_mut().runs.remove(&run);
    result.unwrap_or(Err(RunError::Cancelled))
}

/// Create the table of a query and keep the rows of its read with the host, the state names them by their handle
async fn run_query_kept<H: ComputeHost>(
    shared: &Shared<H>,
    query: &TaskQuery,
    context: &ComputeContext,
) -> RunResult<ArrowTable> {
    let host = &shared.host;
    let failed = |e: HostError| host_failed(e, |e| query.failed(e));
    host.create_table(query.data_frame, &query.table_name, &query.sql, context).await.map_err(failed)?;
    let KeptTable { handle, shape } = host.query_table(&query.read_sql, context).await.map_err(failed)?;
    Ok(ArrowTable::new(handle, shape.rows, shape.schema))
}

/// Create the table of a query and read it back to parse it, for the small tables of the statistics and the summaries
async fn run_query<H: ComputeHost>(
    shared: &Shared<H>,
    query: &TaskQuery,
    context: &ComputeContext,
) -> RunResult<ReadTable> {
    let host = &shared.host;
    let failed = |e: HostError| host_failed(e, |e| query.failed(e));
    host.create_table(query.data_frame, &query.table_name, &query.sql, context).await.map_err(failed)?;
    let ipc = host.query(&query.read_sql, context).await.map_err(failed)?;
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
) -> RunResult<(ComputationAction, TaskOutput)> {
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
            let table = run_query_kept(shared, &plan.query, context).await?;
            let filter = plan.finish();
            let filter = FilterTable {
                input_row_number_column_name: filter.input_row_number_column_name,
                table,
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
            let table = run_query_kept(shared, &plan.query, context).await?;
            let ordering = plan.finish();
            let ordering = OrderingTable {
                input_row_number_column_name: ordering.input_row_number_column_name,
                ordering_constraints: ordering.ordering_constraints,
                table,
                data_frame: ordering.data_frame,
                version: ordering.version,
                data_search_request_id: ordering.data_search_request_id,
            };
            let action =
                ComputationAction::TableOrderingSucceeded { table_id, ordering: ordering.clone(), now: now(shared) };
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
            let table = run_query_kept(shared, &plan.query, context).await?;
            let columns = plan.finish();
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
            let table = run_query_kept(shared, &plan.query, context).await?;
            let matching_rows = table.rows();
            let search = plan.finish();
            let table = DataSearchTable {
                input_row_number_column_name: search.input_row_number_column_name,
                table,
                data_frame: search.data_frame,
                version: search.version,
                request_id: search.request_id,
            };
            let action = ComputationAction::DataSearchSucceeded {
                table_id,
                data_frame: task.input_data_frame,
                request_id: task.request_id,
                search: table.clone(),
                matching_rows,
                now: now(shared),
            };
            Ok((action, TaskOutput::DataSearch(table)))
        }
    }
}

/// The progress of a task that starts, fails or ends cancelled
fn progress(shared: &Shared<impl ComputeHost>, status: TaskStatus, error: Option<String>) -> TaskProgressUpdate {
    let now = now(shared);
    match status {
        TaskStatus::Failed | TaskStatus::Cancelled => TaskProgressUpdate {
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
    let unregister =
        |shared: &Rc<Shared<H>>| apply(shared, ComputationAction::UnregisterSchedulerTask { task_id }, true);
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
    let result =
        in_run(shared, table_id, &info, title, RunOf { task: Some(task_id), search, column_search: None }, |context| {
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
            shared.host.log(
                LogLevel::Info,
                &format!("{title} succeeded"),
                &[("table", &table), ("duration", &duration)],
            );
            apply(shared, action, true)?;
            unregister(shared)?;
            Ok(output)
        }
        Err(error) => {
            drop_data_frame(shared, output);
            let table = table_id.to_string();
            let status = match &error {
                RunError::Cancelled => {
                    shared.host.log(LogLevel::Info, &format!("{title} was cancelled"), &[("table", &table)]);
                    TaskStatus::Cancelled
                }
                RunError::Failed(error) => {
                    shared.host.log(
                        LogLevel::Warn,
                        &format!("{title} failed"),
                        &[("table", &table), ("error", &error.to_string())],
                    );
                    TaskStatus::Failed
                }
            };
            let error = error.into_error(title);
            let message = error.to_string();
            if let ComputationTask::DataSearch(search) = &task {
                let failed = ComputationAction::DataSearchFailed {
                    table_id,
                    data_frame: search.input_data_frame,
                    request_id: search.request_id,
                    error: message.clone(),
                };
                apply(shared, failed, true)?;
            }
            let ended = progress(shared, status, Some(message));
            apply(shared, ComputationAction::UpdateSchedulerTask { task_id, progress: ended, now: now(shared) }, true)?;
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
    table: TableShape,
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
    let Some(start) = start_table_analysis(&table.schema, input) else {
        release();
        return Ok(());
    };
    let data_table = ArrowTable::new(handles.table, table.rows, table.schema.clone());
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

    // Import the result with the row numbers as the first data frame, the host numbers the rows of its table
    let import = start.import;
    let row_number_field = start.row_number_field_name.clone();
    let imported = in_run(shared, table_id, &info, IMPORT_TITLE, RunOf::default(), |context| {
        let shared = shared.clone();
        let name = import.table_name.clone();
        async move {
            let failed = |e: HostError| Error::invalid_argument(format!("importing the result failed: {e}"));
            shared
                .host
                .import_table(input, &name, handles.table, &row_number_field, &context)
                .await
                .map_err(|e| host_failed(e, failed))
        }
    })
    .await
    .map_err(|error| error.into_error(IMPORT_TITLE));
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
    let task = system_columns_task(
        table_id,
        column_groups,
        data_table,
        input,
        start.row_number_field_name,
        aggregation.clone(),
    );
    let Some(TaskOutput::SystemColumns(table, data_frame, column_groups)) =
        schedule_and_run(shared, task.into()).await?
    else {
        return Ok(());
    };
    // The filters, the ordering and the searches that the app asked for before the data frame was there
    refresh(shared, table_id);

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
        let details =
            [("table", table_name.as_str()), ("rows", &rows), ("aggregates", &count), ("duration", &duration)];
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

// The requests of the app. The app says what it wants of a computation: an ordering, a selection in the summary of a
// column, a search, the summary of a column over the selected rows. The service derives the tasks from the state and
// runs them; a request that the state already answers, or that a running task answers, runs nothing. After a task the
// service derives again: a new filter orders the rows again, a search that the app asked for before the data frame
// was there starts once it is.

impl<H: ComputeHost> ComputeService<H> {
    /// Delete the computation of a table, its runs are cancelled
    pub fn delete_computation(&self, table_id: TableId) -> Result<ComputationOutcome> {
        apply(&self.shared, ComputationAction::DeleteComputation { table_id }, false)
    }

    /// Order the rows by the constraints, none clears the ordering
    pub fn order_by(&self, table_id: TableId, constraints: Vec<OrderByConstraint>) -> Result<ComputationOutcome> {
        if constraints.is_empty() {
            return apply(&self.shared, ComputationAction::ClearTableOrdering { table_id }, false);
        }
        let task = {
            let inner = self.shared.inner.borrow();
            inner.state.computation(table_id).and_then(|computation| ordering_task(computation, Some(&constraints)))
        };
        // The caller hands the effects of the outcome to the host
        match task {
            Some(task) => start_task(&self.shared, task, false),
            None => Ok(ComputationOutcome::default()),
        }
    }

    /// Order the rows and wait for the ordering, e.g. of the result of a query that replaces an ordered one. An
    /// ordering of fields that the table doesn't have is skipped.
    pub fn order_by_and_wait(
        &self,
        table_id: TableId,
        constraints: Vec<OrderByConstraint>,
    ) -> impl Future<Output = Result<()>> + 'static {
        let shared = self.shared.clone();
        async move {
            let task = {
                let inner = shared.inner.borrow();
                inner.state.computation(table_id).and_then(|computation| {
                    let known = constraints.iter().all(|c| computation.data_table_fields.contains(&c.field));
                    if constraints.is_empty() || !known {
                        return None;
                    }
                    ordering_task(computation, Some(&constraints))
                })
            };
            if let Some(task) = task {
                schedule_and_run(&shared, task).await?;
            }
            Ok(())
        }
    }

    /// Select a range of bins in the histogram of a column group, none clears the selection of the column
    pub fn histogram_filter(
        &self,
        table_id: TableId,
        column_group: u32,
        brush: Option<(f64, f64)>,
    ) -> Result<ComputationOutcome> {
        let filters = {
            let inner = self.shared.inner.borrow();
            let Some(computation) = inner.state.computation(table_id) else {
                return Ok(ComputationOutcome::default());
            };
            let Some(ColumnGroup::Ordinal(group)) = computation.column_groups.get(column_group as usize) else {
                return Ok(ComputationOutcome::default());
            };
            if computation.cross_filters.contains_histogram_filter(column_group, brush) {
                return Ok(ComputationOutcome::default());
            }
            let mut filters = computation.cross_filters.clone();
            filters.add_histogram_filter(column_group, group, brush);
            filters
        };
        self.set_cross_filters(table_id, filters)
    }

    /// Select a frequent value of a column group, see `CrossFilters::select_most_frequent_value`: without toggle the
    /// value replaces the selection and the value selected alone again clears it, with toggle the value joins the
    /// selection or leaves it, none clears the selection
    pub fn most_frequent_value_filter(
        &self,
        table_id: TableId,
        column_group: u32,
        value_id: Option<i64>,
        toggle: bool,
    ) -> Result<ComputationOutcome> {
        let filters = {
            let inner = self.shared.inner.borrow();
            let Some(computation) = inner.state.computation(table_id) else {
                return Ok(ComputationOutcome::default());
            };
            let Some(ColumnGroup::String(group)) = computation.column_groups.get(column_group as usize) else {
                return Ok(ComputationOutcome::default());
            };
            if group.value_id_field_name.is_none() {
                return Ok(ComputationOutcome::default());
            }
            let current = &computation.cross_filters;
            let mut filters = current.clone();
            filters.select_most_frequent_value(column_group, group, value_id, toggle);
            if filters.selects_same(current) {
                return Ok(ComputationOutcome::default());
            }
            filters
        };
        self.set_cross_filters(table_id, filters)
    }

    /// Clear the selections of all columns
    pub fn clear_cross_filters(&self, table_id: TableId) -> Result<ComputationOutcome> {
        self.set_cross_filters(table_id, CrossFilters::new())
    }

    fn set_cross_filters(&self, table_id: TableId, filters: CrossFilters) -> Result<ComputationOutcome> {
        let outcome = apply(&self.shared, ComputationAction::SetCrossFilters { table_id, filters }, false)?;
        refresh(&self.shared, table_id);
        Ok(outcome)
    }

    /// Search the columns or the data, an empty pattern ends the search
    pub fn set_search_pattern(
        &self,
        table_id: TableId,
        kind: SearchKind,
        pattern: String,
    ) -> Result<ComputationOutcome> {
        if kind == SearchKind::Columns {
            let runs =
                self.shared.inner.borrow_mut().take_runs(|run| run.table_id == table_id && run.column_search.is_some());
            cancel_runs(&self.shared, runs);
        }
        let outcome =
            apply(&self.shared, ComputationAction::SetResultSearchPattern { table_id, kind, pattern }, false)?;
        refresh(&self.shared, table_id);
        Ok(outcome)
    }

    /// Compute the summary of a column over the selected rows if it is outdated, e.g. once the column shows
    pub fn request_filtered_column_aggregation(&self, table_id: TableId, column_id: u32) -> Result<()> {
        let shared = &self.shared;
        let request = {
            let inner = shared.inner.borrow();
            if inner.counting.contains(&(table_id, column_id)) {
                return Ok(());
            }
            match inner.state.computation(table_id) {
                Some(computation) => filtered_aggregation_request(computation, column_id),
                None => None,
            }
        };
        let Some(request) = request else {
            return Ok(());
        };
        let task = request.task;
        let sql = match request.count {
            SelectionCount::Rows(rows) => return start_task(shared, task.with_selection(rows), true).map(|_| ()),
            SelectionCount::Query { sql } => sql,
        };
        let Some(info) = computation_info(shared, table_id) else {
            return Ok(());
        };
        shared.inner.borrow_mut().counting.insert((table_id, column_id));
        let task_shared = shared.clone();
        shared.host.spawn(Box::pin(async move {
            let shared = task_shared;
            let counted =
                in_run(&shared, table_id, &info, "Filtered column aggregation", RunOf::default(), |context| {
                    let shared = shared.clone();
                    async move {
                        let failed =
                            |e: HostError| Error::invalid_argument(format!("counting the selected rows failed: {e}"));
                        let ipc = shared.host.query(&sql, &context).await.map_err(|e| host_failed(e, failed))?;
                        let table = ResultTable::from_ipc_stream(&ipc)?;
                        let count = if table.num_rows() == 0 { None } else { table.integer_value(0, 0)? };
                        Ok(count.and_then(|count| u64::try_from(count).ok()).unwrap_or(0))
                    }
                })
                .await
                .map_err(|error| error.into_error("Filtered column aggregation"));
            shared.inner.borrow_mut().counting.remove(&(table_id, column_id));
            let error = match counted {
                Ok(rows) => start_task(&shared, task.with_selection(rows), true).err(),
                Err(error) => Some(error),
            };
            if let Some(error) = error {
                let error = error.to_string();
                shared.host.log(
                    LogLevel::Warn,
                    "Failed to summarize a column over the selected rows",
                    &[("error", &error)],
                );
            }
        }));
        Ok(())
    }

    /// Derive the tasks of a computation again, e.g. after its analysis
    pub fn refresh(&self, table_id: TableId) {
        refresh(&self.shared, table_id);
    }

    /// The first rows of a result, e.g. for a terminal: at most `limit` rows in the order of the result, its fields
    /// without the columns of the computation, as an Arrow IPC stream. They are read from the data frame of the
    /// computation, so the preview is as small as its limit and the result itself stays with the host. Fails for a
    /// table whose analysis didn't compute the system columns yet, or once its computation is gone.
    pub fn preview(&self, table_id: TableId, limit: u64) -> impl Future<Output = Result<Vec<u8>>> + 'static {
        let shared = self.shared.clone();
        async move {
            let no_computation = || Error::invalid_argument(format!("the table {table_id} has no computation"));
            let sql = {
                let inner = shared.inner.borrow();
                let computation = inner.state.computation(table_id).ok_or_else(no_computation)?;
                let (Some(data_frame), Some(row_numbers)) =
                    (computation.data_frame, computation.row_number_column_name.as_deref())
                else {
                    return Err(Error::invalid_argument(format!(
                        "the result of the table {table_id} is not analyzed yet"
                    )));
                };
                preview_data_frame_sql(data_frame, &computation.data_table_fields, row_numbers, limit)
            };
            let info = computation_info(&shared, table_id).ok_or_else(no_computation)?;
            in_run(&shared, table_id, &info, PREVIEW_TITLE, RunOf::default(), |context| {
                let shared = shared.clone();
                async move {
                    let failed = |e: HostError| Error::invalid_argument(format!("reading the preview failed: {e}"));
                    shared.host.query(&sql, &context).await.map_err(|e| host_failed(e, failed))
                }
            })
            .await
            .map_err(|error| error.into_error(PREVIEW_TITLE))
        }
    }
}

/// How the rows of a selection are counted: known, or by a query that intersects the filter and the data search
enum SelectionCount {
    Rows(u64),
    Query { sql: String },
}

/// A summary over the selected rows to compute, the rows of the selection still to count
struct FilteredAggregationRequest {
    task: FilteredColumnAggregationTask,
    count: SelectionCount,
}

impl FilteredColumnAggregationTask {
    fn with_selection(mut self, rows: u64) -> ComputationTask {
        self.selection_row_count = rows;
        ComputationTask::FilteredColumnAggregation(self)
    }
}

/// The summary of a column over the selected rows that is outdated and that no task computes, none if there is
/// nothing to compute
fn filtered_aggregation_request(computation: &TableComputation, column_id: u32) -> Option<FilteredAggregationRequest> {
    let column = column_id as usize;
    if !computation.filtered_column_aggregate_outdated(column) {
        return None;
    }
    let table_aggregate = computation.table_aggregation.clone()?;
    let input_data_frame = computation.data_frame?;
    let column_entry = computation.column_groups.get(column)?.clone();
    let unfiltered_aggregate = computation.column_aggregate(column)?.clone();
    let filter_table = computation.filter_table.clone();
    let data_search_table = computation.data_search_table.clone();
    let version = filter_table.as_ref().map_or(computation.version, |filter| filter.version);
    let search = data_search_table.as_ref().map(|search| search.request_id);
    // A task that runs or failed for the same selection
    let tracked = computation.tasks.filtered_column_aggregation.get(column).and_then(Option::as_ref);
    if let Some(tracked) = tracked {
        let same = tracked.task.column.table_version.filter_matches(version)
            && tracked.task.data_search_table.as_ref().map(|search| search.request_id) == search;
        if same && tracked.progress.status != TaskStatus::Succeeded {
            return None;
        }
    }
    let count = match (&filter_table, &data_search_table) {
        (Some(filter), None) => SelectionCount::Rows(filter.table.rows()),
        (None, Some(search)) => SelectionCount::Rows(search.table.rows()),
        (Some(filter), Some(search)) => {
            let row_number = quote_identifier(&filter.input_row_number_column_name);
            let sql = format!(
                "SELECT count(*) AS count FROM {} WHERE {row_number} IN (SELECT {} FROM {})",
                quote_identifier(&data_frame_table_name(filter.data_frame)),
                quote_identifier(DATA_SEARCH_ROW_FIELD),
                quote_identifier(&data_frame_table_name(search.data_frame)),
            );
            SelectionCount::Query { sql }
        }
        (None, None) => return None,
    };
    let task = FilteredColumnAggregationTask {
        column: ColumnAggregationTask {
            table_id: computation.table_id,
            table_version: version,
            column_id,
            column_entry,
            input_data_frame,
            table_aggregate,
        },
        filter_table,
        data_search_table,
        selection_row_count: 0,
        unfiltered_aggregate,
    };
    Some(FilteredAggregationRequest { task, count })
}

/// The filtering of the cross filters, none if the filter is current, a filtering runs, failed or was cancelled for the
/// same selection, or there is nothing to filter
fn filtering_task(computation: &TableComputation) -> Option<ComputationTask> {
    let input_data_frame = computation.data_frame?;
    let row_number_column_name = computation.row_number_column_name.clone()?;
    let filters = computation.cross_filters.filter_transforms();
    if let Some(tracked) = &computation.tasks.filtering {
        if tracked.progress.status == TaskStatus::Running {
            return None;
        }
        if tracked.task.filters == filters {
            let current = computation
                .filter_table
                .as_ref()
                .is_none_or(|filter| filter.version.filter_matches(computation.version));
            if matches!(tracked.progress.status, TaskStatus::Failed | TaskStatus::Cancelled) || current {
                return None;
            }
        }
    }
    if filters.is_empty() && computation.filter_table.is_none() {
        return None;
    }
    Some(ComputationTask::TableFiltering(TableFilteringTask {
        table_id: computation.table_id,
        table_version: computation.version,
        input_data_table: computation.data_table.clone(),
        input_data_frame,
        row_number_column_name,
        filters,
    }))
}

/// The ordering of the rows: by the constraints, or by the ones that the computation orders by. None if the ordering
/// is current, an ordering runs, failed or was cancelled for the same rows, a filter or a data search still runs, or
/// there is no ordering.
fn ordering_task(computation: &TableComputation, constraints: Option<&[OrderByConstraint]>) -> Option<ComputationTask> {
    let tracked = computation.tasks.ordering.as_ref();
    let constraints = match constraints {
        Some(constraints) => constraints,
        None => tracked
            .map(|tracked| tracked.task.ordering_constraints.as_slice())
            .filter(|constraints| !constraints.is_empty())
            .unwrap_or(&computation.data_table_ordering),
    };
    if constraints.is_empty() {
        return None;
    }
    let input_data_frame = computation.data_frame?;
    let row_number_column_name = computation.row_number_column_name.clone()?;
    let filtering =
        computation.tasks.filtering.as_ref().is_some_and(|tracked| tracked.progress.status == TaskStatus::Running);
    if filtering || computation.data_search.pending {
        return None;
    }
    let filter = computation.filter_table.as_ref().map(|filter| filter.version);
    let search = computation.data_search_table.as_ref().map(|search| search.request_id);
    if let Some(tracked) = tracked {
        let task = &tracked.task;
        let same = task.table_version.filter_matches(computation.version)
            && task.filter_table.as_ref().map(|filter| filter.version) == filter
            && task.data_search_table.as_ref().map(|search| search.request_id) == search
            && same_ordering(&task.ordering_constraints, constraints);
        let done = match tracked.progress.status {
            TaskStatus::Running | TaskStatus::Failed | TaskStatus::Cancelled => true,
            TaskStatus::Succeeded => computation.ordering_table.is_some(),
        };
        if same && done {
            return None;
        }
    }
    Some(ComputationTask::TableOrdering(TableOrderingTask {
        table_id: computation.table_id,
        table_version: computation.version,
        input_data_table: computation.data_table.clone(),
        input_data_frame,
        filter_table: computation.filter_table.clone(),
        data_search_table: computation.data_search_table.clone(),
        row_number_column_name,
        ordering_constraints: constraints.to_vec(),
    }))
}

/// The search of the data that the app asked for, none if it is applied, runs already or has no data frame
fn data_search_task(computation: &TableComputation) -> Option<ComputationTask> {
    let search = &computation.data_search;
    if search.requested_pattern.is_empty() || search.request_id == search.applied_request_id {
        return None;
    }
    let input_data_frame = computation.data_frame?;
    let row_number_column_name = computation.row_number_column_name.clone()?;
    if computation.tasks.data_search.as_ref().is_some_and(|tracked| tracked.task.request_id == search.request_id) {
        return None;
    }
    Some(ComputationTask::DataSearch(DataSearchTask {
        table_id: computation.table_id,
        table_version: computation.version,
        input_data_frame,
        row_number_column_name,
        columns: collect_searchable_result_columns(&computation.column_groups),
        pattern: search.requested_pattern.clone(),
        request_id: search.request_id,
    }))
}

/// A search of the columns that the app asked for
enum ColumnSearch {
    /// No column matches, there are no columns
    Empty { data_frame: DataFrameId, request_id: u64 },
    /// Run the query of the search
    Query { data_frame: DataFrameId, request_id: u64, sql: String },
}

fn column_search(computation: &TableComputation, runs: &BTreeMap<RunId, Run>) -> Option<ColumnSearch> {
    let search = &computation.column_search;
    if search.requested_pattern.is_empty() || search.request_id == search.applied_request_id {
        return None;
    }
    let data_frame = computation.data_frame?;
    let request_id = search.request_id;
    if runs.values().any(|run| run.table_id == computation.table_id && run.column_search == Some(request_id)) {
        return None;
    }
    let columns = collect_searchable_result_columns(&computation.column_groups);
    Some(match build_column_search_sql(&columns, &search.requested_pattern) {
        Some(sql) => ColumnSearch::Query { data_frame, request_id, sql },
        None => ColumnSearch::Empty { data_frame, request_id },
    })
}

/// Schedule a task and run it in a task of the host, then derive the tasks of its computation again. The schedule
/// tells the host with `notify`, else the caller hands the effects of the outcome to the host: one of them does.
fn start_task<H: ComputeHost>(
    shared: &Rc<Shared<H>>,
    task: ComputationTask,
    notify: bool,
) -> Result<ComputationOutcome> {
    let table_id = task.table_id();
    let outcome = apply(shared, ComputationAction::ScheduleTask { task, now: now(shared) }, notify)?;
    if let Some(task_id) = outcome.task_id {
        let task_shared = shared.clone();
        shared.host.spawn(Box::pin(async move {
            // A failed run reported its error as the progress of its task
            let _ = run_task(&task_shared, task_id).await;
            refresh(&task_shared, table_id);
        }));
    }
    Ok(outcome)
}

/// Derive the tasks of a computation from its state and start them: the filtering, the searches and the ordering
fn refresh<H: ComputeHost>(shared: &Rc<Shared<H>>, table_id: TableId) {
    let (filtering, data_search, column_search) = {
        let inner = shared.inner.borrow();
        let Some(computation) = inner.state.computation(table_id) else {
            return;
        };
        (filtering_task(computation), data_search_task(computation), column_search(computation, &inner.runs))
    };
    let failed = |error: Error| {
        let error = error.to_string();
        shared.host.log(LogLevel::Warn, "Failed to schedule a task", &[("error", &error)]);
    };
    for task in [filtering, data_search].into_iter().flatten() {
        if let Err(error) = start_task(shared, task, true) {
            failed(error);
        }
    }
    match column_search {
        Some(ColumnSearch::Empty { data_frame, request_id }) => {
            let action = ComputationAction::ColumnSearchSucceeded {
                table_id,
                data_frame,
                request_id,
                matching_column_groups: Vec::new(),
            };
            if let Err(error) = apply(shared, action, true) {
                failed(error);
            }
        }
        Some(ColumnSearch::Query { data_frame, request_id, sql }) => {
            start_column_search(shared, table_id, data_frame, request_id, sql)
        }
        None => {}
    }
    // The ordering waits for the filtering and the data search that just started
    let ordering = {
        let inner = shared.inner.borrow();
        inner.state.computation(table_id).and_then(|computation| ordering_task(computation, None))
    };
    if let Some(task) = ordering {
        if let Err(error) = start_task(shared, task, true) {
            failed(error);
        }
    }
}

/// Search the names of the columns in a task of the host
fn start_column_search<H: ComputeHost>(
    shared: &Rc<Shared<H>>,
    table_id: TableId,
    data_frame: DataFrameId,
    request_id: u64,
    sql: String,
) {
    let Some(info) = computation_info(shared, table_id) else {
        return;
    };
    let task_shared = shared.clone();
    shared.host.spawn(Box::pin(async move {
        let shared = task_shared;
        let of = RunOf { task: None, search: None, column_search: Some(request_id) };
        let searched = in_run(&shared, table_id, &info, "Column search", of, |context| {
            let shared = shared.clone();
            async move {
                let failed = |e: HostError| Error::invalid_argument(format!("the column search failed: {e}"));
                let ipc = shared.host.query(&sql, &context).await.map_err(|e| host_failed(e, failed))?;
                Ok(parse_column_search_matches(&ResultTable::from_ipc_stream(&ipc)?)?)
            }
        })
        .await
        .map_err(|error| error.into_error("Column search"));
        let action = match searched {
            Ok(matching_column_groups) => {
                ComputationAction::ColumnSearchSucceeded { table_id, data_frame, request_id, matching_column_groups }
            }
            Err(error) => {
                let message = error.to_string();
                let table = table_id.to_string();
                shared.host.log(LogLevel::Warn, "Column search failed", &[("table", &table), ("error", &message)]);
                ComputationAction::ResultSearchFailed {
                    table_id,
                    data_frame,
                    kind: SearchKind::Columns,
                    request_id,
                    error: message,
                }
            }
        };
        // A superseded search changes nothing
        if let Err(error) = apply(&shared, action, true) {
            let error = error.to_string();
            shared.host.log(LogLevel::Warn, "Failed to apply a column search", &[("error", &error)]);
        }
    }));
}
