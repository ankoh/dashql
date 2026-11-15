//! The views of the computations: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`) with
//! TypeScript declarations in the generated `.d.ts` (`tsify`). See docs/wip/runtime_projection.md.
//!
//! The views name the Arrow tables and the lifetimes by their handles of the host, the data frames by their ids. Ids,
//! handles, revisions and times are numbers, a missing value is null. The status of a task is the numeric enum
//! `TaskStatus`, a class of the module.

use dashql_core_runtime::compute::cross_filters::{CrossFilterPredicate, CrossFilters};
use dashql_core_runtime::compute::tasks::analysis::BinBounds;
use dashql_core_runtime::compute::types::{
    self as rt, ColumnStatsFields, ColumnSummaryAnalysis, ComputationVersion, FilterOp, OrderByConstraint, ScalarFilter, TrackedTask,
};
use dashql_core_runtime::compute::{ComputationEffect as RuntimeEffect, ComputationOutcome as RuntimeOutcome, TableComputation};
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

/// The status of a task, the numbers of the Rust state
#[wasm_bindgen]
#[allow(non_camel_case_types)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum TaskStatus {
    TASK_RUNNING = 1,
    TASK_SUCCEEDED = 2,
    TASK_FAILED = 3,
}

impl From<rt::TaskStatus> for TaskStatus {
    fn from(status: rt::TaskStatus) -> Self {
        match status {
            rt::TaskStatus::Running => TaskStatus::TASK_RUNNING,
            rt::TaskStatus::Succeeded => TaskStatus::TASK_SUCCEEDED,
            rt::TaskStatus::Failed => TaskStatus::TASK_FAILED,
        }
    }
}

impl From<TaskStatus> for rt::TaskStatus {
    fn from(status: TaskStatus) -> Self {
        match status {
            TaskStatus::TASK_RUNNING => rt::TaskStatus::Running,
            TaskStatus::TASK_SUCCEEDED => rt::TaskStatus::Succeeded,
            TaskStatus::TASK_FAILED => rt::TaskStatus::Failed,
        }
    }
}

/// The version of a computation: the data changes with a new data frame, the filter with every scheduled filtering
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, Tsify)]
#[tsify(missing_as_null)]
pub struct ComputationVersionValue {
    pub data: u64,
    pub filter: u64,
}

impl From<ComputationVersion> for ComputationVersionValue {
    fn from(version: ComputationVersion) -> Self {
        ComputationVersionValue { data: version.data, filter: version.filter }
    }
}

impl From<ComputationVersionValue> for ComputationVersion {
    fn from(version: ComputationVersionValue) -> Self {
        ComputationVersion::new(version.data, version.filter)
    }
}

/// An Arrow table of the host by its handle
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationArrowTable {
    pub id: u32,
    /// The rows, in a snapshot
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u64>,
}

/// The fields of the table aggregation with the statistics of a column
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationStatsFields {
    pub count_field_name: String,
    pub distinct_count_field_name: Option<String>,
    pub min_aggregate_field_name: Option<String>,
    pub max_aggregate_field_name: Option<String>,
}

impl From<&ColumnStatsFields> for ComputationStatsFields {
    fn from(fields: &ColumnStatsFields) -> Self {
        ComputationStatsFields {
            count_field_name: fields.count_field_name.clone(),
            distinct_count_field_name: fields.distinct_count_field_name.clone(),
            min_aggregate_field_name: fields.min_aggregate_field_name.clone(),
            max_aggregate_field_name: fields.max_aggregate_field_name.clone(),
        }
    }
}

impl From<ComputationStatsFields> for ColumnStatsFields {
    fn from(fields: ComputationStatsFields) -> Self {
        ColumnStatsFields {
            count_field_name: fields.count_field_name,
            distinct_count_field_name: fields.distinct_count_field_name,
            min_aggregate_field_name: fields.min_aggregate_field_name,
            max_aggregate_field_name: fields.max_aggregate_field_name,
        }
    }
}

/// A column of the grid of a result, the type of a field as the host names it
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationColumnGroup {
    #[serde(rename = "ROWNUMBER")]
    RowNumber { row_number_field_name: String },
    Skipped { input_field_name: String, input_field_type: String, input_field_nullable: bool },
    Ordinal {
        input_field_name: String,
        input_field_type: String,
        input_field_nullable: bool,
        stats_fields: Option<ComputationStatsFields>,
        bin_field_name: Option<String>,
        bin_count: u32,
    },
    String {
        input_field_name: String,
        input_field_type: String,
        input_field_nullable: bool,
        stats_fields: Option<ComputationStatsFields>,
        value_id_field_name: Option<String>,
    },
    List {
        input_field_name: String,
        input_field_type: String,
        input_field_nullable: bool,
        stats_fields: Option<ComputationStatsFields>,
        value_id_field_name: Option<String>,
    },
}

impl From<&rt::ColumnGroup> for ComputationColumnGroup {
    fn from(group: &rt::ColumnGroup) -> Self {
        let stats = |fields: &Option<ColumnStatsFields>| fields.as_ref().map(ComputationStatsFields::from);
        match group {
            rt::ColumnGroup::RowNumber(g) => Self::RowNumber { row_number_field_name: g.row_number_field_name.clone() },
            rt::ColumnGroup::Skipped(g) => Self::Skipped {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
            },
            rt::ColumnGroup::Ordinal(g) => Self::Ordinal {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                bin_field_name: g.bin_field_name.clone(),
                bin_count: g.bin_count,
            },
            rt::ColumnGroup::String(g) => Self::String {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                value_id_field_name: g.value_id_field_name.clone(),
            },
            rt::ColumnGroup::List(g) => Self::List {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                value_id_field_name: g.value_id_field_name.clone(),
            },
        }
    }
}

impl From<ComputationColumnGroup> for rt::ColumnGroup {
    fn from(group: ComputationColumnGroup) -> Self {
        use ComputationColumnGroup as G;
        match group {
            G::RowNumber { row_number_field_name } => rt::ColumnGroup::RowNumber(rt::RowNumberColumnGroup { row_number_field_name }),
            G::Skipped { input_field_name, input_field_type, input_field_nullable } => {
                rt::ColumnGroup::Skipped(rt::SkippedColumnGroup { input_field_name, input_field_type, input_field_nullable })
            }
            G::Ordinal { input_field_name, input_field_type, input_field_nullable, stats_fields, bin_field_name, bin_count } => {
                rt::ColumnGroup::Ordinal(rt::OrdinalColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: stats_fields.map(Into::into),
                    bin_field_name,
                    bin_count,
                })
            }
            G::String { input_field_name, input_field_type, input_field_nullable, stats_fields, value_id_field_name } => {
                rt::ColumnGroup::String(rt::StringColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: stats_fields.map(Into::into),
                    value_id_field_name,
                })
            }
            G::List { input_field_name, input_field_type, input_field_nullable, stats_fields, value_id_field_name } => {
                rt::ColumnGroup::List(rt::ListColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: stats_fields.map(Into::into),
                    value_id_field_name,
                })
            }
        }
    }
}

/// The comparison of a scalar filter
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Tsify)]
pub enum ComputationFilterOp {
    #[serde(rename = "=")]
    Equal,
    #[serde(rename = "<")]
    Less,
    #[serde(rename = "<=")]
    LessEqual,
    #[serde(rename = ">")]
    Greater,
    #[serde(rename = ">=")]
    GreaterEqual,
}

/// A filter that compares a field with a number
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationScalarFilter {
    pub field_name: String,
    pub op: ComputationFilterOp,
    pub value: f64,
}

impl From<ComputationScalarFilter> for ScalarFilter {
    fn from(filter: ComputationScalarFilter) -> Self {
        let op = match filter.op {
            ComputationFilterOp::Equal => FilterOp::Equal,
            ComputationFilterOp::Less => FilterOp::Less,
            ComputationFilterOp::LessEqual => FilterOp::LessEqual,
            ComputationFilterOp::Greater => FilterOp::Greater,
            ComputationFilterOp::GreaterEqual => FilterOp::GreaterEqual,
        };
        ScalarFilter { field_name: filter.field_name, op, value: filter.value }
    }
}

/// A key of an ordering, ascending and nulls last without
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOrderBy {
    pub field: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ascending: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nulls_first: Option<bool>,
}

impl From<&OrderByConstraint> for ComputationOrderBy {
    fn from(c: &OrderByConstraint) -> Self {
        ComputationOrderBy { field: c.field.clone(), ascending: c.ascending, nulls_first: c.nulls_first }
    }
}

impl From<ComputationOrderBy> for OrderByConstraint {
    fn from(c: ComputationOrderBy) -> Self {
        OrderByConstraint { field: c.field, ascending: c.ascending, nulls_first: c.nulls_first }
    }
}

pub(super) fn order_by(constraints: &[OrderByConstraint]) -> Vec<ComputationOrderBy> {
    constraints.iter().map(ComputationOrderBy::from).collect()
}

/// The rows that pass the cross filters
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationFilterTable {
    pub input_row_number_column_name: String,
    pub table: ComputationArrowTable,
    pub data_frame: u64,
    pub version: ComputationVersionValue,
}

/// The row numbers in the order of the grid
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOrderingTable {
    pub input_row_number_column_name: String,
    pub ordering_constraints: Vec<ComputationOrderBy>,
    pub table: ComputationArrowTable,
    pub data_frame: u64,
    pub version: ComputationVersionValue,
    pub data_search_request_id: Option<u64>,
}

/// The rows that a data search matched
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationDataSearchTable {
    pub input_row_number_column_name: String,
    pub table: ComputationArrowTable,
    pub data_frame: u64,
    pub version: ComputationVersionValue,
    pub request_id: u64,
}

/// The statistics of all columns of a table, the table by its handle
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTableAggregation {
    pub table: u32,
    pub data_frame: u64,
    pub count_star_field_name: String,
}

/// The numbers of the analysis of a summary that the runtime computed. The host formats the values of the tables: the
/// minimum and the maximum of the statistics, the lower bounds of the bins and the frequent values.
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationSummaryAnalysis {
    Ordinal {
        total_count: i64,
        count_not_null: i64,
        count_null: i64,
        bin_count: u32,
        bin_value_counts: Vec<i64>,
        bin_percentages: Vec<f64>,
        /// Numbers in the domain of the column, or milliseconds since epoch of a temporal column
        bin_lower_bounds: Vec<Option<f64>>,
        bin_bounds: ComputationBinBounds,
    },
    String {
        total_count: i64,
        count_not_null: i64,
        count_null: i64,
        count_distinct: i64,
        is_unique: bool,
        frequent_value_ids: Vec<i64>,
        frequent_value_counts: Vec<i64>,
        frequent_value_percentages: Vec<f64>,
    },
}

/// What the lower bounds of the bins of a histogram are
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ComputationBinBounds {
    Numbers,
    EpochMillis,
}

impl From<&ColumnSummaryAnalysis> for ComputationSummaryAnalysis {
    fn from(analysis: &ColumnSummaryAnalysis) -> Self {
        match analysis {
            ColumnSummaryAnalysis::Ordinal(a) => Self::Ordinal {
                total_count: a.total_count,
                count_not_null: a.count_not_null,
                count_null: a.count_null,
                bin_count: a.bin_count,
                bin_value_counts: a.bin_value_counts.clone(),
                bin_percentages: a.bin_percentages.clone(),
                bin_lower_bounds: a.bin_lower_bounds.clone(),
                bin_bounds: match a.bin_bounds {
                    BinBounds::Numbers => ComputationBinBounds::Numbers,
                    BinBounds::EpochMillis => ComputationBinBounds::EpochMillis,
                },
            },
            ColumnSummaryAnalysis::String(a) => Self::String {
                total_count: a.total_count,
                count_not_null: a.count_not_null,
                count_null: a.count_null,
                count_distinct: a.count_distinct,
                is_unique: a.is_unique,
                frequent_value_ids: a.frequent_value_ids.clone(),
                frequent_value_counts: a.frequent_value_counts.clone(),
                frequent_value_percentages: a.frequent_value_percentages.clone(),
            },
        }
    }
}

/// The summary of a column, the id names the table of the binned or the frequent values. A summary that the runtime
/// computed has its analysis.
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationColumnAggregate {
    Ordinal(ComputationColumnSummary),
    String(ComputationColumnSummary),
    List(ComputationColumnSummary),
    Skipped,
}

/// The table and the data frame of a summary
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationColumnSummary {
    pub id: u32,
    pub data_frame: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis: Option<ComputationSummaryAnalysis>,
}

impl From<&rt::ColumnAggregate> for ComputationColumnAggregate {
    fn from(aggregate: &rt::ColumnAggregate) -> Self {
        let summary = |s: &rt::ColumnSummary| ComputationColumnSummary {
            id: s.table.id,
            data_frame: s.data_frame,
            analysis: s.analysis.as_deref().map(ComputationSummaryAnalysis::from),
        };
        match aggregate {
            rt::ColumnAggregate::Ordinal(s) => Self::Ordinal(summary(s)),
            rt::ColumnAggregate::String(s) => Self::String(summary(s)),
            rt::ColumnAggregate::List(s) => Self::List(summary(s)),
            rt::ColumnAggregate::Skipped => Self::Skipped,
        }
    }
}

/// The summary of a column over the rows that the filters and the data search select
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationFilteredAggregate {
    pub aggregate: ComputationColumnAggregate,
    pub filter_version: ComputationVersionValue,
    pub data_search_request_id: Option<u64>,
}

/// A column of a data search
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationDataSearchColumn {
    pub column_idx: u32,
    pub column_group_idx: u32,
    pub field_name: String,
}

/// The summary of a column to compute
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationColumnTask {
    pub table_id: u64,
    pub table_version: ComputationVersionValue,
    pub column_id: u32,
    pub column_entry: Option<ComputationColumnGroup>,
    pub input_data_frame: u64,
    pub table_aggregate: Option<ComputationTableAggregation>,
}

/// A task of the scheduler
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationTask {
    TableFiltering {
        table_id: u64,
        table_version: ComputationVersionValue,
        input_data_table: ComputationArrowTable,
        input_data_frame: u64,
        row_number_column_name: String,
        filters: Vec<ComputationScalarFilter>,
    },
    TableOrdering {
        table_id: u64,
        table_version: ComputationVersionValue,
        input_data_table: ComputationArrowTable,
        input_data_frame: u64,
        filter_table: Option<ComputationFilterTable>,
        data_search_table: Option<ComputationDataSearchTable>,
        row_number_column_name: String,
        ordering_constraints: Vec<ComputationOrderBy>,
    },
    TableAggregation {
        table_id: u64,
        table_version: ComputationVersionValue,
        column_entries: Vec<ComputationColumnGroup>,
        input_data_frame: u64,
    },
    SystemColumns {
        table_id: u64,
        table_version: ComputationVersionValue,
        column_entries: Vec<ComputationColumnGroup>,
        input_table: ComputationArrowTable,
        input_data_frame: u64,
        row_number_field_name: String,
        table_aggregate: Option<ComputationTableAggregation>,
    },
    ColumnAggregation(ComputationColumnTask),
    FilteredColumnAggregation {
        #[serde(flatten)]
        column: ComputationColumnTask,
        filter_table: Option<ComputationFilterTable>,
        data_search_table: Option<ComputationDataSearchTable>,
        selection_row_count: u64,
        unfiltered_aggregate: Option<ComputationColumnAggregate>,
    },
    DataSearch {
        table_id: u64,
        table_version: ComputationVersionValue,
        input_data_frame: u64,
        row_number_column_name: String,
        columns: Vec<ComputationDataSearchColumn>,
        pattern: String,
        request_id: u64,
    },
}

/// An update of the progress of a task, it sets what it has. Times in milliseconds since epoch.
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationProgressUpdate {
    #[serde(default)]
    #[tsify(optional, type = "TaskStatus | null")]
    pub status: Option<TaskStatus>,
    #[serde(default)]
    #[tsify(optional, type = "number | null")]
    pub started_at: Option<i64>,
    #[serde(default)]
    #[tsify(optional, type = "number | null")]
    pub completed_at: Option<i64>,
    #[serde(default)]
    #[tsify(optional, type = "number | null")]
    pub failed_at: Option<i64>,
    #[serde(default)]
    #[tsify(optional, type = "string | null")]
    pub failed_with_error: Option<String>,
}

impl From<ComputationProgressUpdate> for rt::TaskProgressUpdate {
    fn from(update: ComputationProgressUpdate) -> Self {
        rt::TaskProgressUpdate {
            status: update.status.map(Into::into),
            started_at: update.started_at,
            completed_at: update.completed_at,
            failed_at: update.failed_at,
            failed_with_error: update.failed_with_error,
        }
    }
}

/// The selection in the summary of a column
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationCrossFilter {
    Histogram { column: u32, selection: (f64, f64), filters: Vec<ComputationScalarFilter> },
    MostFrequent { column: u32, value_id: i64, filters: Vec<ComputationScalarFilter> },
}

pub(super) fn cross_filters(selections: Vec<ComputationCrossFilter>) -> CrossFilters {
    let mut filters = CrossFilters::new();
    let scalar = |filters: Vec<ComputationScalarFilter>| filters.into_iter().map(ScalarFilter::from).collect();
    for selection in selections {
        let (column, predicate) = match selection {
            ComputationCrossFilter::Histogram { column, selection, filters } => {
                (column, CrossFilterPredicate::Histogram { selection, filters: scalar(filters) })
            }
            ComputationCrossFilter::MostFrequent { column, value_id, filters } => {
                (column, CrossFilterPredicate::MostFrequent { value_id, filters: scalar(filters) })
            }
        };
        filters.column_filters.insert(column, predicate);
    }
    filters
}

/// What the host does after an action, in this order
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationEffect {
    /// Abort a handle, the lifetime of a computation that was dropped or replaced
    Abort { handle: u32, reason: String },
    /// Release a handle, an Arrow table or a lifetime that the state no longer holds
    Release { handle: u32 },
    /// Abort a data search that was superseded
    AbortDataSearch { table_id: u64, request_id: u64 },
    /// Nothing in the state holds the data frame anymore, the service drops its table through the host
    ReleaseDataFrame { data_frame: u64 },
}

impl From<&RuntimeEffect> for ComputationEffect {
    fn from(effect: &RuntimeEffect) -> Self {
        match *effect {
            RuntimeEffect::Abort { handle, reason } => Self::Abort { handle, reason: reason.to_string() },
            RuntimeEffect::Release { handle } => Self::Release { handle },
            RuntimeEffect::AbortDataSearch { table_id, request_id } => Self::AbortDataSearch { table_id, request_id },
            RuntimeEffect::ReleaseDataFrame { data_frame } => Self::ReleaseDataFrame { data_frame },
        }
    }
}

pub(super) fn effects(effects: &[RuntimeEffect]) -> Vec<ComputationEffect> {
    effects.iter().map(ComputationEffect::from).collect()
}

/// What an action did
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOutcome {
    /// Did the action change the state? A result that is dropped changes nothing.
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<ComputationEffect>,
    /// The id of a scheduled task, null if it was dropped
    pub task_id: Option<u64>,
}

impl From<RuntimeOutcome> for ComputationOutcome {
    fn from(outcome: RuntimeOutcome) -> Self {
        ComputationOutcome { changed: outcome.changed, effects: effects(&outcome.effects), task_id: outcome.task_id }
    }
}

/// The progress of a task, times in milliseconds since epoch
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTaskProgress {
    #[tsify(type = "TaskStatus")]
    pub status: TaskStatus,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub failed_at: Option<i64>,
    pub failed_with_error: Option<String>,
}

/// A task that a computation tracks, the latest of its kind
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTrackedTask {
    /// The task of the scheduler that the computation tracks
    pub task_id: u64,
    /// The version that the task computes for
    pub version: ComputationVersionValue,
    /// The ordering of an ordering task, cleared with the ordering of the table
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordering_constraints: Option<Vec<ComputationOrderBy>>,
    pub progress: ComputationTaskProgress,
}

fn tracked<T>(tracked: Option<&TrackedTask<T>>, version: impl Fn(&T) -> ComputationVersion) -> Option<ComputationTrackedTask> {
    tracked.map(|tracked| {
        let progress = &tracked.progress;
        ComputationTrackedTask {
            task_id: tracked.task_id,
            version: version(&tracked.task).into(),
            ordering_constraints: None,
            progress: ComputationTaskProgress {
                status: progress.status.into(),
                started_at: progress.started_at,
                completed_at: progress.completed_at,
                failed_at: progress.failed_at,
                failed_with_error: progress.failed_with_error.clone(),
            },
        }
    })
}

/// The search of a result, of its columns or of its data
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationSearchSnapshot {
    pub requested_pattern: String,
    pub applied_pattern: String,
    pub request_id: u64,
    pub applied_request_id: u64,
    pub matching_column_groups: Option<Vec<u32>>,
    /// Does the search hold matching rows? They are the rows of the last data search that the host handed over.
    pub has_matching_rows: bool,
    pub pending: bool,
    pub error: Option<String>,
}

impl From<&rt::ResultSearchState> for ComputationSearchSnapshot {
    fn from(search: &rt::ResultSearchState) -> Self {
        ComputationSearchSnapshot {
            requested_pattern: search.requested_pattern.clone(),
            applied_pattern: search.applied_pattern.clone(),
            request_id: search.request_id,
            applied_request_id: search.applied_request_id,
            matching_column_groups: search.matching_column_groups.clone(),
            // The host keeps the matching rows that it handed over, they don't cross again
            has_matching_rows: search.matching_rows.is_some(),
            pending: search.pending,
            error: search.error.clone(),
        }
    }
}

/// The rows that pass the filters of a snapshot, the table by its id
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationFilterTableSnapshot {
    pub table: u32,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub version: ComputationVersionValue,
}

/// The ordering of a snapshot, the table by its id
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOrderingTableSnapshot {
    pub table: u32,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub ordering_constraints: Vec<ComputationOrderBy>,
    pub version: ComputationVersionValue,
    pub data_search_request_id: Option<u64>,
}

/// The rows of a data search of a snapshot, the table by its id
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationDataSearchTableSnapshot {
    pub table: u32,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub version: ComputationVersionValue,
    pub request_id: u64,
}

/// The tasks that a computation tracks
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTasksSnapshot {
    pub table_aggregation: Option<ComputationTrackedTask>,
    pub system_columns: Option<ComputationTrackedTask>,
    pub filtering: Option<ComputationTrackedTask>,
    pub ordering: Option<ComputationTrackedTask>,
    pub data_search: Option<ComputationTrackedTask>,
    pub column_aggregation: Vec<Option<ComputationTrackedTask>>,
    pub filtered_column_aggregation: Vec<Option<ComputationTrackedTask>>,
}

/// The fields of a computation. The tables and the lifetime are handles of the host, the data frames ids of the
/// compute database.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationSnapshot {
    pub table_id: u64,
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    pub client_context: Option<String>,
    pub lifetime: u32,
    pub revision: u64,
    pub version: ComputationVersionValue,
    pub data_table: ComputationArrowTable,
    /// The fields of the table that the computation was created with, in order
    pub data_table_fields: Vec<String>,
    pub data_frame: Option<u64>,
    /// The column groups of the grid
    pub column_groups: Vec<ComputationColumnGroup>,
    pub data_table_ordering: Vec<ComputationOrderBy>,
    pub filter_table: Option<ComputationFilterTableSnapshot>,
    pub ordering_table: Option<ComputationOrderingTableSnapshot>,
    pub data_search_table: Option<ComputationDataSearchTableSnapshot>,
    pub column_search: ComputationSearchSnapshot,
    pub data_search: ComputationSearchSnapshot,
    pub row_number_column_group: Option<u64>,
    pub row_number_column_name: Option<String>,
    pub table_aggregation: Option<ComputationTableAggregation>,
    pub column_aggregates: Vec<Option<ComputationColumnAggregate>>,
    pub filtered_column_aggregates: Vec<Option<ComputationFilteredAggregate>>,
    pub filtered_column_aggregates_outdated: Vec<bool>,
    pub tasks: ComputationTasksSnapshot,
}

impl From<&TableComputation> for ComputationSnapshot {
    fn from(c: &TableComputation) -> Self {
        let tasks = &c.tasks;
        let mut ordering = tracked(tasks.ordering.as_ref(), |task| task.table_version);
        if let (Some(tracked), Some(view)) = (&tasks.ordering, &mut ordering) {
            view.ordering_constraints = Some(order_by(&tracked.task.ordering_constraints));
        }
        ComputationSnapshot {
            table_id: c.table_id,
            connection_id: c.connection_id.clone(),
            client_context: c.client_context.clone(),
            lifetime: c.lifetime,
            revision: c.revision(),
            version: c.version.into(),
            data_table: ComputationArrowTable { id: c.data_table.id, rows: Some(c.data_table.rows()) },
            data_table_fields: c.data_table_fields.clone(),
            data_frame: c.data_frame,
            column_groups: c.column_groups.iter().map(ComputationColumnGroup::from).collect(),
            data_table_ordering: order_by(&c.data_table_ordering),
            filter_table: c.filter_table.as_ref().map(|t| ComputationFilterTableSnapshot {
                table: t.table.id,
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                version: t.version.into(),
            }),
            ordering_table: c.ordering_table.as_ref().map(|t| ComputationOrderingTableSnapshot {
                table: t.table.id,
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                ordering_constraints: order_by(&t.ordering_constraints),
                version: t.version.into(),
                data_search_request_id: t.data_search_request_id,
            }),
            data_search_table: c.data_search_table.as_ref().map(|t| ComputationDataSearchTableSnapshot {
                table: t.table.id,
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                version: t.version.into(),
                request_id: t.request_id,
            }),
            column_search: (&c.column_search).into(),
            data_search: (&c.data_search).into(),
            row_number_column_group: c.row_number_column_group.map(|group| group as u64),
            row_number_column_name: c.row_number_column_name.clone(),
            table_aggregation: c.table_aggregation.as_ref().map(|t| ComputationTableAggregation {
                table: t.table.id,
                data_frame: t.data_frame,
                count_star_field_name: t.count_star_field_name.clone(),
            }),
            column_aggregates: c.column_aggregates.iter().map(|a| a.as_ref().map(ComputationColumnAggregate::from)).collect(),
            filtered_column_aggregates: c
                .filtered_column_aggregates
                .iter()
                .map(|a| {
                    a.as_ref().map(|a| ComputationFilteredAggregate {
                        aggregate: (&a.aggregate).into(),
                        filter_version: a.filter_version.into(),
                        data_search_request_id: a.data_search_request_id,
                    })
                })
                .collect(),
            filtered_column_aggregates_outdated: c.filtered_column_aggregates_outdated.clone(),
            tasks: ComputationTasksSnapshot {
                table_aggregation: tracked(tasks.table_aggregation.as_ref(), |task| task.table_version),
                system_columns: tracked(tasks.system_columns.as_ref(), |task| task.table_version),
                filtering: tracked(tasks.filtering.as_ref(), |task| task.table_version),
                ordering,
                data_search: tracked(tasks.data_search.as_ref(), |task| task.table_version),
                column_aggregation: tasks.column_aggregation.iter().map(|t| tracked(t.as_ref(), |task| task.table_version)).collect(),
                filtered_column_aggregation: tasks
                    .filtered_column_aggregation
                    .iter()
                    .map(|t| tracked(t.as_ref(), |task| task.column.table_version))
                    .collect(),
            },
        }
    }
}

/// The context of a call of the compute host: the computation, the title of its task in the query history, the
/// connection and the client context of the computation, and the run that `cancel` aborts
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputeCallContext {
    pub table_id: u64,
    pub title: String,
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    pub client_context: Option<String>,
    pub run: u64,
}

/// A task of the scheduler: its table and the version it computes for
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationSchedulerTaskSnapshot {
    pub table_id: u64,
    pub version: ComputationVersionValue,
}
