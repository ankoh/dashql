//! The tasks of the computations: the queries on the compute database (the embedded Hyper of the host) that
//! summarize a result, filter, order and search it, and the reading of their results.
//!
//! A task is sans-IO. Its plan says what the host runs: a `TaskQuery` creates the table of a new data frame from a
//! SELECT and reads it back. The host runs the two statements and hands the read batches to the `finish` of the plan,
//! which returns what the computation state takes, with the summaries as Rust values. The analysis of a result
//! imports the result with row numbers as the first data frame (`TableImport`).
//!
//! A data frame is a table of the compute database, named by its id (`data_frame_table_name`). The caller allocates the
//! id of the data frame of a plan. A query or a finish that fails leaves the data frame to the caller, which drops it.
//!
//! Ported from `packages/dashql-runtime/src/compute/tasks/`, `sql/`, `analyze_table.ts`, `column_analysis.ts`,
//! `arrow_columns.ts` and `computation_tasks.ts`, and `connections/result_computations.ts`.

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

/// A table that the host imports into the compute database as the table of a data frame
#[derive(Clone, Debug, PartialEq)]
pub struct TableImport {
    /// The data frame
    pub data_frame: DataFrameId,
    /// The table of the data frame
    pub table_name: String,
    /// The rows
    pub table: ResultTable,
}

/// The statistics of all columns of a table, one row
#[derive(Clone, Debug, PartialEq)]
pub struct TableStats {
    /// The data frame of the statistics
    pub data_frame: DataFrameId,
    /// The statistics
    pub table: ResultTable,
    /// The field with the row count
    pub count_star_field_name: String,
}

impl TableStats {
    /// A count of the statistics, none if it is null
    pub fn count(&self, field_name: &str) -> Result<Option<i64>> {
        let column = self.table.require_column(field_name)?;
        Ok(self.table.int64_values(column)?.into_iter().next().flatten())
    }

    /// The row count, 0 without
    pub fn row_count(&self) -> Result<i64> {
        Ok(self.count(&self.count_star_field_name)?.unwrap_or(0))
    }

    /// A statistic as an array of one value in its type, e.g. the minimum of a column
    pub fn value(&self, field_name: &str) -> Result<ArrayRef> {
        let column = self.table.require_column(field_name)?;
        self.table.value(column, 0)?.ok_or_else(|| Error::invalid_argument("the statistics have no row"))
    }
}
