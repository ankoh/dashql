//! A table of Arrow record batches with its schema: a result, the rows that a task read from the compute database.
//!
//! The readers of the columns cast what they read, so a count may arrive as any integer type, and return an error,
//! never a panic, for a missing column or a type they can't cast.

use arrow_array::cast::AsArray;
use arrow_array::types::{Float64Type, Int64Type, UInt64Type};
use arrow_array::{Array, ArrayRef, RecordBatch};
use arrow_schema::{DataType, SchemaRef};
use dashql_core::error::{Error, Result};

/// A table of record batches that share a schema
#[derive(Clone, Debug, PartialEq)]
pub struct ResultTable {
    schema: SchemaRef,
    batches: Vec<RecordBatch>,
}

fn arrow_error(context: &str) -> impl Fn(arrow_schema::ArrowError) -> Error + '_ {
    move |e| Error::invalid_argument(format!("{context}: {e}"))
}

/// The values of an array as 64-bit integers, null where a value is null or doesn't fit
pub(crate) fn int64_values(array: &dyn Array) -> Result<Vec<Option<i64>>> {
    let cast = arrow_cast::cast(array, &DataType::Int64).map_err(arrow_error("an integer column"))?;
    let ints = cast
        .as_primitive_opt::<Int64Type>()
        .ok_or_else(|| Error::invalid_argument("an integer column isn't Int64 after the cast"))?;
    Ok(ints.iter().collect())
}

/// The first value of an array of any integer type, exact for unsigned 64-bit integers
pub(crate) fn integer_of(value: &ArrayRef) -> Result<Option<i128>> {
    if value.is_empty() || value.is_null(0) {
        return Ok(None);
    }
    if let Some(unsigned) = value.as_primitive_opt::<UInt64Type>() {
        return Ok(unsigned.iter().next().flatten().map(i128::from));
    }
    if !value.data_type().is_integer() {
        return Ok(None);
    }
    let cast = arrow_cast::cast(value.as_ref(), &DataType::Int64).map_err(arrow_error("an integer value"))?;
    Ok(cast.as_primitive_opt::<Int64Type>().and_then(|ints| ints.iter().next().flatten()).map(i128::from))
}

impl ResultTable {
    /// A table of batches, every batch has the schema of the table
    pub fn try_new(schema: SchemaRef, batches: Vec<RecordBatch>) -> Result<Self> {
        if let Some(batch) = batches.iter().find(|batch| batch.schema().fields() != schema.fields()) {
            return Err(Error::invalid_argument(format!(
                "a batch with the fields {:?} doesn't match the fields of its table",
                batch.schema().fields().iter().map(|f| f.name()).collect::<Vec<_>>()
            )));
        }
        Ok(Self { schema, batches })
    }

    /// Read a table from an Arrow IPC stream
    pub fn from_ipc_stream(bytes: &[u8]) -> Result<Self> {
        let reader = arrow_ipc::reader::StreamReader::try_new(bytes, None).map_err(arrow_error("an IPC stream"))?;
        let schema = reader.schema();
        let batches = reader.collect::<std::result::Result<Vec<_>, _>>().map_err(arrow_error("an IPC stream"))?;
        Self::try_new(schema, batches)
    }

    /// Read only the schema of an Arrow IPC stream, e.g. of a table of the host that describes itself without its rows
    pub fn schema_of_ipc_stream(bytes: &[u8]) -> Result<SchemaRef> {
        let reader = arrow_ipc::reader::StreamReader::try_new(bytes, None).map_err(arrow_error("an IPC stream"))?;
        Ok(reader.schema())
    }

    /// The schema
    pub fn schema(&self) -> &SchemaRef {
        &self.schema
    }

    /// The batches
    pub fn batches(&self) -> &[RecordBatch] {
        &self.batches
    }

    /// The rows
    pub fn num_rows(&self) -> usize {
        self.batches.iter().map(RecordBatch::num_rows).sum()
    }

    /// The column of a field, the first of a name
    pub fn column_index(&self, name: &str) -> Option<usize> {
        self.schema.index_of(name).ok()
    }

    /// The column of a field, or an error that names it
    pub(crate) fn require_column(&self, name: &str) -> Result<usize> {
        self.column_index(name).ok_or_else(|| Error::invalid_argument(format!("the result has no field {name}")))
    }

    /// The arrays of a column, one per batch
    fn column_arrays(&self, column: usize) -> Result<Vec<&ArrayRef>> {
        self.batches
            .iter()
            .map(|batch| {
                batch
                    .columns()
                    .get(column)
                    .ok_or_else(|| Error::invalid_argument(format!("the result has no column {column}")))
            })
            .collect()
    }

    /// The values of a column as 64-bit integers, null where a value is null or doesn't fit
    pub fn int64_values(&self, column: usize) -> Result<Vec<Option<i64>>> {
        let mut values = Vec::with_capacity(self.num_rows());
        for array in self.column_arrays(column)? {
            values.extend(int64_values(array.as_ref())?);
        }
        Ok(values)
    }

    /// The values of a column as doubles
    pub fn float64_values(&self, column: usize) -> Result<Vec<Option<f64>>> {
        let mut values = Vec::with_capacity(self.num_rows());
        for array in self.column_arrays(column)? {
            let cast = arrow_cast::cast(array.as_ref(), &DataType::Float64).map_err(arrow_error("a numeric column"))?;
            let doubles = cast
                .as_primitive_opt::<Float64Type>()
                .ok_or_else(|| Error::invalid_argument("a numeric column isn't Float64 after the cast"))?;
            values.extend(doubles.iter());
        }
        Ok(values)
    }

    /// The values of a column as strings
    pub fn string_values(&self, column: usize) -> Result<Vec<Option<String>>> {
        let mut values = Vec::with_capacity(self.num_rows());
        for array in self.column_arrays(column)? {
            let cast = arrow_cast::cast(array.as_ref(), &DataType::Utf8).map_err(arrow_error("a string column"))?;
            let strings =
                cast.as_string_opt::<i32>().ok_or_else(|| Error::invalid_argument("a string column isn't Utf8"))?;
            values.extend(strings.iter().map(|value| value.map(str::to_string)));
        }
        Ok(values)
    }

    /// An integer value of any integer type, exact for unsigned 64-bit integers
    pub fn integer_value(&self, column: usize, row: usize) -> Result<Option<i128>> {
        match self.value(column, row)? {
            Some(value) => integer_of(&value),
            None => Ok(None),
        }
    }

    /// The value of a row as an array of one value in the type of the column, none past the last row
    pub fn value(&self, column: usize, row: usize) -> Result<Option<ArrayRef>> {
        let mut offset = 0;
        for array in self.column_arrays(column)? {
            if row < offset + array.len() {
                return Ok(Some(array.slice(row - offset, 1)));
            }
            offset += array.len();
        }
        Ok(None)
    }
}
