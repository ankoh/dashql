//! The order of the rows of a table, as row numbers in display order. An ordering of a filtered or searched table
//! orders the selected rows only. Equal rows keep the order of the table.

use super::data_search::DATA_SEARCH_ROW_FIELD;
use super::sql::SqlFrame;
use super::{ascending, data_frame_table_name, read_data_frame_sql, TaskQuery};
use crate::compute::types::{ComputationVersion, DataFrameId, OrderByConstraint, TableOrderingTask};

/// The query of an ordering
#[derive(Clone, Debug, PartialEq)]
pub struct TableOrderingPlan {
    /// The query
    pub query: TaskQuery,
    /// The row numbers of the table
    pub row_number_column_name: String,
    /// The ordering
    pub ordering_constraints: Vec<OrderByConstraint>,
    /// The version that the ordering is computed for
    pub version: ComputationVersion,
    /// The data search that the ordering is limited to
    pub data_search_request_id: Option<u64>,
}

/// The rows in order, the host keeps the row numbers in display order that the query read
#[derive(Clone, Debug, PartialEq)]
pub struct OrderingResult {
    /// The row numbers that the table holds
    pub input_row_number_column_name: String,
    /// The ordering
    pub ordering_constraints: Vec<OrderByConstraint>,
    /// The data frame with the row numbers and the fields of the ordering
    pub data_frame: DataFrameId,
    /// The version that the ordering was computed for
    pub version: ComputationVersion,
    /// The data search that the ordering is limited to
    pub data_search_request_id: Option<u64>,
}

/// Plan an ordering into a new data frame
pub fn plan_table_ordering(task: &TableOrderingTask, output: DataFrameId) -> TableOrderingPlan {
    let row_number = &task.row_number_column_name;
    let mut frame = SqlFrame::from(data_frame_table_name(task.input_data_frame));
    if let Some(filter) = &task.filter_table {
        frame = frame.semi_join_filter(
            row_number.clone(),
            data_frame_table_name(filter.data_frame),
            filter.input_row_number_column_name.clone(),
        );
    }
    if let Some(search) = &task.data_search_table {
        let search_table = data_frame_table_name(search.data_frame);
        frame = frame.semi_join_filter(row_number.clone(), search_table, DATA_SEARCH_ROW_FIELD);
    }
    // The table keeps the fields of the ordering, the read sorts the rows
    let mut fields: Vec<String> = vec![row_number.clone()];
    for constraint in &task.ordering_constraints {
        if !fields.contains(&constraint.field) {
            fields.push(constraint.field.clone());
        }
    }
    let sql = frame.project(fields).to_sql();
    let mut order = task.ordering_constraints.clone();
    order.push(ascending(row_number));
    let read = read_data_frame_sql(output, Some(order), Some(vec![row_number.clone()]));
    TableOrderingPlan {
        query: TaskQuery::new("Table ordering", "Sorting table failed", output, sql, read),
        row_number_column_name: row_number.clone(),
        ordering_constraints: task.ordering_constraints.clone(),
        version: task.table_version,
        data_search_request_id: task.data_search_table.as_ref().map(|search| search.request_id),
    }
}

impl TableOrderingPlan {
    /// The rows in order
    pub fn finish(self) -> OrderingResult {
        OrderingResult {
            input_row_number_column_name: self.row_number_column_name,
            ordering_constraints: self.ordering_constraints,
            data_frame: self.query.data_frame,
            version: self.version,
            data_search_request_id: self.data_search_request_id,
        }
    }
}
