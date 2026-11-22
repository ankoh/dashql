//! CSV parsing into a table structure for analysis.

use super::potential_dialects::PotentialDialect;
use crate::dialect::metadata::Quote;
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{BufRead, Cursor};

/// A parsed CSV table for analysis.
#[derive(Debug, Clone)]
pub struct Table {
    /// The rows of the table (each row is a vector of field values).
    pub rows: Vec<Vec<String>>,
    /// Number of fields in each row.
    pub field_counts: Vec<usize>,
    /// Cached modal (most common) field count, computed during parsing.
    cached_modal_field_count: usize,
    /// Cached frequency of the modal field count.
    cached_modal_field_count_freq: usize,
}

impl Table {
    /// Create a new empty table.
    pub const fn new() -> Self {
        Self {
            rows: Vec::new(),
            field_counts: Vec::new(),
            cached_modal_field_count: 0,
            cached_modal_field_count_freq: 0,
        }
    }

    /// Returns true if the table is empty.
    #[inline]
    pub const fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Returns the number of rows.
    #[inline]
    pub const fn num_rows(&self) -> usize {
        self.rows.len()
    }

    /// Returns the modal (most common) field count.
    /// Uses cached value computed during parsing for efficiency.
    #[inline]
    pub const fn modal_field_count(&self) -> usize {
        self.cached_modal_field_count
    }

    /// Compute the modal field count and its frequency from field_counts.
    /// Called internally after parsing or when constructing tables manually.
    ///
    /// Optimized: Uses a frequency array for small field counts (≤256),
    /// falling back to HashMap for unusually wide tables.
    /// Returns `(modal_field_count, frequency)`.
    pub(crate) fn compute_modal_field_count(field_counts: &[usize]) -> (usize, usize) {
        if field_counts.is_empty() {
            return (0, 0);
        }

        let max_fc = field_counts.iter().copied().max().unwrap_or(0);

        // Use array for small field counts (most common case), HashMap for large
        if max_fc <= 256 {
            // Fast path: use fixed-size array
            let mut freq = [0usize; 257];
            for &fc in field_counts {
                if let Some(count) = freq.get_mut(fc) {
                    *count += 1;
                }
            }

            // Find the modal field count with deterministic tie-breaking
            // (prefer higher field count when frequencies are equal)
            let mut best_fc = 0;
            let mut best_count = 0;
            for (fc, &count) in freq.iter().enumerate() {
                if count > best_count || (count == best_count && fc > best_fc) {
                    best_fc = fc;
                    best_count = count;
                }
            }
            (best_fc, best_count)
        } else {
            // Fallback to HashMap for unusually wide tables
            let mut counts: HashMap<usize, usize> = HashMap::with_capacity(field_counts.len());
            for &fc in field_counts {
                *counts.entry(fc).or_insert(0) += 1;
            }

            // Use deterministic tie-breaking: prefer higher field count when frequencies are equal
            // This ensures consistent results regardless of HashMap iteration order
            counts
                .into_iter()
                .max_by(|(fc_a, count_a), (fc_b, count_b)| count_a.cmp(count_b).then_with(|| fc_a.cmp(fc_b)))
                .unwrap_or((0, 0))
        }
    }

    /// Update the cached modal field count and its frequency. Call after modifying field_counts.
    pub fn update_modal_field_count(&mut self) {
        let (modal, freq) = Self::compute_modal_field_count(&self.field_counts);
        self.cached_modal_field_count = modal;
        self.cached_modal_field_count_freq = freq;
    }

    /// Returns the frequency of the modal (most common) field count.
    #[inline]
    pub const fn modal_field_count_freq(&self) -> usize {
        self.cached_modal_field_count_freq
    }

    /// Returns the minimum field count.
    #[inline]
    pub fn min_field_count(&self) -> usize {
        self.field_counts.iter().copied().min().unwrap_or(0)
    }

    /// Returns the maximum field count.
    #[inline]
    pub fn max_field_count(&self) -> usize {
        self.field_counts.iter().copied().max().unwrap_or(0)
    }
}

impl Default for Table {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse data into a table using the given dialect.
///
/// # Arguments
/// * `data` - The raw CSV data bytes
/// * `dialect` - The dialect to use for parsing
/// * `max_rows` - Maximum number of rows to parse (0 = unlimited)
pub fn parse_table(data: &[u8], dialect: &PotentialDialect, max_rows: usize) -> Table {
    // Normalize line endings for this dialect
    let normalized = normalize_line_endings(data, dialect);
    parse_table_impl(&normalized, dialect, max_rows)
}

/// Parse data into a table assuming line endings are already normalized to LF.
///
/// This function skips line ending normalization for performance when the caller
/// has already normalized the data (e.g., in `score_all_dialects_with_best_table`).
///
/// # Arguments
/// * `data` - The CSV data bytes with LF-normalized line endings
/// * `dialect` - The dialect to use for parsing
/// * `max_rows` - Maximum number of rows to parse (0 = unlimited)
pub(crate) fn parse_table_normalized(data: &[u8], dialect: &PotentialDialect, max_rows: usize) -> Table {
    parse_table_impl(data, dialect, max_rows)
}

/// Internal implementation of table parsing.
///
/// # Arguments
/// * `data` - The CSV data bytes (should have LF line endings)
/// * `dialect` - The dialect to use for parsing
/// * `max_rows` - Maximum number of rows to parse (0 = unlimited)
fn parse_table_impl<D: AsRef<[u8]>>(data: D, dialect: &PotentialDialect, max_rows: usize) -> Table {
    let mut table = Table::new();

    // Build CSV reader with the dialect settings
    let mut reader_builder = csv::ReaderBuilder::new();
    reader_builder.delimiter(dialect.delimiter).has_headers(false).flexible(true).buffer_capacity(32768); // 32KB buffer

    // Configure quoting
    match dialect.quote {
        Quote::None => {
            reader_builder.quoting(false);
        }
        Quote::Some(q) => {
            reader_builder.quoting(true);
            reader_builder.quote(q);
        }
    }

    let cursor = Cursor::new(data);
    let mut reader = reader_builder.from_reader(cursor);

    let mut record = csv::StringRecord::new();
    let limit = if max_rows == 0 { usize::MAX } else { max_rows };

    while table.rows.len() < limit {
        match reader.read_record(&mut record) {
            Ok(true) => {
                let row: Vec<String> = record.iter().map(std::string::ToString::to_string).collect();
                let field_count = row.len();
                table.rows.push(row);
                table.field_counts.push(field_count);
            }
            Ok(false) => break, // EOF
            Err(_) => break,    // Parse error, stop here
        }
    }

    // Cache the modal field count for efficient repeated access
    table.update_modal_field_count();

    table
}

/// Normalize line endings to LF for consistent parsing.
/// Returns `Cow::Borrowed` for LF data (zero-copy) and `Cow::Owned` for CR/CRLF.
fn normalize_line_endings<'a>(data: &'a [u8], dialect: &PotentialDialect) -> Cow<'a, [u8]> {
    use super::potential_dialects::LineTerminator;

    match dialect.line_terminator {
        LineTerminator::LF => Cow::Borrowed(data), // Zero-copy for LF
        LineTerminator::CRLF => {
            // Replace \r\n with \n
            let mut result = Vec::with_capacity(data.len());
            let mut bytes = data.iter().copied().peekable();
            while let Some(byte) = bytes.next() {
                if byte == b'\r' && bytes.peek() == Some(&b'\n') {
                    continue;
                }
                result.push(byte);
            }
            Cow::Owned(result)
        }
        LineTerminator::CR => {
            // Replace standalone \r with \n
            Cow::Owned(data.iter().map(|&b| if b == b'\r' { b'\n' } else { b }).collect())
        }
    }
}

/// Simple line-based parser for when csv crate fails.
///
/// This is a fallback parser that handles edge cases the csv crate might reject.
#[allow(dead_code)]
pub fn parse_table_simple(data: &[u8], dialect: &PotentialDialect, max_rows: usize) -> Table {
    let mut table = Table::new();
    let normalized = normalize_line_endings(data, dialect);

    let cursor = Cursor::new(normalized.as_ref());
    let limit = if max_rows == 0 { usize::MAX } else { max_rows };

    for line in cursor.lines().take(limit) {
        let Ok(line) = line else { continue };
        if line.is_empty() {
            continue;
        }

        let fields = split_line(&line, dialect);
        let field_count = fields.len();
        table.rows.push(fields);
        table.field_counts.push(field_count);
    }

    // Cache the modal field count for efficient repeated access
    table.update_modal_field_count();

    table
}

/// Split a line into fields based on the dialect.
#[allow(dead_code)]
fn split_line(line: &str, dialect: &PotentialDialect) -> Vec<String> {
    let delimiter = dialect.delimiter as char;
    let quote_char = match dialect.quote {
        Quote::None => None,
        Quote::Some(q) => Some(q as char),
    };

    let mut fields = Vec::new();
    let mut current_field = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(c) = chars.next() {
        if let Some(q) = quote_char.filter(|q| c == *q) {
            if in_quotes {
                // Check for escaped quote (doubled quote)
                if chars.peek() == Some(&q) {
                    current_field.push(q);
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                in_quotes = true;
            }
            continue;
        }

        if c == delimiter && !in_quotes {
            fields.push(current_field.trim().to_string());
            current_field = String::new();
        } else {
            current_field.push(c);
        }
    }

    fields.push(current_field.trim().to_string());
    fields
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::tum::potential_dialects::LineTerminator;

    #[test]
    fn test_parse_simple_csv() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";
        let dialect = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);

        let table = parse_table(data, &dialect, 0);
        assert_eq!(table.num_rows(), 3);
        assert_eq!(table.field_counts, vec![3, 3, 3]);
        assert_eq!(table.rows[0], vec!["a", "b", "c"]);
    }

    #[test]
    fn test_parse_quoted_csv() {
        let data = b"\"a,b\",c,d\n1,2,3\n";
        let dialect = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);

        let table = parse_table(data, &dialect, 0);
        assert_eq!(table.num_rows(), 2);
        assert_eq!(table.rows[0], vec!["a,b", "c", "d"]);
    }

    #[test]
    fn test_modal_field_count() {
        let mut table = Table::new();
        table.field_counts = vec![3, 3, 3, 4, 3];
        table.update_modal_field_count();
        assert_eq!(table.modal_field_count(), 3);
    }
}
