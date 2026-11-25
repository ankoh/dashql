//! The rows of a table that pass the filters of the cross filters, as row numbers in the order of the table.

use super::sql::SqlFrame;
use super::{ascending, data_frame_table_name, read_data_frame_sql, TaskQuery};
use crate::compute::types::{ComputationVersion, DataFrameId, TableFilteringTask};

/// The query of a filter
#[derive(Clone, Debug, PartialEq)]
pub struct TableFilteringPlan {
    /// The query
    pub query: TaskQuery,
    /// The row numbers of the table
    pub row_number_column_name: String,
    /// The version that the filter is computed for
    pub version: ComputationVersion,
}

/// The rows that pass the filters, the host keeps their row numbers in the order of the table that the query read
#[derive(Clone, Debug, PartialEq)]
pub struct FilterResult {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The data frame of the row numbers
    pub data_frame: DataFrameId,
    /// The version that the filter was computed for, the state moved to it when the task was scheduled
    pub version: ComputationVersion,
}

/// Plan a filter into a new data frame, none without filters: no filter is active
pub fn plan_table_filtering(task: &TableFilteringTask, output: DataFrameId) -> Option<TableFilteringPlan> {
    if task.filters.is_empty() {
        return None;
    }
    let mut frame = SqlFrame::from(data_frame_table_name(task.input_data_frame));
    for filter in &task.filters {
        frame = frame.row_filter(filter.clone());
    }
    let sql = frame.project(vec![task.row_number_column_name.clone()]).to_sql();
    // The rows of the filter are shown in the order of the table
    let read = read_data_frame_sql(output, Some(vec![ascending(&task.row_number_column_name)]), None);
    Some(TableFilteringPlan {
        query: TaskQuery::new("Table filtering", "Failed to filter table", output, sql, read),
        row_number_column_name: task.row_number_column_name.clone(),
        version: task.table_version,
    })
}

impl TableFilteringPlan {
    /// The rows that pass
    pub fn finish(self) -> FilterResult {
        FilterResult {
            input_row_number_column_name: self.row_number_column_name,
            data_frame: self.query.data_frame,
            version: self.version,
        }
    }
}
