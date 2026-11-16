//! The cross filters of a result: a selection in the summary of a column filters the rows of every view of the result.
//!
//! Ported from `packages/dashql/src/runtime/compute/cross_filters.ts`.

use std::collections::BTreeMap;

use super::types::{FilterOp, OrdinalColumnGroup, ScalarFilter, StringColumnGroup};

/// The selection in the summary of a column
#[derive(Clone, Debug, PartialEq)]
pub enum CrossFilterPredicate {
    /// A range of bins of a histogram
    Histogram {
        /// The first and the last bin
        selection: (f64, f64),
        /// The filters of the range
        filters: Vec<ScalarFilter>,
    },
    /// A frequent value
    MostFrequent {
        /// The id of the value
        value_id: i64,
        /// The filters of the value
        filters: Vec<ScalarFilter>,
    },
}

impl CrossFilterPredicate {
    /// The filters of the selection
    pub fn filters(&self) -> &[ScalarFilter] {
        match self {
            CrossFilterPredicate::Histogram { filters, .. } | CrossFilterPredicate::MostFrequent { filters, .. } => {
                filters
            }
        }
    }
}

/// The selections in the summaries of the columns of a result, by column group
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CrossFilters {
    /// The selections by column group
    pub column_filters: BTreeMap<u32, CrossFilterPredicate>,
}

impl CrossFilters {
    /// No selections
    pub fn new() -> Self {
        Self::default()
    }

    /// Do the filters select the same, the same ranges and the same values of the same columns? The filters that the
    /// selections derive are not compared.
    pub fn selects_same(&self, other: &CrossFilters) -> bool {
        self.column_filters.len() == other.column_filters.len()
            && self.column_filters.iter().all(|(column, a)| match (a, other.column_filters.get(column)) {
                (
                    CrossFilterPredicate::Histogram { selection: a, .. },
                    Some(CrossFilterPredicate::Histogram { selection: b, .. }),
                ) => a.0 == b.0 && a.1 == b.1,
                (
                    CrossFilterPredicate::MostFrequent { value_id: a, .. },
                    Some(CrossFilterPredicate::MostFrequent { value_id: b, .. }),
                ) => a == b,
                _ => false,
            })
    }

    /// The filters of all selections, in the order of the column groups
    pub fn filter_transforms(&self) -> Vec<ScalarFilter> {
        self.column_filters.values().flat_map(|predicate| predicate.filters().iter().cloned()).collect()
    }

    /// Does a column select a range of its histogram? Without a range: does the column select nothing?
    pub fn contains_histogram_filter(&self, column_group: u32, brush: Option<(f64, f64)>) -> bool {
        let existing = self.column_filters.get(&column_group);
        match (brush, existing) {
            (None, existing) => existing.is_none(),
            (Some(brush), Some(CrossFilterPredicate::Histogram { selection, .. })) => {
                selection.0 == brush.0 && selection.1 == brush.1
            }
            (Some(_), _) => false,
        }
    }

    /// Select a range of bins of the histogram of a column, none removes the selection of the column. The range
    /// filters on the bins of the column if it has them.
    pub fn add_histogram_filter(&mut self, column_group: u32, group: &OrdinalColumnGroup, brush: Option<(f64, f64)>) {
        let Some(brush) = brush else {
            self.column_filters.remove(&column_group);
            return;
        };
        let mut filters = Vec::new();
        if let Some(bin_field_name) = &group.bin_field_name {
            filters.push(ScalarFilter { field_name: bin_field_name.clone(), op: FilterOp::GreaterEqual, value: brush.0 });
            filters.push(ScalarFilter { field_name: bin_field_name.clone(), op: FilterOp::LessEqual, value: brush.1 });
        }
        self.column_filters.insert(column_group, CrossFilterPredicate::Histogram { selection: brush, filters });
    }

    /// Does a column select a frequent value? Without a value: does the column select nothing?
    pub fn contains_most_frequent_value_filter(&self, column_group: u32, value_id: Option<i64>) -> bool {
        let existing = self.column_filters.get(&column_group);
        match value_id {
            None => existing.is_none(),
            Some(value_id) => {
                matches!(existing, Some(CrossFilterPredicate::MostFrequent { value_id: selected, .. }) if *selected == value_id)
            }
        }
    }

    /// Select a frequent value of a column, none removes the selection of the column. A column without value ids
    /// can't select a value.
    pub fn add_most_frequent_value_filter(&mut self, column_group: u32, group: &StringColumnGroup, value_id: Option<i64>) {
        let Some(value_id) = value_id else {
            self.column_filters.remove(&column_group);
            return;
        };
        let Some(value_id_field_name) = &group.value_id_field_name else {
            return;
        };
        let filters =
            vec![ScalarFilter { field_name: value_id_field_name.clone(), op: FilterOp::Equal, value: value_id as f64 }];
        self.column_filters.insert(column_group, CrossFilterPredicate::MostFrequent { value_id, filters });
    }
}
