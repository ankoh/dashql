//! The kinds of the columns of a result: which Arrow types are binned, counted or skipped, how a value turns into a
//! number, and the column groups of the grid.
//!
//! Ported from `packages/dashql-runtime/src/compute/arrow_columns.ts` and `buildGridColumnGroups` of
//! `analyze_table.ts`.

use std::collections::HashSet;

use arrow_schema::{DataType, Schema};
use dashql_core::error::{Error, Result};

use super::sql::ToNumeric;
use crate::compute::types::{ColumnGroup, ListColumnGroup, OrdinalColumnGroup, SkippedColumnGroup, StringColumnGroup};

/// The bins of an ordinal column
pub const BIN_COUNT: u32 = 16;

/// Is the type a date, a time, a timestamp or a duration?
pub fn is_temporal_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Date32
            | DataType::Date64
            | DataType::Time32(_)
            | DataType::Time64(_)
            | DataType::Timestamp(_, _)
            | DataType::Duration(_)
    )
}

/// Is the type an integer?
pub fn is_integer_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::UInt8
            | DataType::UInt16
            | DataType::UInt32
            | DataType::UInt64
    )
}

/// Is the type ordered and binned: numbers, booleans, decimals and temporal values?
pub fn is_ordinal_type(data_type: &DataType) -> bool {
    is_integer_type(data_type)
        || is_temporal_type(data_type)
        || matches!(
            data_type,
            DataType::Float16
                | DataType::Float32
                | DataType::Float64
                | DataType::Boolean
                | DataType::Decimal32(_, _)
                | DataType::Decimal64(_, _)
                | DataType::Decimal128(_, _)
                | DataType::Decimal256(_, _)
        )
}

/// The conversion of a value of a type into a number, a cast to double without
pub fn to_numeric_of(data_type: &DataType) -> Option<ToNumeric> {
    match data_type {
        // Hyper extracts no epoch from a time of day, only from its interval since midnight
        DataType::Time32(_) | DataType::Time64(_) => Some(ToNumeric::TimeEpoch),
        data_type if is_temporal_type(data_type) => Some(ToNumeric::Epoch),
        DataType::Boolean => Some(ToNumeric::Boolean),
        _ => None,
    }
}

/// The values of a small integer domain from a minimum to a maximum, none if they are more than a maximum
pub fn small_integer_domain_size(min: Option<i128>, max: Option<i128>, max_size: u32) -> Option<u32> {
    let size = max?.checked_sub(min?)?.checked_add(1)?;
    if size > 0 && size <= i128::from(max_size) {
        u32::try_from(size).ok()
    } else {
        None
    }
}

/// A name with the prefix that no field has, the prefix with leading underscores. It becomes a name of the fields.
pub fn create_unique_column_name(prefix: &str, field_names: &mut HashSet<String>) -> String {
    let mut name = prefix.to_string();
    while field_names.contains(&name) {
        name = format!("_{name}");
    }
    field_names.insert(name.clone());
    name
}

/// The column groups of the grid of a result, one per field: ordinal, string, list or skipped
pub fn build_column_groups(schema: &Schema) -> Vec<ColumnGroup> {
    schema
        .fields()
        .iter()
        .map(|field| {
            let input_field_name = field.name().clone();
            let input_field_type = field.data_type().to_string();
            let input_field_nullable = field.is_nullable();
            match field.data_type() {
                data_type if is_ordinal_type(data_type) => ColumnGroup::Ordinal(OrdinalColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: None,
                    bin_field_name: None,
                    bin_count: BIN_COUNT,
                }),
                DataType::Utf8 | DataType::LargeUtf8 => ColumnGroup::String(StringColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: None,
                    value_id_field_name: None,
                }),
                DataType::List(_) | DataType::FixedSizeList(_, _) => ColumnGroup::List(ListColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                    stats_fields: None,
                    value_id_field_name: None,
                }),
                _ => ColumnGroup::Skipped(SkippedColumnGroup {
                    input_field_name,
                    input_field_type,
                    input_field_nullable,
                }),
            }
        })
        .collect()
}

/// The type of a field of a result
pub fn field_type<'a>(schema: &'a Schema, field_name: &str) -> Result<&'a DataType> {
    schema
        .field_with_name(field_name)
        .map(|field| field.data_type())
        .map_err(|_| Error::invalid_argument(format!("the result has no field {field_name}")))
}
