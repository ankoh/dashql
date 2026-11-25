//! The cross filters of a result: a selection in the summary of a column filters the rows of every view of the result.

use std::collections::BTreeMap;

use super::types::{FilterOp, OrdinalColumnGroup, RowFilter, ScalarFilter, StringColumnGroup};

/// The selection in the summary of a column
#[derive(Clone, Debug, PartialEq)]
pub enum CrossFilterPredicate {
    /// A range of bins of a histogram
    Histogram {
        /// The first and the last bin
        selection: (f64, f64),
        /// The filters of the range
        filters: Vec<RowFilter>,
    },
    /// Frequent values, distinct values of the column
    MostFrequent {
        /// The ids of the values, ascending without duplicates, never empty
        value_ids: Vec<i64>,
        /// The filters of the values
        filters: Vec<RowFilter>,
    },
}

impl CrossFilterPredicate {
    /// The filters of the selection
    pub fn filters(&self) -> &[RowFilter] {
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
                    CrossFilterPredicate::MostFrequent { value_ids: a, .. },
                    Some(CrossFilterPredicate::MostFrequent { value_ids: b, .. }),
                ) => a == b,
                _ => false,
            })
    }

    /// The filters of all selections, in the order of the column groups
    pub fn filter_transforms(&self) -> Vec<RowFilter> {
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
            filters.push(RowFilter::Scalar(ScalarFilter {
                field_name: bin_field_name.clone(),
                op: FilterOp::GreaterEqual,
                value: brush.0,
            }));
            filters.push(RowFilter::Scalar(ScalarFilter {
                field_name: bin_field_name.clone(),
                op: FilterOp::LessEqual,
                value: brush.1,
            }));
        }
        self.column_filters.insert(column_group, CrossFilterPredicate::Histogram { selection: brush, filters });
    }

    /// The ids of the frequent values that a column selects, ascending, empty without a selection
    pub fn most_frequent_values(&self, column_group: u32) -> &[i64] {
        match self.column_filters.get(&column_group) {
            Some(CrossFilterPredicate::MostFrequent { value_ids, .. }) => value_ids,
            _ => &[],
        }
    }

    /// Select frequent values of a column by their ids, no ids remove the selection of the column. The values filter
    /// with `IN` on the value ids of the column, with `=` for one. A column without value ids can't select values.
    pub fn set_most_frequent_values(&mut self, column_group: u32, group: &StringColumnGroup, value_ids: &[i64]) {
        let mut value_ids = value_ids.to_vec();
        value_ids.sort_unstable();
        value_ids.dedup();
        if value_ids.is_empty() {
            self.column_filters.remove(&column_group);
            return;
        }
        let Some(value_id_field_name) = &group.value_id_field_name else {
            return;
        };
        let filters = vec![RowFilter::In { field_name: value_id_field_name.clone(), values: value_ids.clone() }];
        self.column_filters.insert(column_group, CrossFilterPredicate::MostFrequent { value_ids, filters });
    }

    /// Toggle a frequent value of a column, a click on it: the value joins the selection of the column or leaves it,
    /// the last value that leaves clears it. None clears the selection.
    pub fn select_most_frequent_value(&mut self, column_group: u32, group: &StringColumnGroup, value_id: Option<i64>) {
        let Some(value_id) = value_id else {
            self.column_filters.remove(&column_group);
            return;
        };
        let selected = self.most_frequent_values(column_group);
        let value_ids: Vec<i64> = if selected.contains(&value_id) {
            selected.iter().copied().filter(|selected| *selected != value_id).collect()
        } else {
            selected.iter().copied().chain([value_id]).collect()
        };
        self.set_most_frequent_values(column_group, group, &value_ids);
    }
}
