//! The statistics of all columns of a table: the row count, the counts, minimum and maximum of the ordinal columns
//! and the counts and distinct counts of the string columns. A column of integers with a small domain gets one bin
//! per value.
//!
//! Ported from `packages/dashql/src/runtime/compute/tasks/table_aggregation.ts`.

use arrow_schema::Schema;
use dashql_core::error::Result;

use super::columns::{field_type, is_integer_type, small_integer_domain_size};
use super::result_table::ResultTable;
use super::sql::{AggregateFunction, GroupBy, GroupByAggregate, SqlFrame};
use super::{data_frame_table_name, read_data_frame_sql, TableStats, TaskQuery};
use crate::compute::types::{ColumnGroup, ColumnStatsFields, DataFrameId, TableAggregationTask};

/// The field of the row count
pub const COUNT_STAR_FIELD: &str = "_count";

/// The query of the statistics with the column groups that name their fields
#[derive(Clone, Debug, PartialEq)]
pub struct TableAggregationPlan {
    /// The query
    pub query: TaskQuery,
    /// The column groups with the fields of their statistics
    pub column_groups: Vec<ColumnGroup>,
}

/// The statistics of a table
#[derive(Clone, Debug, PartialEq)]
pub struct TableAggregationResult {
    /// The statistics
    pub stats: TableStats,
    /// The column groups with the fields of their statistics and the bins of small integer domains
    pub column_groups: Vec<ColumnGroup>,
}

/// Plan the statistics of a table into a new data frame
pub fn plan_table_aggregation(task: &TableAggregationTask, output: DataFrameId) -> TableAggregationPlan {
    let mut aggregates = vec![GroupByAggregate::new(AggregateFunction::CountStar, COUNT_STAR_FIELD)];
    let mut column_groups = Vec::with_capacity(task.column_entries.len());
    for (i, entry) in task.column_entries.iter().enumerate() {
        match entry {
            ColumnGroup::Ordinal(column) => {
                let count = format!("_{i}_count");
                let min = format!("_{i}_min");
                let max = format!("_{i}_max");
                let field = &column.input_field_name;
                aggregates.push(GroupByAggregate::new(AggregateFunction::Count(field.clone()), count.clone()));
                aggregates.push(GroupByAggregate::new(AggregateFunction::Min(field.clone()), min.clone()));
                aggregates.push(GroupByAggregate::new(AggregateFunction::Max(field.clone()), max.clone()));
                let mut column = column.clone();
                column.stats_fields = Some(ColumnStatsFields {
                    count_field_name: count,
                    distinct_count_field_name: None,
                    min_aggregate_field_name: Some(min),
                    max_aggregate_field_name: Some(max),
                });
                column_groups.push(ColumnGroup::Ordinal(column));
            }
            ColumnGroup::String(column) => {
                let count = format!("_{i}_count");
                let distinct = format!("_{i}_countd");
                let field = &column.input_field_name;
                aggregates.push(GroupByAggregate::new(AggregateFunction::Count(field.clone()), count.clone()));
                let count_distinct = AggregateFunction::CountDistinct(field.clone());
                aggregates.push(GroupByAggregate::new(count_distinct, distinct.clone()));
                let mut column = column.clone();
                column.stats_fields = Some(ColumnStatsFields {
                    count_field_name: count,
                    distinct_count_field_name: Some(distinct),
                    min_aggregate_field_name: None,
                    max_aggregate_field_name: None,
                });
                column_groups.push(ColumnGroup::String(column));
            }
            // No statistics of lists: a distinct count hashes every full vector of an embedding at high cost, and
            // no summary reads it
            ColumnGroup::List(_) | ColumnGroup::Skipped(_) | ColumnGroup::RowNumber(_) => {
                column_groups.push(entry.clone())
            }
        }
    }
    let sql = SqlFrame::from(data_frame_table_name(task.input_data_frame))
        .group_by(GroupBy { keys: Vec::new(), aggregates })
        .to_sql();
    let read = read_data_frame_sql(output, None, None);
    let query = TaskQuery::new("Table aggregation", "computing aggregate failed", output, sql, read);
    TableAggregationPlan { query, column_groups }
}

impl TableAggregationPlan {
    /// Read the statistics. The schema is the one of the table, it holds the types of the columns.
    pub fn finish(self, schema: &Schema, result: ResultTable) -> Result<TableAggregationResult> {
        let query = &self.query;
        let stats = TableStats::read(query.data_frame, &result, COUNT_STAR_FIELD).map_err(|e| query.failed(e))?;
        let mut column_groups = self.column_groups.clone();
        for group in column_groups.iter_mut() {
            let ColumnGroup::Ordinal(column) = group else {
                continue;
            };
            if !is_integer_type(field_type(schema, &column.input_field_name).map_err(|e| query.failed(e))?) {
                continue;
            }
            let Some(fields) = &column.stats_fields else {
                continue;
            };
            let integer = |field: &Option<String>| -> Result<Option<i128>> {
                let Some(field) = field.as_deref() else {
                    return Ok(None);
                };
                stats.integer(field)
            };
            let min = integer(&fields.min_aggregate_field_name).map_err(|e| query.failed(e))?;
            let max = integer(&fields.max_aggregate_field_name).map_err(|e| query.failed(e))?;
            if let Some(size) = small_integer_domain_size(min, max, column.bin_count) {
                column.bin_count = size;
            }
        }
        Ok(TableAggregationResult { stats, column_groups })
    }
}
