//! The analysis of the summary of a column: the counts and shares of the bins of a histogram or of the frequent
//! values.
//!
//! The values that the grid shows formatted stay Arrow values: the minimum and the maximum in the type of the
//! column, the lower bounds of the bins as numbers or epoch milliseconds. The host formats them as it formats the
//! cells of the grid.
//!
//! Ported from `packages/dashql-runtime/src/compute/column_analysis.ts`.

use arrow_array::ArrayRef;
use dashql_core::error::{Error, Result};

use super::columns::is_temporal_type;
use super::result_table::ResultTable;
use super::TableStats;
use crate::compute::types::{ColumnStatsFields, OrdinalColumnGroup, StringColumnGroup};

/// What the lower bounds of the bins of a histogram are
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinBounds {
    /// Numbers in the domain of the column
    Numbers,
    /// Milliseconds since epoch of a temporal column, since midnight of a time of day
    EpochMillis,
}

/// The analysis of the histogram of an ordinal column
#[derive(Clone, Debug)]
pub struct OrdinalColumnAnalysis {
    /// The rows, the selected rows of a filtered summary
    pub total_count: i64,
    /// The values that aren't null
    pub count_not_null: i64,
    /// The nulls
    pub count_null: i64,
    /// The minimum of all rows, one value in the type of the column
    pub min_value: ArrayRef,
    /// The maximum of all rows, one value in the type of the column
    pub max_value: ArrayRef,
    /// The bins without the bin of the nulls
    pub bin_count: u32,
    /// The values per bin
    pub bin_value_counts: Vec<i64>,
    /// The share of the rows per bin
    pub bin_percentages: Vec<f64>,
    /// The lower bound per bin
    pub bin_lower_bounds: Vec<Option<f64>>,
    /// What the lower bounds are
    pub bin_bounds: BinBounds,
}

// An ArrayRef compares by its data, the derive can't compare the Arc of a trait object
impl PartialEq for OrdinalColumnAnalysis {
    fn eq(&self, other: &Self) -> bool {
        self.total_count == other.total_count
            && self.count_not_null == other.count_not_null
            && self.count_null == other.count_null
            && self.min_value.as_ref() == other.min_value.as_ref()
            && self.max_value.as_ref() == other.max_value.as_ref()
            && self.bin_count == other.bin_count
            && self.bin_value_counts == other.bin_value_counts
            && self.bin_percentages == other.bin_percentages
            && self.bin_lower_bounds == other.bin_lower_bounds
            && self.bin_bounds == other.bin_bounds
    }
}

/// The analysis of the frequent values of a string column
#[derive(Clone, Debug, PartialEq)]
pub struct StringColumnAnalysis {
    /// The rows, the selected rows of a filtered summary
    pub total_count: i64,
    /// The values that aren't null
    pub count_not_null: i64,
    /// The nulls
    pub count_null: i64,
    /// The distinct values
    pub count_distinct: i64,
    /// Is every value distinct?
    pub is_unique: bool,
    /// The frequent values
    pub frequent_value_strings: Vec<Option<String>>,
    /// The ids of the frequent values, for the cross filters
    pub frequent_value_ids: Vec<i64>,
    /// The rows per frequent value
    pub frequent_value_counts: Vec<i64>,
    /// The share of the rows per frequent value
    pub frequent_value_percentages: Vec<f64>,
}

fn stats_fields<'a>(fields: &'a Option<ColumnStatsFields>, column: &str) -> Result<&'a ColumnStatsFields> {
    fields.as_ref().ok_or_else(|| Error::invalid_argument(format!("the column {column} has no statistics")))
}

fn share(count: i64, total: i64) -> f64 {
    if total == 0 {
        0.0
    } else {
        count as f64 / total as f64
    }
}

/// Analyze the binned values of an ordinal column: the rows `bin`, `count` and `binLowerBound` ordered by bin, with
/// the bin of the nulls last. A filtered summary counts the selected rows.
pub fn analyze_ordinal_column(
    stats: &TableStats,
    column: &OrdinalColumnGroup,
    column_type: &arrow_schema::DataType,
    binned_values: &ResultTable,
    filtered_total_count: Option<i64>,
) -> Result<OrdinalColumnAnalysis> {
    let fields = stats_fields(&column.stats_fields, &column.input_field_name)?;
    let unfiltered_total_count = stats.row_count()?;
    let total_count = filtered_total_count.unwrap_or(unfiltered_total_count);
    let min_field = fields.min_aggregate_field_name.as_deref().unwrap_or_default();
    let max_field = fields.max_aggregate_field_name.as_deref().unwrap_or_default();
    let min_value = stats.value(min_field)?;
    let max_value = stats.value(max_field)?;

    let counts = binned_values.int64_values(binned_values.require_column("count")?)?;
    let lower_bounds = binned_values.float64_values(binned_values.require_column("binLowerBound")?)?;

    let count_null = counts.last().copied().flatten().unwrap_or(0);
    let count_not_null = match filtered_total_count {
        None => total_count - count_null,
        Some(_) => unfiltered_total_count - count_null,
    };

    let bins = column.bin_count as usize;
    let bin_value_counts: Vec<i64> = (0..bins).map(|i| counts.get(i).copied().flatten().unwrap_or(0)).collect();
    let bin_percentages = bin_value_counts.iter().map(|count| share(*count, total_count)).collect();
    let bin_lower_bounds = (0..bins).map(|i| lower_bounds.get(i).copied().flatten()).collect();
    let bin_bounds = if is_temporal_type(column_type) { BinBounds::EpochMillis } else { BinBounds::Numbers };

    Ok(OrdinalColumnAnalysis {
        total_count,
        count_not_null,
        count_null,
        min_value,
        max_value,
        bin_count: column.bin_count,
        bin_value_counts,
        bin_percentages,
        bin_lower_bounds,
        bin_bounds,
    })
}

/// Analyze the frequent values of a string column: the rows `key`, `keyId` and `count`, most frequent first. A
/// filtered summary counts the selected rows.
pub fn analyze_string_column(
    stats: &TableStats,
    column: &StringColumnGroup,
    frequent_values: &ResultTable,
    filtered_total_count: Option<i64>,
) -> Result<StringColumnAnalysis> {
    let fields = stats_fields(&column.stats_fields, &column.input_field_name)?;
    let unfiltered_total_count = stats.row_count()?;
    let total_count = filtered_total_count.unwrap_or(unfiltered_total_count);
    let not_null_count = stats.count(&fields.count_field_name)?.unwrap_or(0);
    let distinct_field = fields.distinct_count_field_name.as_deref().unwrap_or_default();
    let distinct_count = stats.count(distinct_field)?.unwrap_or(0);

    let key_column = frequent_values.column_index("key").unwrap_or(0);
    let frequent_value_strings = frequent_values.string_values(key_column)?;
    let frequent_value_counts: Vec<i64> = frequent_values
        .int64_values(frequent_values.require_column("count")?)?
        .into_iter()
        .map(|count| count.unwrap_or(0))
        .collect();
    let key_ids = frequent_values
        .column_index("keyId")
        .ok_or_else(|| Error::invalid_argument("Missing keyId column in frequent values table"))?;
    let frequent_value_ids = frequent_values.int64_values(key_ids)?.into_iter().map(|id| id.unwrap_or(0)).collect();
    let frequent_value_percentages = frequent_value_counts.iter().map(|count| share(*count, total_count)).collect();

    Ok(StringColumnAnalysis {
        total_count,
        count_not_null: not_null_count,
        count_null: unfiltered_total_count - not_null_count,
        count_distinct: distinct_count,
        is_unique: not_null_count == distinct_count,
        frequent_value_strings,
        frequent_value_ids,
        frequent_value_counts,
        frequent_value_percentages,
    })
}
