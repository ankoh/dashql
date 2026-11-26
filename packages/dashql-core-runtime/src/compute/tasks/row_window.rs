//! The read of a window of the rows that the grid of a result shows: the rows that pass the filters and the data
//! search, in the order of the ordering, from an offset. The grid reads the rows that it renders and nothing else, the
//! result stays in the compute database (docs/wip/result_windows.md).
//!
//! The rows of a window have the fields of the result and its row numbers, the columns of the computation stay out.
//! Which rows show is decided here: an ordering orders the rows that were filtered and searched when it ran, a data
//! search that it doesn't cover narrows them further. Without an ordering the rows keep the order of the result.

use super::data_search::DATA_SEARCH_ROW_FIELD;
use super::sql::SqlFrame;
use super::{ascending, data_frame_table_name};
use crate::catalog_loader::sql::quote_identifier;
use crate::compute::types::FilterOp;
use crate::compute::TableComputation;

/// How many rows show
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WindowRows {
    /// The state knows them
    Known(u64),
    /// A query counts them, e.g. the rows of a filter that a data search narrows
    Counted(String),
}

/// The read of a window
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowWindowPlan {
    /// The read of the rows of the window
    pub sql: String,
    /// The rows that show in all
    pub rows: WindowRows,
}

/// A window of the rows that show
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowWindow {
    /// The rows that show in all
    pub rows: u64,
    /// The rows of the window as an Arrow IPC stream
    pub ipc: Vec<u8>,
}

/// Plan the read of the rows that show from an offset, at most `limit`. None for a result that isn't imported yet: the
/// data frame of the import has the row numbers, the system columns don't have to be there.
pub fn plan_row_window(computation: &TableComputation, offset: u64, limit: u64) -> Option<RowWindowPlan> {
    let data_frame = computation.data_frame?;
    let row_number = computation.row_number_field.clone()?;
    let mut frame = SqlFrame::from(data_frame_table_name(data_frame));
    let mut joins = 0;
    let mut known = computation.data_table.rows();
    let mut order = Vec::new();
    let search = computation.data_search_table.as_ref();
    if let Some(ordering) = &computation.ordering_table {
        frame = frame.semi_join_filter(
            row_number.clone(),
            data_frame_table_name(ordering.data_frame),
            ordering.input_row_number_column_name.clone(),
        );
        joins += 1;
        known = ordering.table.rows();
        order.extend(ordering.ordering_constraints.iter().cloned());
        // An ordering of an older search, or of none, covers more rows than the search matched
        if let Some(search) = search.filter(|search| ordering.data_search_request_id != Some(search.request_id)) {
            frame = frame.semi_join_filter(
                row_number.clone(),
                data_frame_table_name(search.data_frame),
                DATA_SEARCH_ROW_FIELD,
            );
            joins += 1;
        }
    } else {
        if let Some(filter) = &computation.filter_table {
            frame = frame.semi_join_filter(
                row_number.clone(),
                data_frame_table_name(filter.data_frame),
                filter.input_row_number_column_name.clone(),
            );
            joins += 1;
            known = filter.table.rows();
        }
        if let Some(search) = search {
            frame = frame.semi_join_filter(
                row_number.clone(),
                data_frame_table_name(search.data_frame),
                DATA_SEARCH_ROW_FIELD,
            );
            joins += 1;
            known = search.table.rows();
        }
    }
    order.push(ascending(&row_number));
    let rows = if joins > 1 {
        let selection = frame.clone().project(vec![row_number.clone()]).to_sql();
        WindowRows::Counted(format!("SELECT count(*) AS count FROM (\n{selection}\n) AS {}", quote_identifier("rows")))
    } else {
        WindowRows::Known(known)
    };
    // The row numbers of a result without filters, searches and an ordering are the positions of its rows
    frame = if joins == 0 {
        frame
            .filter(row_number.clone(), FilterOp::Greater, offset as f64)
            .filter(row_number.clone(), FilterOp::LessEqual, offset.saturating_add(limit) as f64)
            .order_by(order, Some(limit))
    } else {
        frame.order_by(order, Some(limit)).offset(offset)
    };
    let mut fields = computation.data_table_fields.clone();
    fields.push(row_number);
    Some(RowWindowPlan { sql: frame.project(fields).to_sql(), rows })
}
