//! The analysis of a result for the grid, in steps:
//!
//! 1. The column groups of the result, and the result with row numbers imported as the first data frame
//!    (`start_table_analysis`). The host numbers the rows of its table, the analysis reads only the schema. The computation starts with the column groups, the data frame moves its data version.
//! 2. The statistics of the table (`table_aggregation_task`): counts, minimum, maximum and distinct counts.
//! 3. The system columns (`system_columns_task`): the row numbers, the bins and the value ids.
//! 4. The summary of every ordinal and string column (`column_aggregation_tasks`), e.g. a histogram.
//!
//! Each task is scheduled with the state and runs with its plan; the host runs the queries in between. A result
//! without columns, e.g. of DDL, has nothing to summarize and the compute database can't import it.
//!
//! The cross filters recompute the summaries over the selected rows on the bins and value ids, for what the grid
//! shows: the bins are few since the grid shows them. Precomputed sums over the cube of all dimensions (Falcon,
//! https://osf.io/preprints/osf/szpqm_v1) would make a brush a lookup, but grow with 2^N for N columns and don't cover
//! the selection of one of many distinct values.
//!
//! Ported from `packages/dashql/src/runtime/compute/analyze_table.ts`.

use std::collections::HashSet;

use arrow_schema::Schema;

use super::columns::{build_column_groups, create_unique_column_name};
use super::{data_frame_table_name, TableImport};
use crate::compute::types::{
    ArrowTable, ColumnAggregationTask, ColumnGroup, ComputationVersion, DataFrameId, SystemColumnsTask,
    TableAggregation, TableAggregationTask, TableId,
};

/// The name of the row numbers, a prefix of underscores keeps it apart from the fields of the result
pub const ROW_NUMBER_FIELD_PREFIX: &str = "_rownum";

/// The options of the analysis of a table
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AnalyzeTableOptions {
    /// Compute the summaries of the columns, false for a table that shows no column plots
    pub column_aggregates: bool,
}

impl Default for AnalyzeTableOptions {
    fn default() -> Self {
        Self { column_aggregates: true }
    }
}

/// The start of the analysis of a result
#[derive(Clone, Debug, PartialEq)]
pub struct TableAnalysisStart {
    /// The fields of the result in order
    pub fields: Vec<String>,
    /// The column groups of the result
    pub column_groups: Vec<ColumnGroup>,
    /// The field with the row numbers, from 1
    pub row_number_field_name: String,
    /// The import of the result with the row numbers as the first data frame
    pub import: TableImport,
}

/// The name of the row numbers that the import appends to a result, unique among its fields. The row numbers are
/// appended before the import since Hyper numbers the rows of `row_number() OVER ()` in no particular order.
pub fn row_number_field_name(schema: &Schema) -> String {
    let mut names: HashSet<String> = schema.fields().iter().map(|field| field.name().clone()).collect();
    create_unique_column_name(ROW_NUMBER_FIELD_PREFIX, &mut names)
}

/// Start the analysis of a result with the data frame of its import, none for a result without columns
pub fn start_table_analysis(schema: &Schema, input: DataFrameId) -> Option<TableAnalysisStart> {
    if schema.fields().is_empty() {
        return None;
    }
    let row_number_field_name = row_number_field_name(schema);
    Some(TableAnalysisStart {
        fields: schema.fields().iter().map(|field| field.name().clone()).collect(),
        column_groups: build_column_groups(schema),
        row_number_field_name,
        import: TableImport { data_frame: input, table_name: data_frame_table_name(input) },
    })
}

/// The statistics of a table, of its first data frame
pub fn table_aggregation_task(
    table_id: TableId,
    column_groups: Vec<ColumnGroup>,
    input: DataFrameId,
) -> TableAggregationTask {
    TableAggregationTask {
        table_id,
        table_version: ComputationVersion::default(),
        column_entries: column_groups,
        input_data_frame: input,
    }
}

/// The system columns of a table, with the column groups of its statistics
pub fn system_columns_task(
    table_id: TableId,
    column_groups: Vec<ColumnGroup>,
    input_table: ArrowTable,
    input: DataFrameId,
    row_number_field_name: String,
    table_aggregate: TableAggregation,
) -> SystemColumnsTask {
    SystemColumnsTask {
        table_id,
        table_version: ComputationVersion::default(),
        column_entries: column_groups,
        input_table,
        input_data_frame: input,
        row_number_field_name,
        table_aggregate,
    }
}

/// The summaries of the ordinal and string columns, over the data frame with the system columns. Lists aren't
/// summarized: their value ids, frequent values and distinct counts hash or sort full vectors of embeddings at high
/// cost and no summary shows them.
pub fn column_aggregation_tasks(
    table_id: TableId,
    column_groups: &[ColumnGroup],
    data_frame: DataFrameId,
    table_aggregate: &TableAggregation,
    options: AnalyzeTableOptions,
) -> Vec<ColumnAggregationTask> {
    if !options.column_aggregates {
        return Vec::new();
    }
    column_groups
        .iter()
        .enumerate()
        .filter(|(_, group)| matches!(group, ColumnGroup::Ordinal(_) | ColumnGroup::String(_)))
        .map(|(column_id, group)| ColumnAggregationTask {
            table_id,
            table_version: ComputationVersion::default(),
            column_id: column_id as u32,
            column_entry: group.clone(),
            input_data_frame: data_frame,
            table_aggregate: table_aggregate.clone(),
        })
        .collect()
}
