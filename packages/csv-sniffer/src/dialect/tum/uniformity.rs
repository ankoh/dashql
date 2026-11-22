//! Table uniformity calculations (`tau_0`, `tau_1`).
//!
//! These metrics measure how uniform a parsed CSV table is:
//! - `tau_0` (consistency): measures if all rows have the same number of fields
//! - `tau_1` (dispersion): measures the variability of field counts

use super::table::Table;

/// Calculate `tau_0` (consistency score).
///
/// This measures how consistent the field counts are across rows.
/// Formula: `tau_0` = 1 / (1 + 2 * sigma)
/// where sigma is the standard deviation of field counts.
///
/// Returns a value between 0 and 1, where 1 means perfect consistency.
pub fn calculate_tau_0(table: &Table) -> f64 {
    if table.field_counts.is_empty() {
        return 0.0;
    }

    let sigma = standard_deviation(&table.field_counts);

    // tau_0 = 1 / (1 + 2 * sigma)
    // 1.0 / (1.0 + 2.0 * sigma)
    1.0 / 2.0f64.mul_add(sigma, 1.0)
}

/// Calculate `tau_1` (dispersion score).
///
/// This measures the variability in field counts using multiple factors:
/// - Range of field counts
/// - Number of transitions between different field counts
/// - Dominance of the modal (most common) field count
///
/// Returns a value between 0 and 1, where 1 means low dispersion (good).
pub fn calculate_tau_1(table: &Table) -> f64 {
    if table.field_counts.is_empty() {
        return 0.0;
    }

    let n = table.field_counts.len();
    if n == 1 {
        return 1.0; // Single row is perfectly uniform
    }

    // 1. Range component: penalize wide range of field counts
    let min_fc = table.min_field_count();
    let max_fc = table.max_field_count();
    let range = max_fc - min_fc;

    let range_score = if max_fc == 0 { 0.0 } else { 1.0 - (range as f64 / max_fc as f64).min(1.0) };

    // 2. Transition component: count changes between consecutive rows
    let mut transitions = 0;
    for pair in table.field_counts.windows(2) {
        if matches!(pair, [a, b] if a != b) {
            transitions += 1;
        }
    }
    let transition_score = 1.0 - (transitions as f64 / (n - 1) as f64);

    // 3. Mode dominance: fraction of rows with the modal field count
    let mode_count = table.modal_field_count_freq();
    let mode_score = mode_count as f64 / n as f64;

    // Combine components with weights
    // Range and mode are most important, transitions provide additional signal
    // range_score * 0.3 + transition_score * 0.3 + mode_score * 0.4
    mode_score.mul_add(0.4, range_score * 0.3 + transition_score * 0.3)
}

/// Calculate the combined uniformity score.
///
/// This combines `tau_0` and `tau_1` into a single uniformity measure.
#[allow(dead_code)]
pub fn calculate_uniformity(table: &Table) -> f64 {
    let tau_0 = calculate_tau_0(table);
    let tau_1 = calculate_tau_1(table);

    // Geometric mean gives a balanced combination
    (tau_0 * tau_1).sqrt()
}

/// Calculate standard deviation of field counts.
fn standard_deviation(values: &[usize]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }

    let n = values.len() as f64;
    let mean: f64 = values.iter().sum::<usize>() as f64 / n;

    let variance: f64 = values
        .iter()
        .map(|&v| {
            let diff = v as f64 - mean;
            diff * diff
        })
        .sum::<f64>()
        / n;

    variance.sqrt()
}

/// Check if a table has uniform field counts (all rows same number of fields).
pub fn is_uniform(table: &Table) -> bool {
    let Some(&first) = table.field_counts.first() else {
        return true;
    };
    table.field_counts.iter().all(|&fc| fc == first)
}

/// Get statistics about the table's field count distribution.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct FieldCountStats {
    pub min: usize,
    pub max: usize,
    pub mode: usize,
    pub mean: f64,
    pub std_dev: f64,
    pub is_uniform: bool,
}

impl FieldCountStats {
    /// Calculate field count statistics for a table.
    #[allow(dead_code)]
    pub fn from_table(table: &Table) -> Self {
        let min = table.min_field_count();
        let max = table.max_field_count();
        let mode = table.modal_field_count();
        let mean = if table.field_counts.is_empty() {
            0.0
        } else {
            table.field_counts.iter().sum::<usize>() as f64 / table.field_counts.len() as f64
        };
        let std_dev = standard_deviation(&table.field_counts);
        let is_uniform_val = is_uniform(table);

        Self { min, max, mode, mean, std_dev, is_uniform: is_uniform_val }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tau_0_uniform() {
        let mut table = Table::new();
        table.field_counts = vec![3, 3, 3, 3, 3];
        table.update_modal_field_count();

        let tau_0 = calculate_tau_0(&table);
        assert!((tau_0 - 1.0).abs() < 0.001); // Should be 1.0 for uniform counts
    }

    #[test]
    fn test_tau_0_varied() {
        let mut table = Table::new();
        table.field_counts = vec![3, 4, 3, 5, 3];
        table.update_modal_field_count();

        let tau_0 = calculate_tau_0(&table);
        assert!(tau_0 < 1.0); // Should be less than 1.0 for varied counts
        assert!(tau_0 > 0.0);
    }

    #[test]
    fn test_tau_1_uniform() {
        let mut table = Table::new();
        table.field_counts = vec![3, 3, 3, 3, 3];
        table.update_modal_field_count();

        let tau_1 = calculate_tau_1(&table);
        assert!((tau_1 - 1.0).abs() < 0.001); // Should be 1.0 for uniform counts
    }

    #[test]
    fn test_is_uniform() {
        let mut uniform_table = Table::new();
        uniform_table.field_counts = vec![3, 3, 3];
        uniform_table.update_modal_field_count();
        assert!(is_uniform(&uniform_table));

        let mut varied_table = Table::new();
        varied_table.field_counts = vec![3, 4, 3];
        varied_table.update_modal_field_count();
        assert!(!is_uniform(&varied_table));
    }
}
