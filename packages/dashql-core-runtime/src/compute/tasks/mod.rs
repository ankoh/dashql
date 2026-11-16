//! The tasks of the computations: the queries on the compute database (the embedded Hyper of the host) that
//! summarize a result, filter, order and search it, and the reading of their results.
//!
//! A task is sans-IO. Its plan says what the host runs: a `TaskQuery` creates the table of a new data frame from a
//! SELECT and reads it back. The service (`compute::service`) runs the two statements on the host. The `finish` of a
//! plan returns what the computation state takes: the summaries as Rust values from the small tables that it parses
//! (the statistics, the bins and the frequent values), the rest names the read table that the host keeps. The analysis
//! of a result imports the result with row numbers as the first data frame (`TableImport`).
//!
//! A data frame is a table of the compute database, named by its id (`data_frame_table_name`). The caller allocates the
//! id of the data frame of a plan. A query or a finish that fails leaves the data frame to the caller, which drops it.

pub mod analysis;
pub mod analyze_table;
pub mod column_aggregation;
pub mod columns;
pub mod data_search;
pub mod result_computations;
pub mod result_table;
pub mod sql;
pub mod system_columns;
pub mod table_aggregation;
pub mod table_filtering;
pub mod table_ordering;

use std::fmt;
use std::sync::Arc;

use arrow_array::ArrayRef;
use dashql_core::error::{Error, Result};

use crate::compute::types::{DataFrameId, OrderByConstraint};
use result_table::ResultTable;
use sql::{quote_ident, SqlFrame};

/// The table of a data frame in the compute database
pub fn data_frame_table_name(data_frame: DataFrameId) -> String {
    format!("__df_{data_frame}")
}

/// The statement that drops the table of a data frame
pub fn drop_data_frame_sql(data_frame: DataFrameId) -> String {
    format!("DROP TABLE IF EXISTS {}", quote_ident(&data_frame_table_name(data_frame)))
}

/// The read of the rows of a data frame. A table doesn't keep the order of the query that created it, a read without
/// an order has rows in no particular order.
pub fn read_data_frame_sql(
    data_frame: DataFrameId,
    order_by: Option<Vec<OrderByConstraint>>,
    columns: Option<Vec<String>>,
) -> String {
    let mut frame = SqlFrame::from(data_frame_table_name(data_frame));
    if let Some(order_by) = order_by {
        frame = frame.order_by(order_by, None);
    }
    if let Some(columns) = columns {
        frame = frame.project(columns);
    }
    frame.to_sql()
}

/// The read of the first rows of a result from its data frame: the fields of the result in the order of its rows, the
/// row numbers that the import appended order them, the columns that the computation added stay out
pub fn preview_data_frame_sql(data_frame: DataFrameId, fields: &[String], row_number_field: &str, limit: u64) -> String {
    SqlFrame::from(data_frame_table_name(data_frame))
        .order_by(vec![ascending(row_number_field)], Some(limit))
        .project(fields.to_vec())
        .to_sql()
}

/// An ascending key of an ordering with nulls last
pub(crate) fn ascending(field: &str) -> OrderByConstraint {
    OrderByConstraint { field: field.to_string(), ascending: None, nulls_first: None }
}

/// The query of a task: create the table of a data frame from a SELECT, then read the table
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskQuery {
    /// The title of the query in the query history
    pub title: &'static str,
    /// The data frame that the query creates
    pub data_frame: DataFrameId,
    /// The table of the data frame
    pub table_name: String,
    /// The SELECT of the task, the query history tracks it
    pub sql: String,
    /// The read of the created table, in the order that the task needs
    pub read_sql: String,
    /// The message of a failure of the task
    failure: &'static str,
}

impl TaskQuery {
    fn new(title: &'static str, failure: &'static str, data_frame: DataFrameId, sql: String, read_sql: String) -> Self {
        Self { title, data_frame, table_name: data_frame_table_name(data_frame), sql, read_sql, failure }
    }

    /// The statement that creates the table of the data frame
    pub fn create_sql(&self) -> String {
        format!("CREATE TABLE {} AS {}", quote_ident(&self.table_name), self.sql)
    }

    /// The error of the task when its query, its read or its finish failed
    pub fn failed(&self, error: impl fmt::Display) -> Error {
        Error::invalid_argument(format!("{}: {error}", self.failure))
    }
}

/// A table of the host that it imports into the compute database as the table of a data frame
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableImport {
    /// The data frame
    pub data_frame: DataFrameId,
    /// The table of the data frame
    pub table_name: String,
}

/// The values of the row of the statistics of a table by field, each an array of one value in the type of its column.
/// The runtime keeps the values, the table of the statistics stays with the host.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct StatsRow {
    /// The fields with their values, none without a row
    values: Vec<(String, Option<ArrayRef>)>,
}

impl StatsRow {
    /// Read the first row of a table
    pub fn read(table: &ResultTable) -> Result<Self> {
        let fields = table.schema().fields();
        let value = |(column, field): (usize, &arrow_schema::FieldRef)| Ok((field.name().clone(), table.value(column, 0)?));
        let values = fields.iter().enumerate().map(value);
        Ok(Self { values: values.collect::<Result<_>>()? })
    }

    /// The value of a field, none without a row, an error for a field that the statistics don't have
    fn value(&self, field_name: &str) -> Result<Option<&ArrayRef>> {
        self.values
            .iter()
            .find(|(field, _)| field == field_name)
            .map(|(_, value)| value.as_ref())
            .ok_or_else(|| Error::invalid_argument(format!("the result has no field {field_name}")))
    }
}

/// The statistics of all columns of a table, one row
#[derive(Clone, Debug, PartialEq)]
pub struct TableStats {
    /// The data frame of the statistics
    pub data_frame: DataFrameId,
    /// The values of the statistics
    pub row: Arc<StatsRow>,
    /// The field with the row count
    pub count_star_field_name: String,
}

impl TableStats {
    /// The statistics of the first row of a table
    pub fn read(data_frame: DataFrameId, table: &ResultTable, count_star_field_name: impl Into<String>) -> Result<Self> {
        let row = Arc::new(StatsRow::read(table)?);
        Ok(Self { data_frame, row, count_star_field_name: count_star_field_name.into() })
    }

    /// A count of the statistics, none if it is null
    pub fn count(&self, field_name: &str) -> Result<Option<i64>> {
        match self.row.value(field_name)? {
            Some(value) => Ok(result_table::int64_values(value.as_ref())?.into_iter().next().flatten()),
            None => Ok(None),
        }
    }

    /// The row count, 0 without
    pub fn row_count(&self) -> Result<i64> {
        Ok(self.count(&self.count_star_field_name)?.unwrap_or(0))
    }

    /// A statistic as an array of one value in its type, e.g. the minimum of a column
    pub fn value(&self, field_name: &str) -> Result<ArrayRef> {
        self.row.value(field_name)?.cloned().ok_or_else(|| Error::invalid_argument("the statistics have no row"))
    }

    /// An integer statistic of any integer type, none for a field that the statistics don't have
    pub fn integer(&self, field_name: &str) -> Result<Option<i128>> {
        match self.row.value(field_name) {
            Ok(Some(value)) => result_table::integer_of(value),
            Ok(None) | Err(_) => Ok(None),
        }
    }
}
