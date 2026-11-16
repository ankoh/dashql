//! The result table of a call: its columns, the values of the response converted to the column types, and the table as
//! an Arrow record batch or as IPC bytes for the UI.
//!
//! Ported from the result parts of `connections/clfn/clfn_runtime.ts` and `clfn_result_stream.ts` of
//! `packages/dashql/src/runtime`, which turned the rows into Arrow with `translateAnyRowsToArrowBatch`.

use std::sync::Arc;

use arrow_array::builder::{
    BooleanBuilder, Date32Builder, Float64Builder, Int32Builder, Int64Builder, StringBuilder, TimestampMillisecondBuilder,
};
use arrow_array::{ArrayRef, RecordBatch};
use arrow_schema::{DataType, Field, Schema, SchemaRef, TimeUnit};
use serde_json::Value;

use super::json::{js_number, js_string, to_json_text};
use super::time::{parse_date_days, parse_timestamp_ms};
use super::ClientFunctionError;

/// The type of a result column
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnType {
    Varchar,
    TimestampTz,
    Date,
    Integer,
    BigInt,
    Double,
    Boolean,
    /// JSON as text, in the spelling of the API
    Json,
}

impl ColumnType {
    /// The type of a column of the spec, VARCHAR if it has none or one the runtime doesn't know
    pub fn of(column_type: Option<&str>) -> Self {
        match column_type {
            Some("TIMESTAMPTZ") => ColumnType::TimestampTz,
            Some("DATE") => ColumnType::Date,
            Some("INTEGER") => ColumnType::Integer,
            Some("BIGINT") => ColumnType::BigInt,
            Some("DOUBLE") => ColumnType::Double,
            Some("BOOLEAN") => ColumnType::Boolean,
            Some("JSON") => ColumnType::Json,
            _ => ColumnType::Varchar,
        }
    }

    /// The Arrow type
    pub fn arrow_type(self) -> DataType {
        match self {
            ColumnType::TimestampTz => DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into())),
            ColumnType::Date => DataType::Date32,
            ColumnType::Integer => DataType::Int32,
            ColumnType::BigInt => DataType::Int64,
            ColumnType::Double => DataType::Float64,
            ColumnType::Boolean => DataType::Boolean,
            ColumnType::Varchar | ColumnType::Json => DataType::Utf8,
        }
    }
}

/// A value of a result
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Null,
    Int32(i32),
    Int64(i64),
    Float64(f64),
    Bool(bool),
    Utf8(String),
    /// Milliseconds since the epoch
    TimestampMs(i64),
    /// Days since the epoch
    Date(i32),
}

impl Cell {
    /// Text or null
    pub fn text(value: Option<String>) -> Self {
        value.map_or(Cell::Null, Cell::Utf8)
    }
    /// The text of a cell, none for any other
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Cell::Utf8(text) => Some(text),
            _ => None,
        }
    }
    /// Is the cell null?
    pub fn is_null(&self) -> bool {
        matches!(self, Cell::Null)
    }
}

/// The largest integer that a JavaScript number holds exactly
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Convert a value of a response to its column type, none if it can't be. The value then goes to `_raw`. A value that
/// is absent or null is a null.
pub fn convert_value(value: Option<&Value>, column_type: ColumnType) -> Option<Cell> {
    let value = match value {
        None | Some(Value::Null) => return Some(Cell::Null),
        Some(value) => value,
    };
    // A number, or text that is a number
    let numeric = || match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if !s.trim().is_empty() => Some(js_number(value)),
        _ => None,
    };
    match column_type {
        ColumnType::Integer => {
            let n = numeric()?;
            (n.is_finite() && n == n.trunc() && n.abs() <= f64::from(i32::MAX)).then_some(Cell::Int32(n as i32))
        }
        ColumnType::BigInt => match value {
            Value::Number(n) => match (n.as_i64(), n.as_f64()) {
                (Some(i), _) if (i as f64).abs() <= MAX_SAFE_INTEGER => Some(Cell::Int64(i)),
                (None, Some(f)) if f == f.trunc() && f.abs() <= MAX_SAFE_INTEGER => Some(Cell::Int64(f as i64)),
                _ => None,
            },
            Value::String(s) => {
                let digits = s.strip_prefix('-').unwrap_or(s);
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                s.parse::<i64>().ok().map(Cell::Int64)
            }
            _ => None,
        },
        ColumnType::Double => numeric().filter(|n| n.is_finite()).map(Cell::Float64),
        ColumnType::Boolean => value.as_bool().map(Cell::Bool),
        ColumnType::TimestampTz => value.as_str().and_then(parse_timestamp_ms).map(Cell::TimestampMs),
        // The day as written, whatever time and zone follow it
        ColumnType::Date => {
            let day: String = value.as_str()?.chars().take(10).collect();
            parse_date_days(&day).map(Cell::Date)
        }
        ColumnType::Json => Some(Cell::Utf8(to_json_text(value))),
        ColumnType::Varchar => match value {
            Value::Array(_) | Value::Object(_) => None,
            _ => Some(Cell::Utf8(js_string(value))),
        },
    }
}

/// A column of a result
#[derive(Debug, Clone, PartialEq)]
pub struct ResultField {
    pub name: String,
    pub column_type: ColumnType,
}

/// The result table of a call
#[derive(Debug, Clone, PartialEq)]
pub struct ClientFunctionResult {
    /// The columns
    pub fields: Vec<ResultField>,
    /// The rows, a value per column
    pub rows: Vec<Vec<Cell>>,
}

impl ClientFunctionResult {
    /// The index of a column
    pub fn column(&self, name: &str) -> Option<usize> {
        self.fields.iter().position(|f| f.name == name)
    }

    /// The names of the columns
    pub fn column_names(&self) -> Vec<&str> {
        self.fields.iter().map(|f| f.name.as_str()).collect()
    }

    /// The value of a column in a row
    pub fn cell(&self, row: usize, column: &str) -> Option<&Cell> {
        self.rows.get(row)?.get(self.column(column)?)
    }

    /// The Arrow schema, every column is nullable
    pub fn schema(&self) -> SchemaRef {
        Arc::new(Schema::new(
            self.fields.iter().map(|f| Field::new(f.name.clone(), f.column_type.arrow_type(), true)).collect::<Vec<_>>(),
        ))
    }

    /// The table as one record batch. A cell that doesn't fit its column is a null.
    pub fn to_record_batch(&self) -> Result<RecordBatch, ClientFunctionError> {
        let n = self.rows.len();
        let mut columns: Vec<ArrayRef> = Vec::with_capacity(self.fields.len());
        for (i, field) in self.fields.iter().enumerate() {
            let cells = self.rows.iter().map(|row| row.get(i).unwrap_or(&Cell::Null));
            let array: ArrayRef = match field.column_type {
                ColumnType::Integer => {
                    let mut b = Int32Builder::with_capacity(n);
                    cells.for_each(|c| b.append_option(if let Cell::Int32(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::BigInt => {
                    let mut b = Int64Builder::with_capacity(n);
                    cells.for_each(|c| b.append_option(if let Cell::Int64(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::Double => {
                    let mut b = Float64Builder::with_capacity(n);
                    cells.for_each(|c| b.append_option(if let Cell::Float64(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::Boolean => {
                    let mut b = BooleanBuilder::with_capacity(n);
                    cells.for_each(|c| b.append_option(if let Cell::Bool(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::TimestampTz => {
                    let mut b = TimestampMillisecondBuilder::with_capacity(n).with_timezone("UTC");
                    cells.for_each(|c| b.append_option(if let Cell::TimestampMs(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::Date => {
                    let mut b = Date32Builder::with_capacity(n);
                    cells.for_each(|c| b.append_option(if let Cell::Date(v) = c { Some(*v) } else { None }));
                    Arc::new(b.finish())
                }
                ColumnType::Varchar | ColumnType::Json => {
                    let mut b = StringBuilder::with_capacity(n, n * 16);
                    cells.for_each(|c| b.append_option(c.as_str()));
                    Arc::new(b.finish())
                }
            };
            columns.push(array);
        }
        RecordBatch::try_new(self.schema(), columns).map_err(|e| ClientFunctionError::new(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_values_or_leaves_them() {
        assert_eq!(convert_value(Some(&json!(" 12 ")), ColumnType::Integer), Some(Cell::Int32(12)));
        assert_eq!(convert_value(Some(&json!("many")), ColumnType::Integer), None);
        assert_eq!(convert_value(Some(&json!(3_000_000_000_i64)), ColumnType::Integer), None);
        assert_eq!(convert_value(Some(&json!("9007199254740993")), ColumnType::BigInt), Some(Cell::Int64(9_007_199_254_740_993)));
        assert_eq!(convert_value(Some(&json!(true)), ColumnType::Double), None);
        assert_eq!(convert_value(Some(&json!(1)), ColumnType::Boolean), None);
        assert_eq!(convert_value(Some(&json!({ "a": 1 })), ColumnType::Varchar), None);
        assert_eq!(convert_value(Some(&json!({ "a": 1 })), ColumnType::Json), Some(Cell::Utf8("{\"a\":1}".into())));
        assert_eq!(convert_value(None, ColumnType::Boolean), Some(Cell::Null));
    }
}
