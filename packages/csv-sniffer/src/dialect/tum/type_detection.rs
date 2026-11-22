//! Type detection for CSV cells using optimized string operations.

use super::regexes::*;
use super::table::Table;
use crate::dialect::field_type::Type;

/// Check for NULL-like values using string matching instead of regex.
/// This is a hot path optimization - called for every cell.
#[inline]
fn is_null_value(s: &str) -> bool {
    matches!(
        s,
        "" | "-"
            | "--"
            | "."
            | ".."
            | "?"
            | "null"
            | "NULL"
            | "Null"
            | "nil"
            | "NIL"
            | "Nil"
            | "none"
            | "NONE"
            | "None"
            | "na"
            | "NA"
            | "Na"
            | "n/a"
            | "N/A"
            | "N/a"
            | "nan"
            | "NaN"
            | "NAN"
            | "#N/A"
            | "#VALUE!"
            | "#REF!"
            | "#DIV/0!"
    )
}

/// Check for unsigned integer using string parsing instead of regex.
/// This is a hot path optimization - called for every cell.
/// Limit to 19 digits to ensure all values fit in u64 (max is 18,446,744,073,709,551,615).
#[inline]
fn is_unsigned_int(s: &str) -> bool {
    let s = s.strip_prefix('+').unwrap_or(s);
    !s.is_empty() && s.len() <= 19 && s.bytes().all(|b| b.is_ascii_digit())
}

/// Check for signed integer using string parsing instead of regex.
/// Returns true only for negative integers (positive ones are unsigned).
/// Limit to 19 digits to ensure all values fit in i64 (min is -9,223,372,036,854,775,808).
#[inline]
fn is_signed_int(s: &str) -> bool {
    if let Some(rest) = s.strip_prefix('-') {
        !rest.is_empty() && rest.len() <= 19 && rest.bytes().all(|b| b.is_ascii_digit())
    } else {
        false
    }
}

/// Check for boolean values using exhaustive match instead of regex.
/// This is a hot path optimization - called for every cell.
#[inline]
fn is_boolean(s: &str) -> bool {
    match s.len() {
        1 => {
            let b = s.as_bytes().first().map_or(0, u8::to_ascii_lowercase);
            matches!(b, b'1' | b'0' | b'y' | b'n' | b't' | b'f')
        }
        2 => s.eq_ignore_ascii_case("on") || s.eq_ignore_ascii_case("no"),
        3 => s.eq_ignore_ascii_case("yes") || s.eq_ignore_ascii_case("off"),
        4 => s.eq_ignore_ascii_case("true"),
        5 => s.eq_ignore_ascii_case("false"),
        _ => false,
    }
}

/// `is_match` of a shared pattern. The sniffer runs on one thread (csv-nose scored the dialects on rayon workers with a
/// clone of each pattern per thread), and a pattern that failed to compile matches nothing.
macro_rules! tl_is_match {
    ($pat:ident, $s:expr) => {{
        $pat.as_ref().is_some_and(|re| re.is_match($s))
    }};
}

/// Detect the type of a single cell value.
#[inline]
pub fn detect_cell_type(value: &str) -> Type {
    let trimmed = value.trim();

    // Check for empty first
    if trimmed.is_empty() {
        return Type::NULL;
    }

    // Check for NULL-like values using optimized string matching
    if is_null_value(trimmed) {
        return Type::NULL;
    }

    // Check for unsigned integer (must come before boolean since 1/0 match boolean)
    if is_unsigned_int(trimmed) {
        return Type::Unsigned;
    }

    // Check for signed integer (negative numbers only)
    if is_signed_int(trimmed) {
        return Type::Signed;
    }

    // Check for boolean (after integers so "1" and "0" are treated as numbers)
    if is_boolean(trimmed) {
        return Type::Boolean;
    }

    // Check for float - gate regex with cheap string checks first.
    // This path is only reached after integer detection, so plain integers
    // have already been classified and do not rely on FLOAT_PATTERN. The gate
    // also skips representations like NaN/Inf, which lack both a decimal point
    // and an exponent marker and are therefore not matched here.
    let has_dot = trimmed.contains('.');
    let has_exp = trimmed.contains('e') || trimmed.contains('E');
    if (has_dot || has_exp) && tl_is_match!(FLOAT_PATTERN, trimmed) {
        return Type::Float;
    }

    // Check for float with thousand separators
    if (trimmed.contains(',') || has_dot) && tl_is_match!(FLOAT_THOUSANDS_PATTERN, trimmed) {
        return Type::Float;
    }

    // Check for ISO datetime first (more specific)
    if tl_is_match!(DATETIME_ISO_PATTERN, trimmed) || tl_is_match!(DATETIME_GENERAL_PATTERN, trimmed) {
        return Type::DateTime;
    }

    // Check for dates
    if tl_is_match!(DATE_ISO_PATTERN, trimmed)
        || tl_is_match!(DATE_US_PATTERN, trimmed)
        || tl_is_match!(DATE_EURO_PATTERN, trimmed)
    {
        return Type::Date;
    }

    // Fallback to text
    Type::Text
}

/// Reusable buffers for `calculate_type_score` to avoid per-call heap allocations.
pub struct TypeScoreBuffers {
    pub col_type_counts: Vec<[usize; Type::COUNT]>,
    pub col_totals: Vec<usize>,
}

impl Default for TypeScoreBuffers {
    fn default() -> Self {
        Self::new()
    }
}

impl TypeScoreBuffers {
    pub fn new() -> Self {
        Self { col_type_counts: Vec::new(), col_totals: Vec::new() }
    }

    pub fn reset(&mut self, num_cols: usize) {
        self.col_type_counts.clear();
        self.col_type_counts.resize(num_cols, [0usize; Type::COUNT]);
        self.col_totals.clear();
        self.col_totals.resize(num_cols, 0);
    }
}

/// Calculate the type score for a table.
///
/// This score measures how well the values in each column conform to
/// consistent data types. Higher scores indicate better type consistency.
///
/// Optimized: Single pass through all cells, tracking type counts for all columns simultaneously.
/// Accepts reusable `buffers` to avoid per-call heap allocations.
pub fn calculate_type_score(table: &Table, buffers: &mut TypeScoreBuffers) -> f64 {
    if table.is_empty() {
        return 0.0;
    }

    let num_cols = table.modal_field_count();
    if num_cols == 0 {
        return 0.0;
    }

    // Track type counts for ALL columns in one pass using reusable buffers
    buffers.reset(num_cols);

    // Single pass through all rows and cells
    for row in &table.rows {
        for ((cell, counts), total) in
            row.iter().zip(buffers.col_type_counts.iter_mut()).zip(buffers.col_totals.iter_mut()).take(num_cols)
        {
            let cell_type = detect_cell_type(cell);
            if let Some(count) = counts.get_mut(cell_type.as_index()) {
                *count += 1;
            }
            *total += 1;
        }
    }

    // Calculate scores from accumulated counts
    let mut total_score = 0.0;
    let mut valid_cols = 0;

    for (counts, &total) in buffers.col_type_counts.iter().zip(&buffers.col_totals).take(num_cols) {
        let score = compute_consistency_from_counts(counts, total);
        if score > 0.0 {
            total_score += score;
            valid_cols += 1;
        }
    }

    if valid_cols == 0 {
        return 0.0;
    }

    total_score / valid_cols as f64
}

/// Compute type consistency score from pre-computed type counts.
#[inline]
fn compute_consistency_from_counts(type_counts: &[usize; Type::COUNT], total_cells: usize) -> f64 {
    if total_cells == 0 {
        return 0.0;
    }

    // Special handling: NULL values shouldn't penalize the score
    let null_count = type_counts.get(Type::NULL.as_index()).copied().unwrap_or(0);
    let non_null_total = total_cells - null_count;

    if non_null_total == 0 {
        // All nulls - neutral score
        return 0.5;
    }

    // Calculate consistency excluding nulls
    let max_non_null =
        type_counts.iter().enumerate().filter(|&(i, _)| i != Type::NULL.as_index()).map(|(_, &c)| c).max().unwrap_or(0);

    max_non_null as f64 / non_null_total as f64
}

/// Infer the type for each of the first `num_cols` columns of `rows`.
///
/// `Type::merge` is a join (associative and commutative, with `NULL` as identity), so the order of the rows doesn't
/// matter.
pub fn infer_column_types(rows: &[Vec<String>], num_cols: usize) -> Vec<Type> {
    let mut types = vec![Type::NULL; num_cols];
    for row in rows {
        for (merged, cell) in types.iter_mut().zip(row) {
            *merged = merged.merge(detect_cell_type(cell));
        }
    }
    types
}

pub fn pattern_specificity_score(value: &str) -> f64 {
    // One `RegexSet` scan replaces the ordered per-pattern loop: the lowest
    // matching index is exactly the first pattern the loop would have hit.
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return 0.0;
    }

    let Some(set) = PATTERN_SET.as_ref() else {
        return 0.1;
    };
    set.matches(trimmed).iter().next().and_then(|i| get_pattern_categories().get(i)).map_or(0.1, |pc| pc.weight)
    // Text fallback: lowest specificity
}

/// Calculate the average pattern specificity score for a table.
pub fn calculate_pattern_score(table: &Table) -> f64 {
    if table.is_empty() {
        return 0.0;
    }

    let mut total_score = 0.0;
    let mut count = 0;

    for row in &table.rows {
        for cell in row {
            total_score += pattern_specificity_score(cell);
            count += 1;
        }
    }

    if count == 0 {
        return 0.0;
    }

    total_score / count as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_cell_type() {
        assert_eq!(detect_cell_type("123"), Type::Unsigned);
        assert_eq!(detect_cell_type("-123"), Type::Signed);
        assert_eq!(detect_cell_type("12.34"), Type::Float);
        assert_eq!(detect_cell_type("true"), Type::Boolean);
        assert_eq!(detect_cell_type("2023-12-31"), Type::Date);
        assert_eq!(detect_cell_type("2023-12-31T12:30:45"), Type::DateTime);
        assert_eq!(detect_cell_type("hello"), Type::Text);
        assert_eq!(detect_cell_type(""), Type::NULL);
        assert_eq!(detect_cell_type("NULL"), Type::NULL);
    }

    #[test]
    fn test_infer_column_types() {
        let mut table = Table::new();
        table.rows = vec![
            vec!["1".to_string(), "hello".to_string(), "2023-01-01".to_string()],
            vec!["2".to_string(), "world".to_string(), "2023-01-02".to_string()],
            vec!["3".to_string(), "test".to_string(), "2023-01-03".to_string()],
        ];
        table.field_counts = vec![3, 3, 3];
        table.update_modal_field_count();

        let types = infer_column_types(&table.rows, table.modal_field_count());
        assert_eq!(types, vec![Type::Unsigned, Type::Text, Type::Date]);
    }

    #[test]
    fn test_infer_column_types_matches_per_column_fold() {
        // The type-promoting cells spread over the rows, and ragged rows.
        let n = 6000;
        let rows: Vec<Vec<String>> = (0..n)
            .map(|i| {
                let promote = match i {
                    10 => "-7",    // Signed, first chunk
                    3000 => "2.5", // Float, middle chunk
                    _ => "42",     // Unsigned
                };
                let temporal = match i {
                    20 => "2023-12-31T12:30:45", // DateTime, first chunk
                    5900 => "2023-12-31",        // Date, last chunk
                    _ => "",                     // NULL
                };
                let mixed = if i == 5990 { "true" } else { "7" }; // Boolean + Unsigned -> Text
                let mut row = vec![promote.to_string(), temporal.to_string(), String::new()];
                match i % 7 {
                    0 => {}                                          // short row: no 4th column
                    1 => row.extend([mixed.into(), "extra".into()]), // longer than num_cols
                    _ => row.push(mixed.into()),
                }
                row
            })
            .collect();
        let num_cols = 4;

        let sequential: Vec<Type> = (0..num_cols)
            .map(|c| rows.iter().filter_map(|r| r.get(c)).fold(Type::NULL, |t, cell| t.merge(detect_cell_type(cell))))
            .collect();
        assert_eq!(sequential, vec![Type::Float, Type::DateTime, Type::NULL, Type::Text]);

        assert_eq!(infer_column_types(&rows, num_cols), sequential);
    }

    #[test]
    fn test_pattern_specificity_matches_ordered_loop() {
        // The RegexSet must pick the same weight as checking each pattern in
        // order and returning the first match.
        fn ordered(value: &str) -> f64 {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return 0.0;
            }
            get_pattern_categories()
                .iter()
                .find(|pc| pc.pattern.as_ref().is_some_and(|re| re.is_match(trimmed)))
                .map_or(0.1, |pc| pc.weight)
        }

        let cells = [
            "",
            "   ",
            "NULL",
            "null",
            "Nil",
            "N/A",
            "#DIV/0!",
            "-",
            "true",
            "FALSE",
            "yes",
            "y",
            "1",
            "0",
            "42",
            "+42",
            "-42",
            "3.14",
            "-1e10",
            ".5",
            "1,5",
            "1,234,567.89",
            "2023-12-31",
            "12/31/2023",
            "31.12.2023",
            "2023-12-31T12:30:45Z",
            "2023/1/2 3:04 PM",
            "12:30",
            "12:30:45.5 am",
            "a@b.com",
            "https://x.org/p?q=1",
            "192.168.0.1",
            "$1,234.50",
            "100 €",
            "45%",
            "-3.5 %",
            "123e4567-e89b-12d3-a456-426614174000",
            "abc_123",
            "Alice",
            "Smith, John",
            "free text with spaces",
            "  padded  ",
        ];
        for c in cells {
            assert_eq!(pattern_specificity_score(c), ordered(c), "cell {c:?}");
        }
    }
}
