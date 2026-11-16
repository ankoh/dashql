//! The values of the computation state: versions, column groups, the results of the tasks and the tasks.
//!
//! The Arrow tables of the state are tables of the host, the state names them by their handles (`crate::handles`) and
//! keeps what it read of them: the rows, the schema and the values of statistics. The data frames are ids of tables in
//! the compute database of the host.

use std::fmt;
use std::sync::Arc;

use arrow_schema::{Schema, SchemaRef};

use super::tasks::analysis::{OrdinalColumnAnalysis, StringColumnAnalysis};
use super::tasks::StatsRow;
use crate::handles::Handle;

/// The id of the result table that a computation summarizes, unique among the computations
pub type TableId = u64;

/// The id of a task of the scheduler
pub type TaskId = u64;

/// The id of a data frame, a table in the compute database of the host
pub type DataFrameId = u64;

/// An Arrow table of the host, a handle
pub type ArrowTableId = Handle;

/// The lifetime of a computation at the host, a handle: aborting it cancels the work on the computation
pub type LifetimeId = Handle;

/// A point in time in milliseconds since epoch
pub type Timestamp = i64;

/// The version of a computation: the data changes with a new data frame, the filter with every scheduled filtering
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct ComputationVersion {
    /// Changes when the data changes
    pub data: u64,
    /// Changes when the filters change
    pub filter: u64,
}

impl ComputationVersion {
    /// A version
    pub fn new(data: u64, filter: u64) -> Self {
        Self { data, filter }
    }

    /// The version with the next data
    pub fn with_data_increment(self) -> Self {
        Self { data: self.data.saturating_add(1), filter: self.filter }
    }

    /// The version with the next filter
    pub fn with_filter_increment(self) -> Self {
        Self { data: self.data, filter: self.filter.saturating_add(1) }
    }

    /// Is the data the same?
    pub fn data_matches(self, other: Self) -> bool {
        self.data == other.data
    }

    /// Are the data and the filter the same?
    pub fn filter_matches(self, other: Self) -> bool {
        self.data == other.data && self.filter == other.filter
    }
}

impl fmt::Display for ComputationVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.data, self.filter)
    }
}

/// An Arrow table of the host by its handle, with what the runtime read of it. The rows stay with the host, which
/// releases them when the state lets go of the handle.
#[derive(Clone)]
pub struct ArrowTable {
    /// The handle of the table at the host
    pub id: ArrowTableId,
    /// The rows
    pub rows: u64,
    /// The schema, empty for a table that the host handed over
    pub schema: SchemaRef,
    /// The values of the row of statistics, of a table aggregation that the runtime computed
    pub stats: Option<Arc<StatsRow>>,
}

impl ArrowTable {
    /// A table that the runtime read
    pub fn new(id: ArrowTableId, rows: u64, schema: SchemaRef) -> Self {
        Self { id, rows, schema, stats: None }
    }

    /// A table that the host handed over, the runtime knows only its rows
    pub fn host(id: ArrowTableId, rows: u64) -> Self {
        Self { id, rows, schema: Arc::new(Schema::empty()), stats: None }
    }

    /// The rows of the table
    pub fn rows(&self) -> u64 {
        self.rows
    }
}

// A handle names one table, two tables are the same if they have the same handle
impl PartialEq for ArrowTable {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for ArrowTable {}

impl fmt::Debug for ArrowTable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ArrowTable").field("id", &self.id).field("rows", &self.rows).finish()
    }
}

/// The comparison of a scalar filter
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterOp {
    /// `=`
    Equal,
    /// `<`
    Less,
    /// `<=`
    LessEqual,
    /// `>`
    Greater,
    /// `>=`
    GreaterEqual,
}

/// A filter that compares a field with a number
#[derive(Clone, Debug, PartialEq)]
pub struct ScalarFilter {
    /// The field
    pub field_name: String,
    /// The comparison
    pub op: FilterOp,
    /// The number
    pub value: f64,
}

/// A key of an ordering
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderByConstraint {
    /// The field
    pub field: String,
    /// Ascending? Ascending without.
    pub ascending: Option<bool>,
    /// Nulls first? Nulls last without.
    pub nulls_first: Option<bool>,
}

/// Do two orderings order the same, with the defaults of keys that leave them out?
pub fn same_ordering(left: &[OrderByConstraint], right: &[OrderByConstraint]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(l, r)| {
            l.field == r.field
                && l.ascending.unwrap_or(true) == r.ascending.unwrap_or(true)
                && l.nulls_first.unwrap_or(false) == r.nulls_first.unwrap_or(false)
        })
}

/// The fields of the table aggregation with the statistics of a column
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnStatsFields {
    /// The count of values that aren't null
    pub count_field_name: String,
    /// The count of distinct values, only of strings and lists
    pub distinct_count_field_name: Option<String>,
    /// The minimum
    pub min_aggregate_field_name: Option<String>,
    /// The maximum
    pub max_aggregate_field_name: Option<String>,
}

/// The column with the row numbers
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowNumberColumnGroup {
    /// The field with the row numbers
    pub row_number_field_name: String,
}

/// A column that isn't summarized
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkippedColumnGroup {
    /// The field
    pub input_field_name: String,
    /// The Arrow type of the field as the host names it
    pub input_field_type: String,
    /// Is the field nullable?
    pub input_field_nullable: bool,
}

/// A column of ordered values, summarized as a histogram
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrdinalColumnGroup {
    /// The field
    pub input_field_name: String,
    /// The Arrow type of the field as the host names it
    pub input_field_type: String,
    /// Is the field nullable?
    pub input_field_nullable: bool,
    /// The statistics of the column in the table aggregation
    pub stats_fields: Option<ColumnStatsFields>,
    /// The field with the bin of a value
    pub bin_field_name: Option<String>,
    /// The bins
    pub bin_count: u32,
}

/// A column of strings, summarized by its frequent values
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StringColumnGroup {
    /// The field
    pub input_field_name: String,
    /// The Arrow type of the field as the host names it
    pub input_field_type: String,
    /// Is the field nullable?
    pub input_field_nullable: bool,
    /// The statistics of the column in the table aggregation
    pub stats_fields: Option<ColumnStatsFields>,
    /// The field with the id of a value
    pub value_id_field_name: Option<String>,
}

/// A column of lists, summarized by its frequent values
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListColumnGroup {
    /// The field
    pub input_field_name: String,
    /// The Arrow type of the field as the host names it
    pub input_field_type: String,
    /// Is the field nullable?
    pub input_field_nullable: bool,
    /// The statistics of the column in the table aggregation
    pub stats_fields: Option<ColumnStatsFields>,
    /// The field with the id of a value
    pub value_id_field_name: Option<String>,
}

/// A column of the grid of a result
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ColumnGroup {
    /// The row numbers
    RowNumber(RowNumberColumnGroup),
    /// A column that isn't summarized
    Skipped(SkippedColumnGroup),
    /// A column of ordered values
    Ordinal(OrdinalColumnGroup),
    /// A column of strings
    String(StringColumnGroup),
    /// A column of lists
    List(ListColumnGroup),
}

impl ColumnGroup {
    /// The name of the kind of the column
    pub fn type_name(&self) -> &'static str {
        match self {
            ColumnGroup::RowNumber(_) => "ROWNUMBER",
            ColumnGroup::Skipped(_) => "SKIPPED",
            ColumnGroup::Ordinal(_) => "ORDINAL",
            ColumnGroup::String(_) => "STRING",
            ColumnGroup::List(_) => "LIST",
        }
    }

    /// Does the column get a filtered summary? Row numbers, skipped columns and lists don't.
    pub fn has_filtered_summary(&self) -> bool {
        matches!(self, ColumnGroup::Ordinal(_) | ColumnGroup::String(_))
    }
}

/// The table with the rows that pass the cross filters
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilterTable {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The row numbers of the rows that pass, an Arrow table
    pub table: ArrowTable,
    /// The row numbers of the rows that pass, a data frame
    pub data_frame: DataFrameId,
    /// The version that the filter was computed for
    pub version: ComputationVersion,
}

/// The table with the row numbers in the order of the grid
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderingTable {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The ordering
    pub ordering_constraints: Vec<OrderByConstraint>,
    /// The row numbers in order, an Arrow table
    pub table: ArrowTable,
    /// The row numbers in order, a data frame
    pub data_frame: DataFrameId,
    /// The version that the ordering was computed for
    pub version: ComputationVersion,
    /// The data search that the ordering is limited to
    pub data_search_request_id: Option<u64>,
}

/// The rows that a data search matched
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataSearchTable {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The matched rows and their matching columns, an Arrow table
    pub table: ArrowTable,
    /// The matched rows and their matching columns, a data frame
    pub data_frame: DataFrameId,
    /// The version of the data that was searched
    pub version: ComputationVersion,
    /// The search request
    pub request_id: u64,
}

/// The statistics of all columns of a table
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableAggregation {
    /// The statistics, one row
    pub table: ArrowTable,
    /// The statistics, a data frame
    pub data_frame: DataFrameId,
    /// The field with the row count
    pub count_star_field_name: String,
}

/// The analysis of the summary of a column
#[derive(Clone, Debug, PartialEq)]
pub enum ColumnSummaryAnalysis {
    /// The histogram of an ordinal column
    Ordinal(OrdinalColumnAnalysis),
    /// The frequent values of a string column
    String(StringColumnAnalysis),
}

/// The summary of a column: the binned or the frequent values with their analysis, and their data frame
#[derive(Clone, Debug)]
pub struct ColumnSummary {
    /// The binned or the frequent values
    pub table: ArrowTable,
    /// The data frame of the binned or the frequent values
    pub data_frame: DataFrameId,
    /// The analysis, none for a summary that the host analyzed
    pub analysis: Option<Arc<ColumnSummaryAnalysis>>,
}

// The analysis follows from the table, a summary is the same if its table and its data frame are
impl PartialEq for ColumnSummary {
    fn eq(&self, other: &Self) -> bool {
        self.table == other.table && self.data_frame == other.data_frame
    }
}

impl Eq for ColumnSummary {}

/// The summary of a column of a kind
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ColumnAggregate {
    /// The histogram of an ordinal column
    Ordinal(ColumnSummary),
    /// The frequent values of a string column
    String(ColumnSummary),
    /// The frequent values of a list column
    List(ColumnSummary),
    /// A skipped column has no summary
    Skipped,
}

impl ColumnAggregate {
    /// The summary, none of a skipped column
    pub fn summary(&self) -> Option<&ColumnSummary> {
        match self {
            ColumnAggregate::Ordinal(summary) | ColumnAggregate::String(summary) | ColumnAggregate::List(summary) => {
                Some(summary)
            }
            ColumnAggregate::Skipped => None,
        }
    }
}

/// The summary of a column over the rows that the filters and the data search select
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilteredColumnAggregate {
    /// The summary
    pub aggregate: ColumnAggregate,
    /// The filter version that the summary was computed for
    pub filter_version: ComputationVersion,
    /// The data search that the summary was computed for
    pub data_search_request_id: Option<u64>,
}

/// The search of a result, of its columns or of its data
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResultSearchState {
    /// The text that the user searches
    pub requested_pattern: String,
    /// The text of the last applied search
    pub applied_pattern: String,
    /// The latest request, it counts up with every requested search
    pub request_id: u64,
    /// The last applied request
    pub applied_request_id: u64,
    /// The matching column groups of a search of the columns
    pub matching_column_groups: Option<Vec<u32>>,
    /// The number of matched rows of a search of the data, the host reads their matching columns from the table
    pub matching_rows: Option<u64>,
    /// Is a search running?
    pub pending: bool,
    /// The error of the latest search
    pub error: Option<String>,
}

/// The status of a task
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum TaskStatus {
    /// The task runs
    Running = 1,
    /// The task succeeded
    Succeeded = 2,
    /// The task failed
    Failed = 3,
    /// The task was cancelled, e.g. its query was stopped
    Cancelled = 4,
}

/// The progress of a task
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskProgress {
    /// The status
    pub status: TaskStatus,
    /// When the task started
    pub started_at: Timestamp,
    /// When the task succeeded
    pub completed_at: Option<Timestamp>,
    /// When the task failed or was cancelled
    pub failed_at: Option<Timestamp>,
    /// The error of a failed task, the message of a cancelled one
    pub failed_with_error: Option<String>,
}

impl TaskProgress {
    /// A task that started running
    pub fn running(now: Timestamp) -> Self {
        Self { status: TaskStatus::Running, started_at: now, completed_at: None, failed_at: None, failed_with_error: None }
    }

    /// Apply an update, it sets what it has
    pub fn update(&mut self, update: &TaskProgressUpdate) {
        if let Some(status) = update.status {
            self.status = status;
        }
        if let Some(started_at) = update.started_at {
            self.started_at = started_at;
        }
        if update.completed_at.is_some() {
            self.completed_at = update.completed_at;
        }
        if update.failed_at.is_some() {
            self.failed_at = update.failed_at;
        }
        if update.failed_with_error.is_some() {
            self.failed_with_error.clone_from(&update.failed_with_error);
        }
    }

    /// Mark the task succeeded
    pub(crate) fn succeed(&mut self, now: Timestamp) {
        self.status = TaskStatus::Succeeded;
        self.completed_at = Some(now);
    }
}

/// An update of the progress of a task, it sets what it has
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TaskProgressUpdate {
    /// The status
    pub status: Option<TaskStatus>,
    /// When the task started
    pub started_at: Option<Timestamp>,
    /// When the task succeeded
    pub completed_at: Option<Timestamp>,
    /// When the task failed
    pub failed_at: Option<Timestamp>,
    /// The error of a failed task
    pub failed_with_error: Option<String>,
}

/// A task with its progress, as a computation tracks it
#[derive(Clone, Debug, PartialEq)]
pub struct TrackedTask<T> {
    /// The scheduler task that the computation tracks, the host knows its task by it
    pub task_id: TaskId,
    /// The task
    pub task: T,
    /// The progress
    pub progress: TaskProgress,
}

/// Filter the rows of a table
#[derive(Clone, Debug, PartialEq)]
pub struct TableFilteringTask {
    /// The table
    pub table_id: TableId,
    /// The version that the filter is computed for
    pub table_version: ComputationVersion,
    /// The table
    pub input_data_table: ArrowTable,
    /// The data frame of the table
    pub input_data_frame: DataFrameId,
    /// The row numbers of the data frame
    pub row_number_column_name: String,
    /// The filters
    pub filters: Vec<ScalarFilter>,
}

/// Order the rows of a table
#[derive(Clone, Debug, PartialEq)]
pub struct TableOrderingTask {
    /// The table
    pub table_id: TableId,
    /// The version that the ordering is computed for
    pub table_version: ComputationVersion,
    /// The table
    pub input_data_table: ArrowTable,
    /// The data frame of the table
    pub input_data_frame: DataFrameId,
    /// The filtered rows to order, if a filter is active
    pub filter_table: Option<FilterTable>,
    /// The searched rows to order, if a data search is active
    pub data_search_table: Option<DataSearchTable>,
    /// The row numbers of the data frame, stable ids into the table
    pub row_number_column_name: String,
    /// The ordering
    pub ordering_constraints: Vec<OrderByConstraint>,
}

/// A column that a data search searches
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataSearchColumn {
    /// The column of the result
    pub column_idx: u32,
    /// The column group of the column
    pub column_group_idx: u32,
    /// The field
    pub field_name: String,
}

/// Search the data of a table. The host cancels it when it is superseded or the computation goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataSearchTask {
    /// The table
    pub table_id: TableId,
    /// The version that the search was requested for
    pub table_version: ComputationVersion,
    /// The data frame to search
    pub input_data_frame: DataFrameId,
    /// The row numbers of the data frame
    pub row_number_column_name: String,
    /// The columns to search
    pub columns: Vec<DataSearchColumn>,
    /// The text to search
    pub pattern: String,
    /// The search request, a later request supersedes it
    pub request_id: u64,
}

/// Compute the statistics of all columns of a table
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableAggregationTask {
    /// The table
    pub table_id: TableId,
    /// The version of the table
    pub table_version: ComputationVersion,
    /// The columns
    pub column_entries: Vec<ColumnGroup>,
    /// The data frame of the table
    pub input_data_frame: DataFrameId,
}

/// Compute the system columns of a table, e.g. the bins and value ids that the filters use
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SystemColumnsTask {
    /// The table
    pub table_id: TableId,
    /// The version of the table
    pub table_version: ComputationVersion,
    /// The columns
    pub column_entries: Vec<ColumnGroup>,
    /// The table
    pub input_table: ArrowTable,
    /// The data frame of the table
    pub input_data_frame: DataFrameId,
    /// The row numbers of the data frame, from 1
    pub row_number_field_name: String,
    /// The statistics of the table
    pub table_aggregate: TableAggregation,
}

/// Compute the summary of a column
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColumnAggregationTask {
    /// The table
    pub table_id: TableId,
    /// The version of the table
    pub table_version: ComputationVersion,
    /// The column group
    pub column_id: u32,
    /// The column
    pub column_entry: ColumnGroup,
    /// The data frame of the table
    pub input_data_frame: DataFrameId,
    /// The statistics of the table
    pub table_aggregate: TableAggregation,
}

/// Compute the summary of a column over the selected rows
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FilteredColumnAggregationTask {
    /// The summary to compute
    pub column: ColumnAggregationTask,
    /// The filtered rows, if a filter is active
    pub filter_table: Option<FilterTable>,
    /// The searched rows, if a data search is active
    pub data_search_table: Option<DataSearchTable>,
    /// The rows in the selection
    pub selection_row_count: u64,
    /// The summary over all rows
    pub unfiltered_aggregate: ColumnAggregate,
}

/// A task of the scheduler
#[derive(Clone, Debug, PartialEq)]
pub enum ComputationTask {
    /// Filter the rows of a table
    TableFiltering(TableFilteringTask),
    /// Order the rows of a table
    TableOrdering(TableOrderingTask),
    /// Compute the statistics of all columns of a table
    TableAggregation(TableAggregationTask),
    /// Compute the system columns of a table
    SystemColumns(SystemColumnsTask),
    /// Compute the summary of a column
    ColumnAggregation(ColumnAggregationTask),
    /// Compute the summary of a column over the selected rows
    FilteredColumnAggregation(FilteredColumnAggregationTask),
    /// Search the data of a table
    DataSearch(DataSearchTask),
}

impl ComputationTask {
    /// The table of the task
    pub fn table_id(&self) -> TableId {
        match self {
            ComputationTask::TableFiltering(task) => task.table_id,
            ComputationTask::TableOrdering(task) => task.table_id,
            ComputationTask::TableAggregation(task) => task.table_id,
            ComputationTask::SystemColumns(task) => task.table_id,
            ComputationTask::ColumnAggregation(task) => task.table_id,
            ComputationTask::FilteredColumnAggregation(task) => task.column.table_id,
            ComputationTask::DataSearch(task) => task.table_id,
        }
    }

    /// The title of the queries of the task in the query history
    pub fn title(&self) -> &'static str {
        match self {
            ComputationTask::ColumnAggregation(_) => "Column aggregation",
            ComputationTask::TableFiltering(_) => "Table filtering",
            ComputationTask::TableOrdering(_) => "Table ordering",
            ComputationTask::TableAggregation(_) => "Table aggregation",
            ComputationTask::SystemColumns(_) => "System column computation",
            ComputationTask::FilteredColumnAggregation(_) => "Filtered column aggregation",
            ComputationTask::DataSearch(_) => "Data search",
        }
    }
}
