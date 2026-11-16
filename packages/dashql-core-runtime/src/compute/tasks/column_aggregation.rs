//! The summary of a column: the histogram of an ordinal column with a bin of the nulls, the most frequent values of a
//! string column. A filtered summary counts the rows that the cross filters and the data search select.
//!
//! Ported from `packages/dashql/src/runtime/compute/tasks/column_aggregation.ts`.

use arrow_schema::Schema;
use dashql_core::error::{Error, Result};

use super::analysis::{analyze_ordinal_column, analyze_string_column, OrdinalColumnAnalysis, StringColumnAnalysis};
use super::columns::{field_type, is_integer_type, to_numeric_of};
use super::data_search::DATA_SEARCH_ROW_FIELD;
use super::result_table::ResultTable;
use super::sql::{AggregateFunction, GroupBy, GroupByAggregate, GroupByKey, GroupByKeyBinning, SqlFrame};
use super::{data_frame_table_name, read_data_frame_sql, TableStats, TaskQuery};
use crate::compute::types::{
    ColumnAggregationTask, ColumnGroup, ComputationVersion, DataFrameId, FilteredColumnAggregationTask,
    OrderByConstraint, OrdinalColumnGroup, StringColumnGroup,
};

/// The number of frequent values of a string column
pub const FREQUENT_VALUE_COUNT: u64 = 32;

/// The order of the bins of an ordinal column
fn bin_order() -> Vec<OrderByConstraint> {
    vec![OrderByConstraint { field: "bin".into(), ascending: Some(true), nulls_first: None }]
}

/// The order of the frequent values of a string column, most frequent first
fn frequent_value_order() -> Vec<OrderByConstraint> {
    vec![OrderByConstraint { field: "count".into(), ascending: Some(false), nulls_first: None }]
}

/// The column of a summary
#[derive(Clone, Debug, PartialEq)]
enum SummarizedColumn {
    Ordinal(OrdinalColumnGroup, arrow_schema::DataType),
    String(StringColumnGroup),
}

/// The query of the summary of a column
#[derive(Clone, Debug, PartialEq)]
pub struct ColumnAggregationPlan {
    /// The query
    pub query: TaskQuery,
    /// The column group
    pub column_id: u32,
    column: SummarizedColumn,
}

/// The query of the summary of a column over the selected rows
#[derive(Clone, Debug, PartialEq)]
pub struct FilteredColumnAggregationPlan {
    /// The query of the summary
    pub plan: ColumnAggregationPlan,
    /// The filter version of the selection
    pub filter_version: ComputationVersion,
    /// The data search of the selection
    pub data_search_request_id: Option<u64>,
    /// The rows of the selection
    pub selection_row_count: u64,
}

/// The summary of a column
#[derive(Clone, Debug, PartialEq)]
pub enum ColumnAggregateResult {
    /// The histogram of an ordinal column
    Ordinal {
        /// The column
        column: OrdinalColumnGroup,
        /// The data frame of the binned values
        data_frame: DataFrameId,
        /// The binned values ordered by bin, the bin of the nulls last
        binned_values: ResultTable,
        /// The analysis
        analysis: OrdinalColumnAnalysis,
    },
    /// The frequent values of a string column
    String {
        /// The column
        column: StringColumnGroup,
        /// The data frame of the frequent values
        data_frame: DataFrameId,
        /// The frequent values, most frequent first
        frequent_values: ResultTable,
        /// The analysis
        analysis: StringColumnAnalysis,
    },
}

impl ColumnAggregateResult {
    /// The data frame of the summary
    pub fn data_frame(&self) -> DataFrameId {
        match self {
            ColumnAggregateResult::Ordinal { data_frame, .. } | ColumnAggregateResult::String { data_frame, .. } => {
                *data_frame
            }
        }
    }
}

/// The summary of a column over the selected rows
#[derive(Clone, Debug, PartialEq)]
pub struct FilteredColumnAggregateResult {
    /// The summary
    pub aggregate: ColumnAggregateResult,
    /// The filter version that the summary was computed for
    pub filter_version: ComputationVersion,
    /// The data search that the summary was computed for
    pub data_search_request_id: Option<u64>,
}

/// The column of a summary, an error for a column without one
fn summarized_column(task: &ColumnAggregationTask, schema: &Schema) -> Result<SummarizedColumn> {
    match &task.column_entry {
        ColumnGroup::Ordinal(column) => {
            Ok(SummarizedColumn::Ordinal(column.clone(), field_type(schema, &column.input_field_name)?.clone()))
        }
        ColumnGroup::String(column) => Ok(SummarizedColumn::String(column.clone())),
        other => Err(Error::invalid_argument(format!("Column of type {} cannot be aggregated", other.type_name()))),
    }
}

/// The SQL of the summary of a column and the order of its rows, over the selected rows of a filtered task
fn build_column_aggregation_sql(
    task: &ColumnAggregationTask,
    column: &SummarizedColumn,
    filtered: Option<&FilteredColumnAggregationTask>,
) -> Result<(String, Vec<OrderByConstraint>)> {
    let mut frame = SqlFrame::from(data_frame_table_name(task.input_data_frame));
    if let Some(filtered) = filtered {
        // The filter holds the row numbers of the selected rows, the data search their row_idx
        if let Some(filter) = &filtered.filter_table {
            frame = frame.semi_join_filter(
                filter.input_row_number_column_name.clone(),
                data_frame_table_name(filter.data_frame),
                filter.input_row_number_column_name.clone(),
            );
        }
        if let Some(search) = &filtered.data_search_table {
            frame = frame.semi_join_filter(
                search.input_row_number_column_name.clone(),
                data_frame_table_name(search.data_frame),
                DATA_SEARCH_ROW_FIELD,
            );
        }
    }
    match column {
        SummarizedColumn::Ordinal(column, data_type) => {
            let stats = column.stats_fields.as_ref();
            let (Some(min), Some(max)) = (
                stats.and_then(|stats| stats.min_aggregate_field_name.clone()),
                stats.and_then(|stats| stats.max_aggregate_field_name.clone()),
            ) else {
                return Err(Error::invalid_argument("Column summary requires precomputed table summary"));
            };
            let key = GroupByKey {
                field_name: column.input_field_name.clone(),
                output_alias: "bin".into(),
                binning: Some(GroupByKeyBinning {
                    pre_binned_field_name: column.bin_field_name.clone(),
                    bin_count: column.bin_count,
                    min_bin_width: is_integer_type(data_type).then_some(1.0),
                    stats_table: data_frame_table_name(task.table_aggregate.data_frame),
                    stats_min_field: min,
                    stats_max_field: max,
                    output_bin_lb_alias: "binLowerBound".into(),
                    output_bin_ub_alias: "binUpperBound".into(),
                    output_bin_width_alias: "binWidth".into(),
                    include_null_bin: true,
                    to_numeric: to_numeric_of(data_type),
                }),
            };
            let aggregates = vec![GroupByAggregate::new(AggregateFunction::CountStar, "count")];
            Ok((frame.group_by(GroupBy { keys: vec![key], aggregates }).to_sql(), bin_order()))
        }
        SummarizedColumn::String(column) => {
            if column.stats_fields.is_none() {
                return Err(Error::invalid_argument("Column summary requires precomputed table summary"));
            }
            let Some(value_id) = &column.value_id_field_name else {
                return Err(Error::invalid_argument("Cannot aggregate string column without precomputed value id"));
            };
            let keys = vec![
                GroupByKey::new(column.input_field_name.clone(), "key"),
                GroupByKey::new(value_id.clone(), "keyId"),
            ];
            let aggregates = vec![GroupByAggregate::new(AggregateFunction::CountStar, "count")];
            let sql = frame
                .group_by(GroupBy { keys, aggregates })
                .order_by(frequent_value_order(), Some(FREQUENT_VALUE_COUNT))
                .to_sql();
            Ok((sql, frequent_value_order()))
        }
    }
}

/// Plan the summary of a column into a new data frame. The schema is the one of the table.
pub fn plan_column_aggregation(
    task: &ColumnAggregationTask,
    schema: &Schema,
    output: DataFrameId,
) -> Result<ColumnAggregationPlan> {
    let column = summarized_column(task, schema)?;
    let (sql, order) = build_column_aggregation_sql(task, &column, None)?;
    let read = read_data_frame_sql(output, Some(order), None);
    let query = TaskQuery::new("Column aggregation", "Computing column aggregate failed", output, sql, read);
    Ok(ColumnAggregationPlan { query, column_id: task.column_id, column })
}

/// Plan the summary of a column over the selected rows into a new data frame. The schema is the one of the table.
pub fn plan_filtered_column_aggregation(
    task: &FilteredColumnAggregationTask,
    schema: &Schema,
    output: DataFrameId,
) -> Result<FilteredColumnAggregationPlan> {
    let column = summarized_column(&task.column, schema)?;
    let (sql, order) = build_column_aggregation_sql(&task.column, &column, Some(task))?;
    let read = read_data_frame_sql(output, Some(order), None);
    let query =
        TaskQuery::new("Filtered column aggregation", "Failed to compute filtered column aggregate", output, sql, read);
    Ok(FilteredColumnAggregationPlan {
        plan: ColumnAggregationPlan { query, column_id: task.column.column_id, column },
        filter_version: task.column.table_version,
        data_search_request_id: task.data_search_table.as_ref().map(|search| search.request_id),
        selection_row_count: task.selection_row_count,
    })
}

impl ColumnAggregationPlan {
    fn analyze(self, stats: &TableStats, result: ResultTable, selection: Option<i64>) -> Result<ColumnAggregateResult> {
        let data_frame = self.query.data_frame;
        let query = self.query;
        match self.column {
            SummarizedColumn::Ordinal(column, data_type) => {
                let analysis = analyze_ordinal_column(stats, &column, &data_type, &result, selection)
                    .map_err(|e| query.failed(e))?;
                Ok(ColumnAggregateResult::Ordinal { column, data_frame, binned_values: result, analysis })
            }
            SummarizedColumn::String(column) => {
                let analysis =
                    analyze_string_column(stats, &column, &result, selection).map_err(|e| query.failed(e))?;
                Ok(ColumnAggregateResult::String { column, data_frame, frequent_values: result, analysis })
            }
        }
    }

    /// Read the summary, with the statistics of the table
    pub fn finish(self, stats: &TableStats, result: ResultTable) -> Result<ColumnAggregateResult> {
        self.analyze(stats, result, None)
    }
}

impl FilteredColumnAggregationPlan {
    /// Read the summary over the selected rows, with the statistics of the table
    pub fn finish(self, stats: &TableStats, result: ResultTable) -> Result<FilteredColumnAggregateResult> {
        let selection = i64::try_from(self.selection_row_count).unwrap_or(i64::MAX);
        Ok(FilteredColumnAggregateResult {
            aggregate: self.plan.analyze(stats, result, Some(selection))?,
            filter_version: self.filter_version,
            data_search_request_id: self.data_search_request_id,
        })
    }
}
