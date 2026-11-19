//! The computation slice of the runtime: its view, its actions and the context of the calls of the compute platform,
//! as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts` (`tsify`). See
//! docs/design/dashql_core.md.
//!
//! The view keeps the field names that the app reads (`tableId`, `dataTable`, `columnGroups`, `filterTable`, ...).
//! It names the Arrow tables by their handles of the platform and the data frames by their ids. Ids, handles,
//! revisions and times are numbers, a missing value is null. The status of a task is the numeric enum `TaskStatus`.

use dashql_core_runtime::compute::cross_filters::CrossFilterPredicate;
use dashql_core_runtime::compute::tasks::analysis::BinBounds;
use dashql_core_runtime::compute::types::{
    self as rt, ColumnStatsFields, ColumnSummaryAnalysis, ComputationVersion, FilterOp, OrderByConstraint, ScalarFilter, TrackedTask,
};
use dashql_core_runtime::compute::{SearchKind, TableComputation};
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
    TASK_CANCELLED = 4,
}

impl From<rt::TaskStatus> for TaskStatus {
    fn from(status: rt::TaskStatus) -> Self {
        match status {
            rt::TaskStatus::Running => TaskStatus::TASK_RUNNING,
            rt::TaskStatus::Succeeded => TaskStatus::TASK_SUCCEEDED,
            rt::TaskStatus::Failed => TaskStatus::TASK_FAILED,
            rt::TaskStatus::Cancelled => TaskStatus::TASK_CANCELLED,
        }
    }
}

/// The version of a computation: the data changes with a new data frame, the filter with every scheduled filtering
#[derive(Clone, Copy, Debug, Default, Serialize, Tsify)]
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

/// The fields of the table aggregation with the statistics of a column
#[derive(Clone, Debug, Serialize, Tsify)]
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

/// The value column of a column group, ordinal, string or list
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationValueColumn {
    pub input_field_name: String,
    /// The type of the field as the runtime names it, the app reads the Arrow type from the schema of the table
    pub input_field_type: String,
    pub input_field_nullable: bool,
    pub stats_fields: Option<ComputationStatsFields>,
    /// The bins of an ordinal column, null without
    pub bin_field_name: Option<String>,
    /// The number of bins of an ordinal column, 0 without
    pub bin_count: u32,
    /// The value ids of a string or a list column, null without
    pub value_id_field_name: Option<String>,
}

/// A column of the grid of a result
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
#[tsify(missing_as_null)]
pub enum ComputationColumnGroup {
    #[serde(rename = "ROWNUMBER", rename_all = "camelCase")]
    RowNumber { row_number_field_name: String },
    #[serde(rename_all = "camelCase")]
    Skipped { input_field_name: String, input_field_type: String, input_field_nullable: bool },
    Ordinal(ComputationValueColumn),
    String(ComputationValueColumn),
    List(ComputationValueColumn),
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
            rt::ColumnGroup::Ordinal(g) => Self::Ordinal(ComputationValueColumn {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                bin_field_name: g.bin_field_name.clone(),
                bin_count: g.bin_count,
                value_id_field_name: None,
            }),
            rt::ColumnGroup::String(g) => Self::String(ComputationValueColumn {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                bin_field_name: None,
                bin_count: 0,
                value_id_field_name: g.value_id_field_name.clone(),
            }),
            rt::ColumnGroup::List(g) => Self::List(ComputationValueColumn {
                input_field_name: g.input_field_name.clone(),
                input_field_type: g.input_field_type.clone(),
                input_field_nullable: g.input_field_nullable,
                stats_fields: stats(&g.stats_fields),
                bin_field_name: None,
                bin_count: 0,
                value_id_field_name: g.value_id_field_name.clone(),
            }),
        }
    }
}

/// The comparison of a scalar filter
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
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
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationScalarFilter {
    pub field_name: String,
    pub op: ComputationFilterOp,
    pub value: f64,
}

impl From<&ScalarFilter> for ComputationScalarFilter {
    fn from(filter: &ScalarFilter) -> Self {
        let op = match filter.op {
            FilterOp::Equal => ComputationFilterOp::Equal,
            FilterOp::Less => ComputationFilterOp::Less,
            FilterOp::LessEqual => ComputationFilterOp::LessEqual,
            FilterOp::Greater => ComputationFilterOp::Greater,
            FilterOp::GreaterEqual => ComputationFilterOp::GreaterEqual,
        };
        ComputationScalarFilter { field_name: filter.field_name.clone(), op, value: filter.value }
    }
}

/// A key of an ordering, ascending and nulls last without
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOrderBy {
    pub field: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub ascending: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
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

fn order_by(constraints: &[OrderByConstraint]) -> Vec<ComputationOrderBy> {
    constraints.iter().map(ComputationOrderBy::from).collect()
}

/// The selection in the summary of a column group
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationCrossFilter {
    /// A range of bins of a histogram, the first and the last bin
    Histogram { column: u32, selection: (f64, f64) },
    /// A frequent value by its id
    MostFrequent { column: u32, value_id: i64 },
}

/// The statistics of all columns of a table, the table by its handle
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTableAggregation {
    pub table: u32,
    pub data_frame: u64,
    pub count_star_field_name: String,
}

/// The numbers of the analysis of a summary that the runtime computed. The app formats the values of the tables: the
/// minimum and the maximum of the statistics, the lower bounds of the bins and the frequent values.
#[derive(Clone, Debug, Serialize, Tsify)]
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
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
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

/// The summary of a column: the table of the binned or the frequent values by its handle, with its analysis
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum ComputationColumnAggregate {
    Ordinal(ComputationColumnSummary),
    String(ComputationColumnSummary),
    List(ComputationColumnSummary),
    Skipped,
}

/// The table and the data frame of a summary
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationColumnSummary {
    pub table: u32,
    pub data_frame: u64,
    pub analysis: Option<ComputationSummaryAnalysis>,
}

impl From<&rt::ColumnAggregate> for ComputationColumnAggregate {
    fn from(aggregate: &rt::ColumnAggregate) -> Self {
        let summary = |s: &rt::ColumnSummary| ComputationColumnSummary {
            table: s.table.id,
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
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationFilteredAggregate {
    pub aggregate: ComputationColumnAggregate,
    pub filter_version: ComputationVersionValue,
    pub data_search_request_id: Option<u64>,
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
    /// The task of the scheduler
    pub task_id: u64,
    /// The version that the task computes for
    pub table_version: ComputationVersionValue,
    /// The filters of a filtering
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub filters: Option<Vec<ComputationScalarFilter>>,
    /// The ordering of an ordering, cleared with the ordering of the table
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub ordering_constraints: Option<Vec<ComputationOrderBy>>,
    pub progress: ComputationTaskProgress,
}

fn tracked<T>(tracked: Option<&TrackedTask<T>>, version: impl Fn(&T) -> ComputationVersion) -> Option<ComputationTrackedTask> {
    tracked.map(|tracked| {
        let progress = &tracked.progress;
        ComputationTrackedTask {
            task_id: tracked.task_id,
            table_version: version(&tracked.task).into(),
            filters: None,
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
pub struct ComputationSearch {
    pub requested_pattern: String,
    pub applied_pattern: String,
    pub request_id: u64,
    pub applied_request_id: u64,
    pub matching_column_groups: Option<Vec<u32>>,
    /// Does the search hold matching rows? They are the rows of the table of the data search.
    pub has_matching_rows: bool,
    pub pending: bool,
    pub error: Option<String>,
}

impl From<&rt::ResultSearchState> for ComputationSearch {
    fn from(search: &rt::ResultSearchState) -> Self {
        ComputationSearch {
            requested_pattern: search.requested_pattern.clone(),
            applied_pattern: search.applied_pattern.clone(),
            request_id: search.request_id,
            applied_request_id: search.applied_request_id,
            matching_column_groups: search.matching_column_groups.clone(),
            has_matching_rows: search.matching_rows.is_some(),
            pending: search.pending,
            error: search.error.clone(),
        }
    }
}

/// The rows that pass the filters, the table by its handle
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationFilterTable {
    pub data_table: u32,
    pub rows: u64,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub version: ComputationVersionValue,
}

/// The row numbers in the order of the grid, the table by its handle
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationOrderingTable {
    pub data_table: u32,
    pub rows: u64,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub ordering_constraints: Vec<ComputationOrderBy>,
    pub version: ComputationVersionValue,
    pub data_search_request_id: Option<u64>,
}

/// The rows that a data search matched with their matching columns, the table by its handle
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationDataSearchTable {
    pub data_table: u32,
    pub rows: u64,
    pub data_frame: u64,
    pub input_row_number_column_name: String,
    pub version: ComputationVersionValue,
    pub request_id: u64,
}

/// The tasks that a computation tracks
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationTasks {
    pub table_aggregation_task: Option<ComputationTrackedTask>,
    pub system_column_task: Option<ComputationTrackedTask>,
    pub filtering_task: Option<ComputationTrackedTask>,
    pub ordering_task: Option<ComputationTrackedTask>,
    pub data_search_task: Option<ComputationTrackedTask>,
    pub column_aggregation_tasks: Vec<Option<ComputationTrackedTask>>,
    pub filtered_column_aggregation_tasks: Vec<Option<ComputationTrackedTask>>,
}

/// The view of the computation of a result table. The tables are handles of the platform, the data frames ids of
/// the compute database.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ComputationView {
    pub table_id: u64,
    pub revision: u64,
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    pub client_context: Option<String>,
    pub tasks: ComputationTasks,
    pub version: ComputationVersionValue,
    /// The table, with the system columns once they are computed
    pub data_table: u32,
    pub data_table_rows: u64,
    /// The fields of the table that the computation was created with, in order
    pub data_table_fields: Vec<String>,
    pub data_frame: Option<u64>,
    /// The column groups of the grid
    pub column_groups: Vec<ComputationColumnGroup>,
    pub data_table_ordering: Vec<ComputationOrderBy>,
    /// The selections in the summaries of the column groups, in the order of the column groups
    pub cross_filters: Vec<ComputationCrossFilter>,
    pub filter_table: Option<ComputationFilterTable>,
    pub ordering_table: Option<ComputationOrderingTable>,
    pub column_search: ComputationSearch,
    pub data_search: ComputationSearch,
    pub data_search_table: Option<ComputationDataSearchTable>,
    pub row_number_column_group: Option<u64>,
    pub row_number_column_name: Option<String>,
    pub table_aggregation: Option<ComputationTableAggregation>,
    pub column_aggregates: Vec<Option<ComputationColumnAggregate>>,
    pub filtered_column_aggregates: Vec<Option<ComputationFilteredAggregate>>,
    pub filtered_column_aggregates_outdated: Vec<bool>,
}

impl From<&TableComputation> for ComputationView {
    fn from(c: &TableComputation) -> Self {
        let tasks = &c.tasks;
        let mut filtering = tracked(tasks.filtering.as_ref(), |task| task.table_version);
        if let (Some(tracked), Some(view)) = (&tasks.filtering, &mut filtering) {
            view.filters = Some(tracked.task.filters.iter().map(ComputationScalarFilter::from).collect());
        }
        let mut ordering = tracked(tasks.ordering.as_ref(), |task| task.table_version);
        if let (Some(tracked), Some(view)) = (&tasks.ordering, &mut ordering) {
            view.ordering_constraints = Some(order_by(&tracked.task.ordering_constraints));
        }
        let cross_filters = c
            .cross_filters
            .column_filters
            .iter()
            .map(|(column, predicate)| match predicate {
                CrossFilterPredicate::Histogram { selection, .. } => ComputationCrossFilter::Histogram { column: *column, selection: *selection },
                CrossFilterPredicate::MostFrequent { value_id, .. } => {
                    ComputationCrossFilter::MostFrequent { column: *column, value_id: *value_id }
                }
            })
            .collect();
        ComputationView {
            table_id: c.table_id,
            revision: c.revision(),
            connection_id: c.connection_id.clone(),
            client_context: c.client_context.clone(),
            tasks: ComputationTasks {
                table_aggregation_task: tracked(tasks.table_aggregation.as_ref(), |task| task.table_version),
                system_column_task: tracked(tasks.system_columns.as_ref(), |task| task.table_version),
                filtering_task: filtering,
                ordering_task: ordering,
                data_search_task: tracked(tasks.data_search.as_ref(), |task| task.table_version),
                column_aggregation_tasks: tasks.column_aggregation.iter().map(|t| tracked(t.as_ref(), |task| task.table_version)).collect(),
                filtered_column_aggregation_tasks: tasks
                    .filtered_column_aggregation
                    .iter()
                    .map(|t| tracked(t.as_ref(), |task| task.column.table_version))
                    .collect(),
            },
            version: c.version.into(),
            data_table: c.data_table.id,
            data_table_rows: c.data_table.rows(),
            data_table_fields: c.data_table_fields.clone(),
            data_frame: c.data_frame,
            column_groups: c.column_groups.iter().map(ComputationColumnGroup::from).collect(),
            data_table_ordering: order_by(&c.data_table_ordering),
            cross_filters,
            filter_table: c.filter_table.as_ref().map(|t| ComputationFilterTable {
                data_table: t.table.id,
                rows: t.table.rows(),
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                version: t.version.into(),
            }),
            ordering_table: c.ordering_table.as_ref().map(|t| ComputationOrderingTable {
                data_table: t.table.id,
                rows: t.table.rows(),
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                ordering_constraints: order_by(&t.ordering_constraints),
                version: t.version.into(),
                data_search_request_id: t.data_search_request_id,
            }),
            column_search: (&c.column_search).into(),
            data_search: (&c.data_search).into(),
            data_search_table: c.data_search_table.as_ref().map(|t| ComputationDataSearchTable {
                data_table: t.table.id,
                rows: t.table.rows(),
                data_frame: t.data_frame,
                input_row_number_column_name: t.input_row_number_column_name.clone(),
                version: t.version.into(),
                request_id: t.request_id,
            }),
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
        }
    }
}

/// The context of a call of the compute platform: the computation, the title of its task in the query history, the
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

/// What is searched, the columns by their names or the data
#[derive(Clone, Copy, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum ComputationSearchKind {
    Columns,
    Data,
}

impl From<ComputationSearchKind> for SearchKind {
    fn from(kind: ComputationSearchKind) -> Self {
        match kind {
            ComputationSearchKind::Columns => SearchKind::Columns,
            ComputationSearchKind::Data => SearchKind::Data,
        }
    }
}

/// The options of the analysis of a result
#[derive(Clone, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct AnalyzeTableOptions {
    /// The connection that ran the query of the result, its query history lists the queries of the computation
    #[serde(default)]
    #[tsify(optional)]
    pub connection_id: Option<String>,
    /// The client context of the queries of a computation without a connection, opaque JSON
    #[serde(default)]
    #[tsify(optional)]
    pub client_context: Option<String>,
    /// Compute the summaries of the columns, true without
    #[serde(default)]
    #[tsify(optional)]
    pub column_aggregates: Option<bool>,
    /// Order the rows before the analysis settles, e.g. like a result that the result replaces. An ordering of fields
    /// that the result doesn't have is skipped.
    #[serde(default)]
    #[tsify(optional)]
    pub ordering: Option<Vec<ComputationOrderBy>>,
}
