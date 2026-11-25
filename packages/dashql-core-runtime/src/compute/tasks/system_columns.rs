//! The system columns of a table: the fractional bin of every ordinal value and the id of every string value, next to
//! the row numbers. The filters and the summaries over the selected rows use them.

use std::collections::HashSet;

use arrow_schema::Schema;
use dashql_core::error::{Error, Result};

use super::columns::{create_unique_column_name, field_type, is_integer_type, to_numeric_of};
use super::sql::{Binning, SqlFrame};
use super::{ascending, data_frame_table_name, read_data_frame_sql, TaskQuery};
use crate::compute::types::{ColumnGroup, DataFrameId, RowNumberColumnGroup, SystemColumnsTask};

/// The query of the system columns with the column groups that name them
#[derive(Clone, Debug, PartialEq)]
pub struct SystemColumnsPlan {
    /// The query
    pub query: TaskQuery,
    /// The column groups: the row numbers first, then the columns with their bin and value id fields
    pub column_groups: Vec<ColumnGroup>,
}

/// The table with the system columns, in the order of the row numbers. The host keeps the table that the query read.
#[derive(Clone, Debug, PartialEq)]
pub struct SystemColumnsResult {
    /// The data frame with the system columns
    pub data_frame: DataFrameId,
    /// The column groups that use the system columns
    pub column_groups: Vec<ColumnGroup>,
}

/// Plan the system columns of a table into a new data frame. The schema is the one of the table.
pub fn plan_system_columns(
    task: &SystemColumnsTask,
    schema: &Schema,
    output: DataFrameId,
) -> Result<SystemColumnsPlan> {
    let mut field_names: HashSet<String> = schema.fields().iter().map(|field| field.name().clone()).collect();
    field_names.insert(task.row_number_field_name.clone());

    let mut column_groups = Vec::with_capacity(task.column_entries.len() + 1);
    column_groups.push(ColumnGroup::RowNumber(RowNumberColumnGroup {
        row_number_field_name: task.row_number_field_name.clone(),
    }));
    let stats_table = data_frame_table_name(task.table_aggregate.data_frame);
    let mut frame = SqlFrame::from(data_frame_table_name(task.input_data_frame));
    for (index, entry) in task.column_entries.iter().enumerate() {
        let i = index + 1;
        match entry {
            ColumnGroup::Ordinal(column) => {
                let stats = column.stats_fields.as_ref();
                let (Some(min), Some(max)) = (
                    stats.and_then(|stats| stats.min_aggregate_field_name.clone()),
                    stats.and_then(|stats| stats.max_aggregate_field_name.clone()),
                ) else {
                    return Err(Error::invalid_argument(format!(
                        "the column {} has no minimum and maximum",
                        column.input_field_name
                    )));
                };
                let data_type = field_type(schema, &column.input_field_name)?;
                let bin_field_name = create_unique_column_name(&format!("_{i}_bin"), &mut field_names);
                frame = frame.binning(Binning {
                    field_name: column.input_field_name.clone(),
                    stats_table: stats_table.clone(),
                    stats_min_field: min,
                    stats_max_field: max,
                    bin_count: column.bin_count,
                    min_bin_width: is_integer_type(data_type).then_some(1.0),
                    output_alias: bin_field_name.clone(),
                    to_numeric: to_numeric_of(data_type),
                });
                let mut column = column.clone();
                column.bin_field_name = Some(bin_field_name);
                column_groups.push(ColumnGroup::Ordinal(column));
            }
            ColumnGroup::String(column) => {
                let value_field_name = create_unique_column_name(&format!("_{i}_id"), &mut field_names);
                frame = frame.value_identifier(column.input_field_name.clone(), value_field_name.clone());
                let mut column = column.clone();
                column.value_id_field_name = Some(value_field_name);
                column_groups.push(ColumnGroup::String(column));
            }
            // No value ids of lists: numbering embeddings groups and sorts the table by full vectors at high cost, and
            // nothing reads the ids
            ColumnGroup::List(_) | ColumnGroup::Skipped(_) | ColumnGroup::RowNumber(_) => {
                column_groups.push(entry.clone())
            }
        }
    }
    let read = read_data_frame_sql(output, Some(vec![ascending(&task.row_number_field_name)]), None);
    let (title, failure) = ("System column computation", "Failed to precompute column");
    let query = TaskQuery::new(title, failure, output, frame.to_sql(), read);
    Ok(SystemColumnsPlan { query, column_groups })
}

impl SystemColumnsPlan {
    /// The table with the system columns, the host keeps its rows
    pub fn finish(self) -> SystemColumnsResult {
        SystemColumnsResult { data_frame: self.query.data_frame, column_groups: self.column_groups }
    }
}
