//! The computations of result tables and the actions on them.
//!
//! A computation summarizes a result table: the statistics of the table, a summary per column, the system columns
//! that the filters use, the cross filters with the summaries over the selected rows, an ordering and the searches of
//! the columns and the data. The tasks of the scheduler compute them, the state tracks the tasks and accepts the
//! results that are still current: a result of an older filter, ordering or search is dropped.
//!
//! The Arrow tables, the summaries and the data frames stay with the host, the state knows them by their ids. The state
//! owns what it holds: an action that drops the last hold on a data frame or an Arrow table returns an effect to
//! release it, a result that an action hands over and the state doesn't keep is released right away. An action
//! changes the state in place and returns the effects that the host applies afterwards.
//!
//! Ported from `reduceComputationState` of `packages/dashql-runtime/src/compute/computation_state.ts`.

pub mod cross_filters;
pub mod tasks;
pub mod types;

use std::collections::{BTreeMap, BTreeSet};

use dashql_core::error::{Error, Result};

use cross_filters::CrossFilters;
use types::{
    same_ordering, ArrowTable, ArrowTableId, ColumnAggregate, ColumnAggregationTask, ColumnGroup, ComputationTask,
    ComputationVersion, DataFrameId, DataSearchTable, DataSearchTask, FilterTable, FilteredColumnAggregate,
    FilteredColumnAggregationTask, LifetimeId, OrderByConstraint, OrderingTable, ResultSearchState, SystemColumnsTask,
    TableAggregation, TableAggregationTask, TableFilteringTask, TableId, TableOrderingTask, TaskId, TaskProgress,
    TaskProgressUpdate, Timestamp, TrackedTask,
};

/// The search of a result: of its columns or of its data
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchKind {
    /// The names of the columns
    Columns,
    /// The values of the rows
    Data,
}

/// The latest task of each kind of a computation
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ComputationTasks {
    /// The statistics of the table
    pub table_aggregation: Option<TrackedTask<TableAggregationTask>>,
    /// The system columns
    pub system_columns: Option<TrackedTask<SystemColumnsTask>>,
    /// The filtering
    pub filtering: Option<TrackedTask<TableFilteringTask>>,
    /// The ordering
    pub ordering: Option<TrackedTask<TableOrderingTask>>,
    /// The data search
    pub data_search: Option<TrackedTask<DataSearchTask>>,
    /// The summaries of the columns, by column group
    pub column_aggregation: Vec<Option<TrackedTask<ColumnAggregationTask>>>,
    /// The summaries of the columns over the selected rows, by column group
    pub filtered_column_aggregation: Vec<Option<TrackedTask<FilteredColumnAggregationTask>>>,
}

/// The computation of a result table
#[derive(Clone, Debug, PartialEq)]
pub struct TableComputation {
    /// The result table
    pub table_id: TableId,
    /// The connection that ran the query of the table, its query history lists the queries of the computation. None
    /// for a host without connections.
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    pub client_context: Option<String>,
    /// The lifetime of the computation at the host
    pub lifetime: LifetimeId,
    /// The latest tasks
    pub tasks: ComputationTasks,
    /// The version of the data and the filter
    pub version: ComputationVersion,
    /// The table
    pub data_table: ArrowTable,
    /// The fields of the table that the computation was created with, in order
    pub data_table_fields: Vec<String>,
    /// The data frame of the table, with the system columns once they are computed
    pub data_frame: Option<DataFrameId>,
    /// The column groups of the grid
    pub column_groups: Vec<ColumnGroup>,
    /// The ordering of the grid
    pub data_table_ordering: Vec<OrderByConstraint>,
    /// The cross filters that every view of the table shares
    pub cross_filters: CrossFilters,
    /// The rows that pass the cross filters, if a filter is active
    pub filter_table: Option<FilterTable>,
    /// The ordered rows, if an ordering is active
    pub ordering_table: Option<OrderingTable>,
    /// The search of the columns that every view of the table shares
    pub column_search: ResultSearchState,
    /// The search of the data that every view of the table shares
    pub data_search: ResultSearchState,
    /// The rows that the applied data search matched
    pub data_search_table: Option<DataSearchTable>,
    /// The column group of the row numbers
    pub row_number_column_group: Option<usize>,
    /// The field of the row numbers
    pub row_number_column_name: Option<String>,
    /// The statistics of the table
    pub table_aggregation: Option<TableAggregation>,
    /// The summaries of the columns, by column group
    pub column_aggregates: Vec<Option<ColumnAggregate>>,
    /// The summaries of the columns over the selected rows, by column group. A summary stays until a new one is
    /// computed, its filter version tells whether it is current.
    pub filtered_column_aggregates: Vec<Option<FilteredColumnAggregate>>,
    /// Which summaries over the selected rows are outdated for the current selection, by column group
    pub filtered_column_aggregates_outdated: Vec<bool>,
    /// The revision of the computation, it changes with every change
    revision: u64,
}

impl TableComputation {
    /// A computation of a table that has no data frame yet
    fn new(
        table_id: TableId,
        data_table: ArrowTable,
        data_table_fields: Vec<String>,
        column_groups: Vec<ColumnGroup>,
        lifetime: LifetimeId,
        connection_id: Option<String>,
        client_context: Option<String>,
    ) -> Self {
        let columns = column_groups.len();
        Self {
            table_id,
            connection_id,
            client_context,
            lifetime,
            tasks: ComputationTasks {
                column_aggregation: vec![None; columns],
                filtered_column_aggregation: vec![None; columns],
                ..Default::default()
            },
            version: ComputationVersion::default(),
            data_table,
            data_table_fields,
            data_frame: None,
            column_groups,
            data_table_ordering: Vec::new(),
            cross_filters: CrossFilters::new(),
            filter_table: None,
            ordering_table: None,
            column_search: ResultSearchState::default(),
            data_search: ResultSearchState::default(),
            data_search_table: None,
            row_number_column_group: None,
            row_number_column_name: None,
            table_aggregation: None,
            column_aggregates: vec![None; columns],
            filtered_column_aggregates: vec![None; columns],
            filtered_column_aggregates_outdated: vec![false; columns],
            revision: 0,
        }
    }

    /// The revision of the computation, it changes with every change
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The index of a field of the table, the last field of a name
    pub fn field_index(&self, name: &str) -> Option<usize> {
        self.data_table_fields.iter().rposition(|field| field == name)
    }

    /// The summary of a column group
    pub fn column_aggregate(&self, column: usize) -> Option<&ColumnAggregate> {
        self.column_aggregates.get(column).and_then(Option::as_ref)
    }

    /// The summary of a column group over the selected rows
    pub fn filtered_column_aggregate(&self, column: usize) -> Option<&FilteredColumnAggregate> {
        self.filtered_column_aggregates.get(column).and_then(Option::as_ref)
    }

    /// Is the summary of a column group over the selected rows outdated?
    pub fn filtered_column_aggregate_outdated(&self, column: usize) -> bool {
        self.filtered_column_aggregates_outdated.get(column).copied().unwrap_or(false)
    }

    /// The version of the selection: the one of the filter, else the one of the computation
    fn selection_version(&self) -> ComputationVersion {
        self.filter_table.as_ref().map_or(self.version, |filter| filter.version)
    }

    /// The applied data search
    fn data_search_request(&self) -> Option<u64> {
        self.data_search_table.as_ref().map(|search| search.request_id)
    }

    /// Which summaries over the selected rows are outdated for a filter and a data search. Without either nothing
    /// is outdated. A column with a summary over all rows is outdated unless its summary over the selected rows was
    /// computed for the version of the filter (or of the computation) and the data search.
    fn outdated_filtered_aggregates(&self, filter: Option<ComputationVersion>, search: Option<u64>) -> Vec<bool> {
        let mut outdated = self.filtered_column_aggregates_outdated.clone();
        if filter.is_none() && search.is_none() {
            outdated.fill(false);
            return outdated;
        }
        if outdated.len() < self.column_groups.len() {
            outdated.resize(self.column_groups.len(), false);
        }
        let target = filter.unwrap_or(self.version);
        for ((column, group), slot) in self.column_groups.iter().enumerate().zip(outdated.iter_mut()) {
            *slot = group.has_filtered_summary()
                && self.column_aggregate(column).is_some()
                && !self
                    .filtered_column_aggregate(column)
                    .is_some_and(|aggregate| aggregate.filter_version.filter_matches(target) && aggregate.data_search_request_id == search);
        }
        outdated
    }

    /// Drop the summaries over the selected rows, the slots stay
    fn clear_filtered_aggregates(&mut self) {
        self.filtered_column_aggregates.fill(None);
    }

    /// Register a task with the computation, the latest of its kind. A new filtering moves the filter version. An
    /// update of an ordering or a data search that was superseded changes nothing. Returns whether the tasks changed.
    fn register_task(
        &mut self,
        task_id: TaskId,
        task: &mut ComputationTask,
        progress: Progress<'_>,
        effects: &mut Vec<ComputationEffect>,
    ) -> bool {
        let create = matches!(progress, Progress::Start(_));
        match task {
            ComputationTask::TableFiltering(task) => {
                // A new filtering gets a version of its own, a result for an older one is stale
                if create {
                    self.version = self.version.with_filter_increment();
                    task.table_version = self.version;
                }
                let progress = progress.apply(self.tasks.filtering.as_ref().map(|tracked| &tracked.progress));
                let task = TableFilteringTask { table_version: self.version, ..task.clone() };
                self.tasks.filtering = Some(TrackedTask { task_id, task, progress });
            }
            ComputationTask::TableOrdering(task) => {
                if !create
                    && self.tasks.ordering.as_ref().is_some_and(|tracked| {
                        !same_ordering(&tracked.task.ordering_constraints, &task.ordering_constraints)
                    })
                {
                    return false;
                }
                let progress = progress.apply(self.tasks.ordering.as_ref().map(|tracked| &tracked.progress));
                let task = TableOrderingTask { table_version: self.version, ..task.clone() };
                self.tasks.ordering = Some(TrackedTask { task_id, task, progress });
            }
            ComputationTask::DataSearch(task) => {
                if create {
                    if let Some(previous) = &self.tasks.data_search {
                        effects.push(ComputationEffect::AbortDataSearch {
                            table_id: self.table_id,
                            request_id: previous.task.request_id,
                        });
                    }
                } else if self.tasks.data_search.as_ref().map(|tracked| tracked.task.request_id) != Some(task.request_id) {
                    return false;
                }
                let progress = progress.apply(self.tasks.data_search.as_ref().map(|tracked| &tracked.progress));
                self.tasks.data_search = Some(TrackedTask { task_id, task: task.clone(), progress });
            }
            ComputationTask::TableAggregation(task) => {
                let progress = progress.apply(self.tasks.table_aggregation.as_ref().map(|tracked| &tracked.progress));
                self.tasks.table_aggregation = Some(TrackedTask { task_id, task: task.clone(), progress });
            }
            ComputationTask::SystemColumns(task) => {
                let progress = progress.apply(self.tasks.system_columns.as_ref().map(|tracked| &tracked.progress));
                self.tasks.system_columns = Some(TrackedTask { task_id, task: task.clone(), progress });
            }
            ComputationTask::ColumnAggregation(task) => {
                let column = task.column_id as usize;
                let slots = &mut self.tasks.column_aggregation;
                let previous = slots.get(column).and_then(Option::as_ref).map(|tracked| &tracked.progress);
                let progress = progress.apply(previous);
                set_slot(slots, column, Some(TrackedTask { task_id, task: task.clone(), progress }));
            }
            ComputationTask::FilteredColumnAggregation(task) => {
                let column = task.column.column_id as usize;
                let slots = &mut self.tasks.filtered_column_aggregation;
                let previous = slots.get(column).and_then(Option::as_ref).map(|tracked| &tracked.progress);
                let progress = progress.apply(previous);
                set_slot(slots, column, Some(TrackedTask { task_id, task: task.clone(), progress }));
            }
        }
        true
    }
}

/// The progress that a task registers with
#[derive(Clone, Copy)]
enum Progress<'a> {
    /// A scheduled task starts running
    Start(Timestamp),
    /// An update of the progress of a running task, the task starts running now if the computation doesn't track it
    Update(&'a TaskProgressUpdate, Timestamp),
}

impl Progress<'_> {
    /// The progress after the one of the previous task of the kind
    fn apply(self, previous: Option<&TaskProgress>) -> TaskProgress {
        match self {
            Progress::Start(now) => TaskProgress::running(now),
            Progress::Update(update, now) => {
                let mut progress = previous.cloned().unwrap_or_else(|| TaskProgress::running(now));
                progress.update(update);
                progress
            }
        }
    }
}

/// Set a slot of a column group, the slots grow to hold it. Returns the previous value.
fn set_slot<T>(slots: &mut Vec<Option<T>>, index: usize, value: Option<T>) -> Option<T> {
    if slots.len() <= index {
        slots.resize_with(index.saturating_add(1), || None);
    }
    match slots.get_mut(index) {
        Some(slot) => std::mem::replace(slot, value),
        None => None,
    }
}

/// An action on the computations. Every action carries the time it happened at where it records one, the state reads
/// no clock.
#[derive(Clone, Debug, PartialEq)]
pub enum ComputationAction {
    /// Schedule a task, it gets the next task id and becomes the latest task of its kind of its computation. A task
    /// of an unknown computation is dropped. A filtering gets the next filter version.
    ScheduleTask { task: ComputationTask, now: Timestamp },
    /// The scheduler reports progress of a task
    UpdateSchedulerTask { task_id: TaskId, progress: TaskProgressUpdate, now: Timestamp },
    /// The scheduler is done with a task, the computation keeps it as the latest of its kind
    UnregisterSchedulerTask { task_id: TaskId },
    /// Start the computation of a result table, it replaces an earlier computation of the table. The fields are the
    /// fields of the table in order.
    ComputationFromQueryResult {
        table_id: TableId,
        data_table: ArrowTable,
        fields: Vec<String>,
        column_groups: Vec<ColumnGroup>,
        lifetime: LifetimeId,
        connection_id: Option<String>,
        client_context: Option<String>,
    },
    /// Drop the computation of a table
    DeleteComputation { table_id: TableId },
    /// The table was copied into a data frame, it moves the data version
    CreatedDataFrame { table_id: TableId, data_frame: DataFrameId },
    /// An ordering was computed. It is dropped unless it is for the version, the data search and the ordering that
    /// the computation has now.
    TableOrderingSucceeded { table_id: TableId, ordering: OrderingTable, now: Timestamp },
    /// Drop the ordering, an ordering that is still computed is dropped when it arrives
    ClearTableOrdering { table_id: TableId },
    /// A filter was computed for a version, none if no filter is active. It is dropped unless the version is the
    /// current one.
    TableFilteringSucceeded { table_id: TableId, version: ComputationVersion, filter: Option<FilterTable>, now: Timestamp },
    /// The statistics of the table were computed
    TableAggregationSucceeded { table_id: TableId, aggregation: TableAggregation, now: Timestamp },
    /// The system columns were computed: the table and the data frame with them and the column groups that use them.
    /// It moves the data version.
    SystemColumnsSucceeded {
        table_id: TableId,
        data_table: ArrowTable,
        data_frame: DataFrameId,
        column_groups: Vec<ColumnGroup>,
        now: Timestamp,
    },
    /// The summary of a column was computed. It is dropped if the computation has no task for the column.
    ColumnAggregationSucceeded { table_id: TableId, column_id: u32, aggregate: ColumnAggregate, now: Timestamp },
    /// The summary of a column over the selected rows was computed for a version, none if there is no selection. It
    /// is dropped unless it is for the task, the selection and the data search that the computation has now.
    FilteredColumnAggregationSucceeded {
        table_id: TableId,
        column_id: u32,
        version: ComputationVersion,
        aggregate: Option<FilteredColumnAggregate>,
        now: Timestamp,
    },
    /// Set the cross filters, the same selections change nothing
    SetCrossFilters { table_id: TableId, filters: CrossFilters },
    /// Request a search of the columns or the data, an empty pattern ends the search. A new data search aborts the
    /// running one, ending it drops its rows.
    SetResultSearchPattern { table_id: TableId, kind: SearchKind, pattern: String },
    /// A search of the columns of a data frame matched column groups. It is dropped unless the data frame and the
    /// request are current.
    ColumnSearchSucceeded { table_id: TableId, data_frame: DataFrameId, request_id: u64, matching_column_groups: Vec<u32> },
    /// A search of the data of a data frame matched rows: the table of the matches and the matching columns by row
    /// number from 1, as the host reads them from the table. It is dropped unless the data frame, the request and the
    /// data version are current.
    DataSearchSucceeded {
        table_id: TableId,
        data_frame: DataFrameId,
        request_id: u64,
        search: DataSearchTable,
        matching_rows: BTreeMap<u64, Vec<u32>>,
        now: Timestamp,
    },
    /// A search of the data of a data frame failed, it drops the rows of the data search. It is dropped unless the
    /// data frame and the request are current.
    DataSearchFailed { table_id: TableId, data_frame: DataFrameId, request_id: u64, error: String },
    /// A search of a data frame failed. It is dropped unless the data frame and the request are current.
    ResultSearchFailed { table_id: TableId, data_frame: DataFrameId, kind: SearchKind, request_id: u64, error: String },
}

impl ComputationAction {
    /// Note what the action hands over to the state: results that the state keeps or releases. The data frames that
    /// identify the source of a search are not handed over, a scheduled task is held by the scheduler.
    fn collect_handed_over(&self, held: &mut Held) {
        match self {
            ComputationAction::ComputationFromQueryResult { data_table, .. } => held.table(data_table.id),
            ComputationAction::CreatedDataFrame { data_frame, .. } => held.frame(*data_frame),
            ComputationAction::TableOrderingSucceeded { ordering, .. } => held.ordering(ordering),
            ComputationAction::TableFilteringSucceeded { filter, .. } => held.filter(filter.as_ref()),
            ComputationAction::TableAggregationSucceeded { aggregation, .. } => held.table_aggregation(Some(aggregation)),
            ComputationAction::SystemColumnsSucceeded { data_table, data_frame, .. } => {
                held.table(data_table.id);
                held.frame(*data_frame);
            }
            ComputationAction::ColumnAggregationSucceeded { aggregate, .. } => held.aggregate(Some(aggregate)),
            ComputationAction::FilteredColumnAggregationSucceeded { aggregate, .. } => {
                held.aggregate(aggregate.as_ref().map(|aggregate| &aggregate.aggregate))
            }
            ComputationAction::DataSearchSucceeded { search, .. } => held.search(Some(search)),
            ComputationAction::ScheduleTask { .. }
            | ComputationAction::UpdateSchedulerTask { .. }
            | ComputationAction::UnregisterSchedulerTask { .. }
            | ComputationAction::DeleteComputation { .. }
            | ComputationAction::ClearTableOrdering { .. }
            | ComputationAction::SetCrossFilters { .. }
            | ComputationAction::SetResultSearchPattern { .. }
            | ComputationAction::ColumnSearchSucceeded { .. }
            | ComputationAction::DataSearchFailed { .. }
            | ComputationAction::ResultSearchFailed { .. } => {}
        }
    }
}

/// What the host must do after an action, in order
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ComputationEffect {
    /// Abort the lifetime of a computation that was dropped or replaced, it cancels the work on it
    AbortComputation { table_id: TableId, lifetime: LifetimeId },
    /// Abort a data search that was superseded
    AbortDataSearch { table_id: TableId, request_id: u64 },
    /// Nothing in the state holds the data frame anymore, the host drops its table
    ReleaseDataFrame { data_frame: DataFrameId },
    /// Nothing in the state holds the Arrow table anymore, the host lets go of it
    ReleaseArrowTable { table: ArrowTableId },
}

/// The outcome of an action
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ComputationOutcome {
    /// Did the action change the state? A result that is dropped changes nothing.
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<ComputationEffect>,
    /// The id of a scheduled task
    pub task_id: Option<TaskId>,
}

/// What an action changed
#[derive(Clone, Copy, Debug)]
struct Changed {
    /// The computation of the table of the action
    table: bool,
    /// The tasks of the scheduler
    scheduler: bool,
}

impl Changed {
    /// Nothing changed
    const NONE: Changed = Changed { table: false, scheduler: false };
    /// The computation changed
    const TABLE: Changed = Changed { table: true, scheduler: false };
}

/// The data frames and Arrow tables that a part of the state holds, once per hold
#[derive(Debug, Default)]
struct Held {
    /// The data frames
    data_frames: Vec<DataFrameId>,
    /// The Arrow tables
    tables: Vec<ArrowTableId>,
}

impl Held {
    fn frame(&mut self, data_frame: DataFrameId) {
        self.data_frames.push(data_frame);
    }
    fn table(&mut self, table: ArrowTableId) {
        self.tables.push(table);
    }
    fn filter(&mut self, filter: Option<&FilterTable>) {
        if let Some(filter) = filter {
            self.table(filter.table.id);
            self.frame(filter.data_frame);
        }
    }
    fn ordering(&mut self, ordering: &OrderingTable) {
        self.table(ordering.table.id);
        self.frame(ordering.data_frame);
    }
    fn search(&mut self, search: Option<&DataSearchTable>) {
        if let Some(search) = search {
            self.table(search.table.id);
            self.frame(search.data_frame);
        }
    }
    fn table_aggregation(&mut self, aggregation: Option<&TableAggregation>) {
        if let Some(aggregation) = aggregation {
            self.table(aggregation.table);
            self.frame(aggregation.data_frame);
        }
    }
    fn aggregate(&mut self, aggregate: Option<&ColumnAggregate>) {
        if let Some(summary) = aggregate.and_then(ColumnAggregate::summary) {
            self.table(summary.id);
            self.frame(summary.data_frame);
        }
    }
    fn column_task(&mut self, task: &ColumnAggregationTask) {
        self.frame(task.input_data_frame);
        self.table_aggregation(Some(&task.table_aggregate));
    }
    fn task(&mut self, task: &ComputationTask) {
        match task {
            ComputationTask::TableFiltering(task) => {
                self.table(task.input_data_table.id);
                self.frame(task.input_data_frame);
            }
            ComputationTask::TableOrdering(task) => self.ordering_task(task),
            ComputationTask::TableAggregation(task) => self.frame(task.input_data_frame),
            ComputationTask::SystemColumns(task) => self.system_columns_task(task),
            ComputationTask::ColumnAggregation(task) => self.column_task(task),
            ComputationTask::FilteredColumnAggregation(task) => self.filtered_task(task),
            ComputationTask::DataSearch(task) => self.frame(task.input_data_frame),
        }
    }
    fn ordering_task(&mut self, task: &TableOrderingTask) {
        self.table(task.input_data_table.id);
        self.frame(task.input_data_frame);
        self.filter(task.filter_table.as_ref());
        self.search(task.data_search_table.as_ref());
    }
    fn system_columns_task(&mut self, task: &SystemColumnsTask) {
        self.table(task.input_table.id);
        self.frame(task.input_data_frame);
        self.table_aggregation(Some(&task.table_aggregate));
    }
    fn filtered_task(&mut self, task: &FilteredColumnAggregationTask) {
        self.column_task(&task.column);
        self.filter(task.filter_table.as_ref());
        self.search(task.data_search_table.as_ref());
        self.aggregate(Some(&task.unfiltered_aggregate));
    }
    fn computation(&mut self, computation: &TableComputation) {
        self.table(computation.data_table.id);
        if let Some(data_frame) = computation.data_frame {
            self.frame(data_frame);
        }
        self.filter(computation.filter_table.as_ref());
        if let Some(ordering) = &computation.ordering_table {
            self.ordering(ordering);
        }
        self.search(computation.data_search_table.as_ref());
        self.table_aggregation(computation.table_aggregation.as_ref());
        for aggregate in computation.column_aggregates.iter().flatten() {
            self.aggregate(Some(aggregate));
        }
        for aggregate in computation.filtered_column_aggregates.iter().flatten() {
            self.aggregate(Some(&aggregate.aggregate));
        }
        let tasks = &computation.tasks;
        if let Some(tracked) = &tasks.filtering {
            self.table(tracked.task.input_data_table.id);
            self.frame(tracked.task.input_data_frame);
        }
        if let Some(tracked) = &tasks.ordering {
            self.ordering_task(&tracked.task);
        }
        if let Some(tracked) = &tasks.data_search {
            self.frame(tracked.task.input_data_frame);
        }
        if let Some(tracked) = &tasks.table_aggregation {
            self.frame(tracked.task.input_data_frame);
        }
        if let Some(tracked) = &tasks.system_columns {
            self.system_columns_task(&tracked.task);
        }
        for tracked in tasks.column_aggregation.iter().flatten() {
            self.column_task(&tracked.task);
        }
        for tracked in tasks.filtered_column_aggregation.iter().flatten() {
            self.filtered_task(&tracked.task);
        }
    }
}

/// The computations of the result tables and the tasks of the scheduler
#[derive(Clone, Debug)]
pub struct ComputationState {
    /// The computations by table
    computations: BTreeMap<TableId, TableComputation>,
    /// The tasks of the scheduler by task id
    scheduler_tasks: BTreeMap<TaskId, ComputationTask>,
    /// The id of the next scheduled task
    next_task_id: TaskId,
    /// The revision of the state, it changes with every change
    revision: u64,
}

impl Default for ComputationState {
    fn default() -> Self {
        Self { computations: BTreeMap::new(), scheduler_tasks: BTreeMap::new(), next_task_id: 1, revision: 0 }
    }
}

impl ComputationState {
    /// A state without computations
    pub fn new() -> Self {
        Self::default()
    }

    /// The computation of a table
    pub fn computation(&self, table_id: TableId) -> Option<&TableComputation> {
        self.computations.get(&table_id)
    }

    /// The computations by table
    pub fn computations(&self) -> impl Iterator<Item = (TableId, &TableComputation)> {
        self.computations.iter().map(|(id, computation)| (*id, computation))
    }

    /// A task of the scheduler
    pub fn scheduler_task(&self, task_id: TaskId) -> Option<&ComputationTask> {
        self.scheduler_tasks.get(&task_id)
    }

    /// The tasks of the scheduler by task id
    pub fn scheduler_tasks(&self) -> impl Iterator<Item = (TaskId, &ComputationTask)> {
        self.scheduler_tasks.iter().map(|(id, task)| (*id, task))
    }

    /// The id of the next scheduled task
    pub fn next_task_id(&self) -> TaskId {
        self.next_task_id
    }

    /// The revision of the state, it changes with every change
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The data frames that the state holds
    pub fn data_frames(&self) -> BTreeSet<DataFrameId> {
        self.held_by_all().data_frames.into_iter().collect()
    }

    /// The Arrow tables that the state holds
    pub fn arrow_tables(&self) -> BTreeSet<ArrowTableId> {
        self.held_by_all().tables.into_iter().collect()
    }

    /// How many places of the state hold a data frame: the computation, its latest tasks and the scheduler tasks
    pub fn data_frame_holds(&self, data_frame: DataFrameId) -> usize {
        self.held_by_all().data_frames.iter().filter(|id| **id == data_frame).count()
    }

    /// Does the state hold a data frame?
    pub fn holds_data_frame(&self, data_frame: DataFrameId) -> bool {
        self.held_by_all().data_frames.contains(&data_frame)
    }

    /// Does the state hold an Arrow table?
    pub fn holds_arrow_table(&self, table: ArrowTableId) -> bool {
        self.held_by_all().tables.contains(&table)
    }

    /// The tasks that the state knows: the tasks of the scheduler and the tasks that the computations track. The host
    /// keeps its objects of a task as long as the state knows the task.
    pub fn task_ids(&self) -> BTreeSet<TaskId> {
        let mut ids: BTreeSet<TaskId> = self.scheduler_tasks.keys().copied().collect();
        for computation in self.computations.values() {
            let tasks = &computation.tasks;
            ids.extend(tasks.table_aggregation.as_ref().map(|tracked| tracked.task_id));
            ids.extend(tasks.system_columns.as_ref().map(|tracked| tracked.task_id));
            ids.extend(tasks.filtering.as_ref().map(|tracked| tracked.task_id));
            ids.extend(tasks.ordering.as_ref().map(|tracked| tracked.task_id));
            ids.extend(tasks.data_search.as_ref().map(|tracked| tracked.task_id));
            ids.extend(tasks.column_aggregation.iter().flatten().map(|tracked| tracked.task_id));
            ids.extend(tasks.filtered_column_aggregation.iter().flatten().map(|tracked| tracked.task_id));
        }
        ids
    }

    /// Everything that the state holds
    fn held_by_all(&self) -> Held {
        let mut held = Held::default();
        for computation in self.computations.values() {
            held.computation(computation);
        }
        for task in self.scheduler_tasks.values() {
            held.task(task);
        }
        held
    }

    /// What the computation of a table and the scheduler tasks of the table hold
    fn held_by_table(&self, table_id: TableId) -> Held {
        let mut held = Held::default();
        if let Some(computation) = self.computations.get(&table_id) {
            held.computation(computation);
        }
        for task in self.scheduler_tasks.values().filter(|task| task.table_id() == table_id) {
            held.task(task);
        }
        held
    }

    /// The table that an action is about, none for an unknown task
    fn action_table(&self, action: &ComputationAction) -> Option<TableId> {
        match action {
            ComputationAction::ScheduleTask { task, .. } => Some(task.table_id()),
            ComputationAction::UpdateSchedulerTask { task_id, .. }
            | ComputationAction::UnregisterSchedulerTask { task_id } => {
                self.scheduler_tasks.get(task_id).map(ComputationTask::table_id)
            }
            ComputationAction::ComputationFromQueryResult { table_id, .. }
            | ComputationAction::DeleteComputation { table_id }
            | ComputationAction::CreatedDataFrame { table_id, .. }
            | ComputationAction::TableOrderingSucceeded { table_id, .. }
            | ComputationAction::ClearTableOrdering { table_id }
            | ComputationAction::TableFilteringSucceeded { table_id, .. }
            | ComputationAction::TableAggregationSucceeded { table_id, .. }
            | ComputationAction::SystemColumnsSucceeded { table_id, .. }
            | ComputationAction::ColumnAggregationSucceeded { table_id, .. }
            | ComputationAction::FilteredColumnAggregationSucceeded { table_id, .. }
            | ComputationAction::SetCrossFilters { table_id, .. }
            | ComputationAction::SetResultSearchPattern { table_id, .. }
            | ComputationAction::ColumnSearchSucceeded { table_id, .. }
            | ComputationAction::DataSearchSucceeded { table_id, .. }
            | ComputationAction::DataSearchFailed { table_id, .. }
            | ComputationAction::ResultSearchFailed { table_id, .. } => Some(*table_id),
        }
    }

    /// Refuse an action that the state can't apply: a task of a column group that the computation doesn't have
    fn check(&self, table_id: TableId, action: &ComputationAction) -> Result<()> {
        let ComputationAction::ScheduleTask { task, .. } = action else {
            return Ok(());
        };
        let column_id = match task {
            ComputationTask::ColumnAggregation(task) => task.column_id,
            ComputationTask::FilteredColumnAggregation(task) => task.column.column_id,
            _ => return Ok(()),
        };
        match self.computations.get(&table_id) {
            Some(computation) if column_id as usize >= computation.column_groups.len() => Err(Error::invalid_argument(
                format!("the computation of the table {table_id} has no column group {column_id}"),
            )),
            _ => Ok(()),
        }
    }

    /// Apply an action. A failed action leaves the state unchanged. A result for an unknown computation or one that
    /// is no longer current changes nothing and is released.
    pub fn apply(&mut self, action: ComputationAction) -> Result<ComputationOutcome> {
        let mut outcome = ComputationOutcome::default();
        let Some(table_id) = self.action_table(&action) else {
            return Ok(outcome);
        };
        self.check(table_id, &action)?;

        let mut held_before = self.held_by_table(table_id);
        action.collect_handed_over(&mut held_before);

        let changed = self.reduce(table_id, action, &mut outcome);
        if changed.table || changed.scheduler {
            self.revision += 1;
            outcome.changed = true;
            if changed.table {
                if let Some(computation) = self.computations.get_mut(&table_id) {
                    computation.revision = self.revision;
                }
            }
        }

        // Release what the state no longer holds
        let held_after = self.held_by_table(table_id);
        let mut frames: BTreeSet<DataFrameId> = held_before.data_frames.into_iter().collect();
        let mut tables: BTreeSet<ArrowTableId> = held_before.tables.into_iter().collect();
        for frame in &held_after.data_frames {
            frames.remove(frame);
        }
        for table in &held_after.tables {
            tables.remove(table);
        }
        if !frames.is_empty() || !tables.is_empty() {
            let held = self.held_by_all();
            for frame in &held.data_frames {
                frames.remove(frame);
            }
            for table in &held.tables {
                tables.remove(table);
            }
        }
        outcome.effects.extend(frames.into_iter().map(|data_frame| ComputationEffect::ReleaseDataFrame { data_frame }));
        outcome.effects.extend(tables.into_iter().map(|table| ComputationEffect::ReleaseArrowTable { table }));
        Ok(outcome)
    }

    /// Apply an action to the computation of a table and the scheduler tasks
    fn reduce(&mut self, table_id: TableId, action: ComputationAction, outcome: &mut ComputationOutcome) -> Changed {
        let effects = &mut outcome.effects;
        match action {
            ComputationAction::ScheduleTask { mut task, now } => {
                let Some(computation) = self.computations.get_mut(&table_id) else {
                    return Changed::NONE;
                };
                let task_id = self.next_task_id;
                self.next_task_id = self.next_task_id.saturating_add(1);
                computation.register_task(task_id, &mut task, Progress::Start(now), effects);
                self.scheduler_tasks.insert(task_id, task);
                outcome.task_id = Some(task_id);
                Changed { table: true, scheduler: true }
            }
            ComputationAction::UpdateSchedulerTask { task_id, progress, now } => {
                let (Some(task), Some(computation)) =
                    (self.scheduler_tasks.get(&task_id), self.computations.get_mut(&table_id))
                else {
                    return Changed::NONE;
                };
                let mut task = task.clone();
                let table = computation.register_task(task_id, &mut task, Progress::Update(&progress, now), effects);
                Changed { table, scheduler: false }
            }
            ComputationAction::UnregisterSchedulerTask { task_id } => {
                let removed = self.scheduler_tasks.remove(&task_id).is_some();
                Changed { table: false, scheduler: removed }
            }
            ComputationAction::ComputationFromQueryResult {
                table_id,
                data_table,
                fields,
                column_groups,
                lifetime,
                connection_id,
                client_context,
            } => {
                if let Some(previous) = self.computations.remove(&table_id) {
                    effects.push(ComputationEffect::AbortComputation { table_id, lifetime: previous.lifetime });
                }
                let computation = TableComputation::new(
                    table_id,
                    data_table,
                    fields,
                    column_groups,
                    lifetime,
                    connection_id,
                    client_context,
                );
                self.computations.insert(table_id, computation);
                Changed::TABLE
            }
            ComputationAction::DeleteComputation { table_id } => match self.computations.remove(&table_id) {
                Some(previous) => {
                    effects.push(ComputationEffect::AbortComputation { table_id, lifetime: previous.lifetime });
                    Changed::TABLE
                }
                None => Changed::NONE,
            },
            action => {
                let Some(computation) = self.computations.get_mut(&table_id) else {
                    return Changed::NONE;
                };
                if reduce_computation(computation, action, effects) {
                    Changed::TABLE
                } else {
                    Changed::NONE
                }
            }
        }
    }
}

/// Apply an action to an existing computation, returns whether it changed
fn reduce_computation(
    computation: &mut TableComputation,
    action: ComputationAction,
    effects: &mut Vec<ComputationEffect>,
) -> bool {
    match action {
        ComputationAction::CreatedDataFrame { data_frame, .. } => {
            computation.version = computation.version.with_data_increment();
            computation.data_frame = Some(data_frame);
        }
        ComputationAction::TableOrderingSucceeded { ordering, now, .. } => {
            // The ordering depends on the data, the filter and the data search
            let requested = computation.tasks.ordering.as_ref().map(|tracked| &tracked.task.ordering_constraints);
            if !ordering.version.filter_matches(computation.version)
                || computation.data_search_request() != ordering.data_search_request_id
                || !requested.is_some_and(|requested| same_ordering(requested, &ordering.ordering_constraints))
            {
                return false;
            }
            if let Some(tracked) = &mut computation.tasks.ordering {
                tracked.progress.succeed(now);
            }
            computation.data_table_ordering = ordering.ordering_constraints.clone();
            computation.ordering_table = Some(ordering);
        }
        ComputationAction::ClearTableOrdering { .. } => {
            computation.data_table_ordering.clear();
            computation.ordering_table = None;
            if let Some(tracked) = &mut computation.tasks.ordering {
                tracked.task.ordering_constraints.clear();
            }
        }
        ComputationAction::TableFilteringSucceeded { version, filter, now, .. } => {
            // The filter version moved when the filtering was scheduled, only the latest filtering is current
            if !version.filter_matches(computation.version) {
                return false;
            }
            if let Some(tracked) = &mut computation.tasks.filtering {
                tracked.progress.succeed(now);
            }
            if filter.is_none() && computation.data_search_table.is_none() {
                // Without a selection the summaries over the selected rows go
                computation.filtered_column_aggregates_outdated.fill(false);
                computation.clear_filtered_aggregates();
            } else {
                // With a selection they stay until new ones are computed, their filter version tells they are outdated
                computation.filtered_column_aggregates_outdated = computation
                    .outdated_filtered_aggregates(filter.as_ref().map(|filter| filter.version), computation.data_search_request());
            }
            computation.filter_table = filter;
            computation.ordering_table = None;
        }
        ComputationAction::TableAggregationSucceeded { aggregation, now, .. } => {
            computation.table_aggregation = Some(aggregation);
            if let Some(tracked) = &mut computation.tasks.table_aggregation {
                tracked.progress.succeed(now);
            }
        }
        ComputationAction::SystemColumnsSucceeded { data_table, data_frame, column_groups, now, .. } => {
            let row_numbers = column_groups.iter().enumerate().rev().find_map(|(index, group)| match group {
                ColumnGroup::RowNumber(group) => Some((index, group.row_number_field_name.clone())),
                _ => None,
            });
            computation.version = computation.version.with_data_increment();
            computation.data_table = data_table;
            computation.data_frame = Some(data_frame);
            computation.column_groups = column_groups;
            computation.row_number_column_group = row_numbers.as_ref().map(|(index, _)| *index);
            computation.row_number_column_name = row_numbers.map(|(_, name)| name);
            if let Some(tracked) = &mut computation.tasks.system_columns {
                tracked.progress.succeed(now);
            }
        }
        ComputationAction::ColumnAggregationSucceeded { column_id, aggregate, now, .. } => {
            let column = column_id as usize;
            let Some(Some(tracked)) = computation.tasks.column_aggregation.get_mut(column) else {
                return false;
            };
            tracked.progress.succeed(now);
            set_slot(&mut computation.column_aggregates, column, Some(aggregate));
        }
        ComputationAction::FilteredColumnAggregationSucceeded { column_id, version, aggregate, now, .. } => {
            let column = column_id as usize;
            let search = computation.data_search_request();
            let selection = computation.selection_version();
            let Some(Some(tracked)) = computation.tasks.filtered_column_aggregation.get_mut(column) else {
                return false;
            };
            if !tracked.task.column.table_version.filter_matches(version)
                || !selection.filter_matches(version)
                || aggregate.as_ref().and_then(|aggregate| aggregate.data_search_request_id) != search
                || tracked.task.data_search_table.as_ref().map(|search| search.request_id) != search
            {
                return false;
            }
            tracked.progress.succeed(now);
            let up_to_date = aggregate.as_ref().is_some_and(|aggregate| {
                aggregate.filter_version.filter_matches(selection) && aggregate.data_search_request_id == search
            });
            set_slot(&mut computation.filtered_column_aggregates, column, aggregate);
            if computation.filtered_column_aggregates_outdated.len() <= column {
                computation.filtered_column_aggregates_outdated.resize(column.saturating_add(1), false);
            }
            if let Some(outdated) = computation.filtered_column_aggregates_outdated.get_mut(column) {
                *outdated = !up_to_date;
            }
        }
        ComputationAction::SetCrossFilters { filters, .. } => {
            // The same selections keep the state, the filtering doesn't run again
            if computation.cross_filters.selects_same(&filters) {
                return false;
            }
            computation.cross_filters = filters;
        }
        ComputationAction::SetResultSearchPattern { kind, pattern, .. } => {
            let current = match kind {
                SearchKind::Columns => &computation.column_search,
                SearchKind::Data => &computation.data_search,
            };
            if current.requested_pattern == pattern && current.pending == !pattern.is_empty() {
                return false;
            }
            let request_id = current.request_id.saturating_add(1);
            let next = if pattern.is_empty() {
                ResultSearchState { request_id, applied_request_id: request_id, ..Default::default() }
            } else {
                // The matches of the applied search stay visible while the new one runs
                ResultSearchState { requested_pattern: pattern.clone(), request_id, pending: true, error: None, ..current.clone() }
            };
            if kind == SearchKind::Data {
                if let Some(tracked) = &computation.tasks.data_search {
                    effects.push(ComputationEffect::AbortDataSearch {
                        table_id: computation.table_id,
                        request_id: tracked.task.request_id,
                    });
                }
                // Ending the data search drops its rows
                if pattern.is_empty() {
                    computation.filtered_column_aggregates_outdated =
                        computation.outdated_filtered_aggregates(computation.filter_table.as_ref().map(|filter| filter.version), None);
                    if computation.filter_table.is_none() {
                        computation.clear_filtered_aggregates();
                    }
                    computation.data_search_table = None;
                    computation.ordering_table = None;
                    computation.tasks.data_search = None;
                }
            }
            match kind {
                SearchKind::Columns => computation.column_search = next,
                SearchKind::Data => computation.data_search = next,
            }
        }
        ComputationAction::ColumnSearchSucceeded { data_frame, request_id, matching_column_groups, .. } => {
            if computation.data_frame != Some(data_frame) || computation.column_search.request_id != request_id {
                return false;
            }
            let search = &mut computation.column_search;
            search.applied_pattern = search.requested_pattern.clone();
            search.applied_request_id = request_id;
            search.matching_column_groups = Some(matching_column_groups);
            search.pending = false;
            search.error = None;
        }
        ComputationAction::DataSearchSucceeded { data_frame, request_id, search, matching_rows, now, .. } => {
            if computation.data_frame != Some(data_frame)
                || computation.data_search.request_id != request_id
                || !search.version.data_matches(computation.version)
            {
                return false;
            }
            let state = &mut computation.data_search;
            state.applied_pattern = state.requested_pattern.clone();
            state.applied_request_id = request_id;
            state.matching_rows = Some(matching_rows);
            state.pending = false;
            state.error = None;
            if let Some(tracked) = &mut computation.tasks.data_search {
                tracked.progress.succeed(now);
            }
            computation.filtered_column_aggregates_outdated = computation
                .outdated_filtered_aggregates(computation.filter_table.as_ref().map(|filter| filter.version), Some(search.request_id));
            computation.data_search_table = Some(search);
            computation.ordering_table = None;
        }
        ComputationAction::DataSearchFailed { data_frame, request_id, error, .. } => {
            if computation.data_frame != Some(data_frame) || computation.data_search.request_id != request_id {
                return false;
            }
            let state = &mut computation.data_search;
            state.applied_pattern.clear();
            state.applied_request_id = request_id;
            state.matching_rows = None;
            state.pending = false;
            state.error = Some(error);
            computation.filtered_column_aggregates_outdated =
                computation.outdated_filtered_aggregates(computation.filter_table.as_ref().map(|filter| filter.version), None);
            if computation.filter_table.is_none() {
                computation.clear_filtered_aggregates();
            }
            computation.data_search_table = None;
            computation.ordering_table = None;
        }
        ComputationAction::ResultSearchFailed { data_frame, kind, request_id, error, .. } => {
            if computation.data_frame != Some(data_frame) {
                return false;
            }
            let state = match kind {
                SearchKind::Columns => &mut computation.column_search,
                SearchKind::Data => &mut computation.data_search,
            };
            if state.request_id != request_id {
                return false;
            }
            state.applied_pattern.clear();
            state.applied_request_id = request_id;
            state.matching_column_groups = None;
            state.matching_rows = None;
            state.pending = false;
            state.error = Some(error);
        }
        // The scheduler and the lifecycle of computations are reduced by the state
        ComputationAction::ScheduleTask { .. }
        | ComputationAction::UpdateSchedulerTask { .. }
        | ComputationAction::UnregisterSchedulerTask { .. }
        | ComputationAction::ComputationFromQueryResult { .. }
        | ComputationAction::DeleteComputation { .. } => return false,
    }
    true
}
