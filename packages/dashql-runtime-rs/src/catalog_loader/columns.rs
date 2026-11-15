//! Reading the columns of the results of metadata queries. A connector may send a column as another Arrow type than
//! the query names, e.g. Trino types `ordinal_position` as bigint, so the columns are cast to the type they are read
//! as. A batch without rows needs no columns.

use std::sync::Arc;

use arrow_array::cast::AsArray;
use arrow_array::types::Int64Type;
use arrow_array::{Array, ArrayRef, BooleanArray, Int64Array, ListArray, RecordBatch, StringArray};
use arrow_cast::cast;
use arrow_schema::{DataType, Field};

use super::CatalogLoadError;

/// The column of a batch cast to a type, none if the batch doesn't have it
fn cast_column(batch: &RecordBatch, name: &str, data_type: &DataType) -> Result<Option<ArrayRef>, CatalogLoadError> {
    let Some(column) = batch.column_by_name(name) else {
        return Ok(None);
    };
    if column.data_type() == data_type {
        return Ok(Some(column.clone()));
    }
    cast(column.as_ref(), data_type)
        .map(Some)
        .map_err(|error| CatalogLoadError::failed(format!("cannot read the column {name}: {error}")))
}

/// The error of a column that a result lacks
fn missing(name: &str) -> CatalogLoadError {
    CatalogLoadError::failed(format!("the metadata result has no column {name}"))
}

/// A column of strings
pub(crate) struct Strings(Option<StringArray>);

impl Strings {
    /// A column of a batch, an error if the batch lacks it
    pub(crate) fn of(batch: &RecordBatch, name: &str) -> Result<Self, CatalogLoadError> {
        let column = cast_column(batch, name, &DataType::Utf8)?.ok_or_else(|| missing(name))?;
        Ok(Self(column.as_string_opt::<i32>().cloned()))
    }

    /// The value of a row, none if it is null
    pub(crate) fn get(&self, row: usize) -> Option<&str> {
        let column = self.0.as_ref()?;
        (row < column.len() && !column.is_null(row)).then(|| column.value(row))
    }
}

/// A column of integers
pub(crate) struct Integers(Option<Int64Array>);

impl Integers {
    /// A column of a batch, an error if the batch lacks it
    pub(crate) fn of(batch: &RecordBatch, name: &str) -> Result<Self, CatalogLoadError> {
        let column = cast_column(batch, name, &DataType::Int64)?.ok_or_else(|| missing(name))?;
        Ok(Self(column.as_primitive_opt::<Int64Type>().cloned()))
    }

    /// The value of a row, none if it is null
    pub(crate) fn get(&self, row: usize) -> Option<i64> {
        let column = self.0.as_ref()?;
        (row < column.len() && !column.is_null(row)).then(|| column.value(row))
    }
}

/// A column of booleans
pub(crate) struct Booleans(Option<BooleanArray>);

impl Booleans {
    /// A column of a batch, an error if the batch lacks it
    pub(crate) fn of(batch: &RecordBatch, name: &str) -> Result<Self, CatalogLoadError> {
        let column = cast_column(batch, name, &DataType::Boolean)?.ok_or_else(|| missing(name))?;
        Ok(Self(column.as_boolean_opt().cloned()))
    }

    /// The value of a row, false if it is null
    pub(crate) fn get(&self, row: usize) -> bool {
        self.0.as_ref().is_some_and(|column| row < column.len() && !column.is_null(row) && column.value(row))
    }
}

/// A column of lists of strings
pub(crate) struct StringLists(Option<ListArray>);

impl StringLists {
    /// A column of a batch, an error if the batch lacks it
    pub(crate) fn of(batch: &RecordBatch, name: &str) -> Result<Self, CatalogLoadError> {
        let list = DataType::List(Arc::new(Field::new_list_field(DataType::Utf8, true)));
        let column = cast_column(batch, name, &list)?.ok_or_else(|| missing(name))?;
        Ok(Self(column.as_list_opt::<i32>().cloned()))
    }

    /// The list of a row with its null elements, empty if the list is null
    pub(crate) fn get(&self, row: usize) -> Vec<Option<String>> {
        let Some(column) = self.0.as_ref() else {
            return Vec::new();
        };
        if row >= column.len() || column.is_null(row) {
            return Vec::new();
        }
        let values = column.value(row);
        let Some(values) = values.as_string_opt::<i32>() else {
            return Vec::new();
        };
        (0..values.len()).map(|i| (!values.is_null(i)).then(|| values.value(i).to_string())).collect()
    }
}

/// The batches with rows
pub(crate) fn batches_with_rows(batches: &[RecordBatch]) -> impl Iterator<Item = &RecordBatch> {
    batches.iter().filter(|batch| batch.num_rows() > 0)
}

/// The rows of batches
pub(crate) fn row_count(batches: &[RecordBatch]) -> usize {
    batches.iter().map(RecordBatch::num_rows).sum()
}
