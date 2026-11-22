//! Main Sniffer builder and sniff methods.
//!
//! The sniffer works on a sample of the file in memory, the first bytes of a file that the caller read.

use crate::dialect::encoding::{detect_and_transcode, skip_bom};
use crate::dialect::error::{Result, SnifferError};
use crate::dialect::field_type::Type;
use crate::dialect::metadata::{Dialect, Header, Metadata, Quote};
use crate::dialect::sample::{DatePreference, SampleSize};
use crate::dialect::tum::potential_dialects::{
    detect_line_terminator, generate_dialects_with_terminator, PotentialDialect,
};
use crate::dialect::tum::score::{find_best_dialect, score_all_dialects_with_best_table, DialectScore};
use crate::dialect::tum::table::{parse_table, Table};
use crate::dialect::tum::type_detection::infer_column_types;

/// CSV dialect sniffer using the Table Uniformity Method.
///
/// # Example
///
/// ```
/// use csv_sniffer::dialect::{Sniffer, SampleSize};
///
/// let mut sniffer = Sniffer::new();
/// sniffer.sample_size(SampleSize::Records(100));
///
/// let metadata = sniffer.sniff_bytes(b"a,b\n1,2\n").unwrap();
/// println!("Delimiter: {}", metadata.dialect.delimiter as char);
/// println!("Has header: {}", metadata.dialect.header.has_header_row);
/// ```
#[derive(Debug, Clone)]
pub struct Sniffer {
    /// Sample size for sniffing.
    sample_size: SampleSize,
    /// Date format preference for ambiguous dates.
    date_preference: DatePreference,
    /// Optional forced delimiter.
    forced_delimiter: Option<u8>,
    /// Optional forced quote character.
    forced_quote: Option<Quote>,
}

impl Default for Sniffer {
    fn default() -> Self {
        Self::new()
    }
}

impl Sniffer {
    /// Create a new Sniffer with default settings.
    pub const fn new() -> Self {
        Self {
            sample_size: SampleSize::Records(100),
            date_preference: DatePreference::MdyFormat,
            forced_delimiter: None,
            forced_quote: None,
        }
    }

    /// Set the sample size for sniffing.
    pub fn sample_size(&mut self, sample_size: SampleSize) -> &mut Self {
        self.sample_size = sample_size;
        self
    }

    /// Set the date preference for ambiguous date parsing.
    pub fn date_preference(&mut self, date_preference: DatePreference) -> &mut Self {
        self.date_preference = date_preference;
        self
    }

    /// Force a specific delimiter (skip delimiter detection).
    pub fn delimiter(&mut self, delimiter: u8) -> &mut Self {
        self.forced_delimiter = Some(delimiter);
        self
    }

    /// Force a specific quote character.
    pub fn quote(&mut self, quote: Quote) -> &mut Self {
        self.forced_quote = Some(quote);
        self
    }

    /// Sniff CSV data from bytes.
    pub fn sniff_bytes(&self, data: &[u8]) -> Result<Metadata> {
        if data.is_empty() {
            return Err(SnifferError::EmptyData);
        }

        // Detect the original encoding and transcode once for CSV parsing.
        let (transcoded_data, encoding_info) = detect_and_transcode(data);
        let data = &transcoded_data[..];

        // Skip BOM
        let data = skip_bom(data);

        // Skip comment/preamble lines (lines starting with #)
        let (comment_preamble_rows, data) = skip_preamble(data);

        // Detect line terminator first to reduce search space
        let line_terminator = detect_line_terminator(data);

        // Generate potential dialects
        let dialects = self.forced_delimiter.map_or_else(
            || generate_dialects_with_terminator(line_terminator),
            |delim| {
                // If delimiter is forced, only test that delimiter with different quotes
                let quotes = if let Some(q) = self.forced_quote {
                    vec![q]
                } else {
                    vec![Quote::Some(b'"'), Quote::Some(b'\''), Quote::None]
                };

                quotes.into_iter().map(|q| PotentialDialect::new(delim, q, line_terminator)).collect()
            },
        );
        // Determine max rows for scoring
        let max_rows = match self.sample_size {
            SampleSize::Records(n) => n,
            SampleSize::Bytes(_) | SampleSize::All => 0, // Already limited by the caller
        };

        // Score all dialects and get the best table (avoids re-parsing)
        let (scores, best_table) = score_all_dialects_with_best_table(data, &dialects, max_rows);

        // Find the best dialect
        let best = find_best_dialect(&scores)
            .ok_or_else(|| SnifferError::NoDialectDetected("No valid dialect found".to_string()))?;

        // Detect structural preamble using the already-parsed table.
        //
        // `best_table` was parsed with the top-gamma dialect, but
        // `find_best_dialect` may deliberately select a different dialect when
        // scores are close (delimiter/quote tiebreakers). Reuse the cached table
        // only when it was parsed with the dialect we actually selected;
        // otherwise re-parse with the selected dialect so preamble detection,
        // field names, and type inference all run on the correct parse.
        let table_for_preamble = match best_table {
            Some((dialect, table)) if dialect == best.dialect => table,
            _ => parse_table(data, &best.dialect, max_rows),
        };
        let structural_preamble = detect_structural_preamble(&table_for_preamble);

        // Total preamble = comment rows + structural rows
        let total_preamble_rows = comment_preamble_rows + structural_preamble;

        // Build metadata from the best dialect, reusing the already-parsed table
        // Pass structural_preamble for table row indexing (since comment rows are already skipped from data)
        // Pass total_preamble_rows for Header metadata (to report true preamble count in original file)
        self.build_metadata(best, encoding_info, structural_preamble, total_preamble_rows, &table_for_preamble, data)
    }

    /// Build Metadata from the best scoring dialect.
    ///
    /// # Arguments
    /// * `structural_preamble` - Number of structural preamble rows in the table (for row indexing)
    /// * `total_preamble_rows` - Total preamble rows including comments (for Header metadata)
    /// * `table` - Pre-parsed table to avoid redundant parsing
    /// * `data` - Raw data bytes for accurate avg_record_len calculation
    fn build_metadata(
        &self,
        score: &DialectScore,
        encoding: crate::dialect::encoding::EncodingInfo,
        structural_preamble: usize,
        total_preamble_rows: usize,
        table: &Table,
        data: &[u8],
    ) -> Result<Metadata> {
        if table.is_empty() {
            return Err(SnifferError::EmptyData);
        }

        // View the table without structural preamble as slices, so no rows are
        // copied (comment preamble rows are already stripped from data)
        let preamble_skip =
            if structural_preamble > 0 && table.rows.len() > structural_preamble { structural_preamble } else { 0 };
        let effective_rows = table.rows.get(preamble_skip..).unwrap_or_default();

        // Detect header on the effective rows (pass total_preamble_rows for Header metadata)
        let header = detect_header(effective_rows, total_preamble_rows);

        // Get field names from the effective rows (first row after structural preamble)
        let fields = if let Some(first) = effective_rows.first().filter(|_| header.has_header_row) {
            first.clone()
        } else {
            // Generate field names
            (0..score.num_fields).map(|i| format!("field_{}", i + 1)).collect()
        };

        // Skip header row for type inference if present
        let data_start =
            if header.has_header_row && effective_rows.len() > 1 { preamble_skip + 1 } else { preamble_skip };
        let (num_cols, _) = Table::compute_modal_field_count(table.field_counts.get(data_start..).unwrap_or_default());

        // Infer types for each column
        let types = infer_column_types(table.rows.get(data_start..).unwrap_or_default(), num_cols);

        // Build dialect
        let dialect = Dialect {
            delimiter: score.dialect.delimiter,
            header,
            quote: score.dialect.quote,
            flexible: !score.is_uniform,
            is_utf8: encoding.is_utf8,
        };

        // Calculate average record length from the raw data
        let avg_record_len = calculate_avg_record_len(data, table.num_rows());

        Ok(Metadata::with_encoding(dialect, encoding, avg_record_len, score.num_fields, fields, types))
    }
}

/// Detect if the first row (after preamble) is likely a header row.
///
/// Optimized: Computes type counts in a single pass without allocating Vecs.
fn detect_header(rows: &[Vec<String>], preamble_rows: usize) -> Header {
    let (Some(first_row), Some(second_row)) = (rows.first(), rows.get(1)) else {
        // Can't determine header with fewer than two rows
        return Header::new(false, preamble_rows);
    };

    // Heuristics for header detection:
    // 1. First row has different types than subsequent rows
    // 2. First row values look like labels (text when data is numeric)
    // 3. First row has no duplicates (header columns should be unique)

    let mut header_score = 0.0;
    let mut checks = 0;

    // Check 1 & 2: Count types in a single pass for first row
    let (first_text_count, first_numeric_count) = first_row.iter().fold((0, 0), |(text, num), s| {
        let t = crate::dialect::tum::type_detection::detect_cell_type(s);
        (text + usize::from(t == Type::Text), num + usize::from(t.is_numeric()))
    });

    // Count types in a single pass for second row
    let second_text_count =
        second_row.iter().filter(|s| crate::dialect::tum::type_detection::detect_cell_type(s) == Type::Text).count();

    if first_text_count > second_text_count {
        header_score += 1.0;
    }
    checks += 1;

    // Check 2: First row has more text than numeric
    if first_text_count > first_numeric_count {
        header_score += 0.5;
    }
    checks += 1;

    // Check 3: No duplicates in first row
    let unique_count = {
        let mut seen = std::collections::HashSet::new();
        first_row.iter().filter(|s| seen.insert(s.as_str())).count()
    };
    if unique_count == first_row.len() {
        header_score += 0.5;
    }
    checks += 1;

    // Check 4: First row values are shorter (headers tend to be concise)
    let avg_first_len: f64 =
        first_row.iter().map(std::string::String::len).sum::<usize>() as f64 / first_row.len().max(1) as f64;
    let avg_second_len: f64 =
        second_row.iter().map(std::string::String::len).sum::<usize>() as f64 / second_row.len().max(1) as f64;

    if avg_first_len <= avg_second_len {
        header_score += 0.3;
    }
    checks += 1;

    // Threshold for header detection
    let has_header = (header_score / checks as f64) > 0.4;

    Header::new(has_header, preamble_rows)
}

/// Calculate average record length from raw data.
///
/// Uses the byte length of the first `num_rows` rows for accurate results
/// that include quote characters and actual line terminators.
/// This handles the case where `data` contains more bytes than `num_rows` rows
/// (e.g., when `SampleSize::Records(n)` reads more data than needed).
fn calculate_avg_record_len(data: &[u8], num_rows: usize) -> usize {
    if num_rows == 0 || data.is_empty() {
        return 0;
    }

    // Find the byte offset where the num_rows-th row ends
    // by counting newlines (handling both \n and \r\n)
    let mut rows_seen = 0;
    let mut byte_offset = 0;

    for (i, &byte) in data.iter().enumerate() {
        if byte == b'\n' {
            rows_seen += 1;
            if rows_seen >= num_rows {
                byte_offset = i + 1; // Include the newline
                break;
            }
        }
    }

    // If we didn't find enough newlines, use the entire data length
    // (this handles files without trailing newlines or small files)
    if byte_offset == 0 {
        byte_offset = data.len();
    }

    byte_offset / num_rows
}

/// Skip preamble/comment lines at the start of data.
///
/// Detects lines starting with '#' at the beginning of the file and returns
/// the number of preamble rows and a slice starting after the preamble.
///
/// Blank lines interspersed within the leading comment block are tolerated:
/// they are buffered and only counted as preamble once a further comment line
/// is seen. A trailing run of blank lines that is followed by data (rather than
/// by another comment) is left in place, so `#c\n\n\ndata` reports one preamble
/// row, not three.
pub(crate) fn skip_preamble(data: &[u8]) -> (usize, &[u8]) {
    let mut preamble_rows = 0;
    let mut offset = 0;

    // Blank lines seen since the last comment line; only committed to the
    // preamble if another comment line follows.
    let mut pending_blank_rows = 0;
    let mut pending_blank_offset = offset;

    while offset < data.len() {
        // Find end of line (exclusive of the terminator).
        let mut line_end = offset;
        while data.get(line_end).is_some_and(|b| *b != b'\n' && *b != b'\r') {
            line_end += 1;
        }

        // Include the line terminator in the consumed span.
        let mut next_offset = line_end;
        if data.get(next_offset) == Some(&b'\r') {
            next_offset += 1;
        }
        if data.get(next_offset) == Some(&b'\n') {
            next_offset += 1;
        }

        // Skip leading whitespace to classify the line.
        let mut line_start = offset;
        while line_start < line_end && data.get(line_start).is_some_and(|b| *b == b' ' || *b == b'\t') {
            line_start += 1;
        }

        if line_start == line_end {
            // Blank (or whitespace-only) line: defer judgement.
            if next_offset == offset {
                break; // no progress possible
            }
            pending_blank_rows += 1;
            offset = next_offset;
        } else if data.get(line_start) == Some(&b'#') {
            // Comment line: any deferred blanks are part of the comment block.
            preamble_rows += pending_blank_rows + 1;
            pending_blank_rows = 0;
            offset = next_offset;
            pending_blank_offset = offset;
        } else {
            // Data line: deferred blanks belong to the data, not the preamble.
            break;
        }
    }

    if pending_blank_rows > 0 {
        offset = pending_blank_offset;
    }

    (preamble_rows, data.get(offset..).unwrap_or_default())
}

/// Detect structural preamble rows using field count consistency analysis.
///
/// Identifies rows at the start that don't match the predominant field count
/// pattern (metadata rows, empty rows, title rows with different structure).
fn detect_structural_preamble(table: &crate::dialect::tum::table::Table) -> usize {
    let n = table.field_counts.len();
    if n < 3 {
        return 0;
    }

    let modal_count = table.modal_field_count();

    // Pre-compute suffix counts: for each position i, how many rows from i to end match modal_count
    // This converts O(n²) scanning to O(n) preprocessing + O(1) lookups
    let mut matching_suffix = vec![0usize; n];
    let mut count = 0;
    for (matching, field_count) in matching_suffix.iter_mut().zip(&table.field_counts).rev() {
        if *field_count == modal_count {
            count += 1;
        }
        *matching = count;
    }

    // Find first row where remaining data is 80%+ consistent with modal field count
    for (i, &field_count) in table.field_counts.iter().enumerate() {
        if field_count == modal_count {
            let remaining_len = n - i;
            let matching = matching_suffix.get(i).copied().unwrap_or(0);
            let consistency = matching as f64 / remaining_len as f64;

            if consistency >= 0.8 {
                return i;
            }
        }
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sniffer_builder() {
        let mut sniffer = Sniffer::new();
        sniffer.sample_size(SampleSize::Records(50)).date_preference(DatePreference::DmyFormat).delimiter(b',');

        assert_eq!(sniffer.sample_size, SampleSize::Records(50));
        assert_eq!(sniffer.date_preference, DatePreference::DmyFormat);
        assert_eq!(sniffer.forced_delimiter, Some(b','));
    }

    #[test]
    fn test_sniff_bytes() {
        let data = b"name,age,city\nAlice,30,NYC\nBob,25,LA\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b',');
        assert!(metadata.dialect.header.has_header_row);
        assert_eq!(metadata.num_fields, 3);
        assert_eq!(metadata.fields, vec!["name", "age", "city"]);
    }

    #[test]
    fn test_sniff_tsv() {
        let data = b"name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b'\t');
        assert!(metadata.dialect.header.has_header_row);
    }

    #[test]
    fn test_sniff_semicolon() {
        let data = b"name;age;city\nAlice;30;NYC\nBob;25;LA\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b';');
    }

    #[test]
    fn test_sniff_no_header() {
        let data = b"1,2,3\n4,5,6\n7,8,9\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b',');
        // All numeric data - should not detect header
        assert!(!metadata.dialect.header.has_header_row);
    }

    #[test]
    fn test_sniff_with_quotes() {
        let data = b"\"name\",\"value\"\n\"hello, world\",123\n\"test\",456\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b',');
        assert_eq!(metadata.dialect.quote, Quote::Some(b'"'));
    }

    #[test]
    fn test_sniff_empty() {
        let data = b"";
        let sniffer = Sniffer::new();

        let result = sniffer.sniff_bytes(data);
        assert!(result.is_err());
    }

    #[test]
    fn test_skip_preamble() {
        // Test with comment lines
        let data = b"# This is a comment\n# Another comment\nname,age\nAlice,30\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 2);
        assert_eq!(remaining, b"name,age\nAlice,30\n");

        // Test without comment lines
        let data = b"name,age\nAlice,30\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 0);
        assert_eq!(remaining, b"name,age\nAlice,30\n");

        // Test with whitespace before #
        let data = b"  # Indented comment\nname,age\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 1);
        assert_eq!(remaining, b"name,age\n");
    }

    #[test]
    fn test_skip_preamble_blank_lines_within_comment_block() {
        // A blank line between comments is part of the comment block.
        let data = b"#c\n\n#d\ndata\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 3);
        assert_eq!(remaining, b"data\n");

        // Trailing blanks followed by data belong to the data, not the preamble.
        let data = b"#c\n\n\ndata\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 1);
        assert_eq!(remaining, b"\n\ndata\n");

        // Several blank runs interleaved with comments, then a trailing run.
        let data = b"#a\n\n#b\n\n\n#c\n\ndata\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 6);
        assert_eq!(remaining, b"\ndata\n");

        // Leading blanks with no comment at all: nothing is preamble.
        let data = b"\n\nname,age\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 0);
        assert_eq!(remaining, b"\n\nname,age\n");

        // Whitespace-only lines count as blank, and CRLF is handled.
        let data = b"#c\r\n   \r\n#d\r\ndata\r\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 3);
        assert_eq!(remaining, b"data\r\n");

        // A comment block that runs to EOF with trailing blanks.
        let data = b"#c\n\n";
        let (preamble_rows, remaining) = skip_preamble(data);
        assert_eq!(preamble_rows, 1);
        assert_eq!(remaining, b"\n");
    }

    #[test]
    fn test_sniff_with_preamble() {
        let data = b"# LimeSurvey export\n# Generated 2024-01-01\nname,age,city\nAlice,30,NYC\nBob,25,LA\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b',');
        assert!(metadata.dialect.header.has_header_row);
        assert_eq!(metadata.num_fields, 3);
    }

    #[test]
    fn test_comment_preamble_propagated() {
        let data = b"# Comment 1\n# Comment 2\nname,age\nAlice,30\nBob,25\n";
        let metadata = Sniffer::new().sniff_bytes(data).unwrap();
        assert_eq!(metadata.dialect.header.num_preamble_rows, 2);
        assert!(metadata.dialect.header.has_header_row);
        assert_eq!(metadata.fields, vec!["name", "age"]);
    }

    #[test]
    fn test_structural_preamble_detection() {
        // TITLE row has 1 field, SUBTITLE has 2 fields, data has 5 fields
        let data = b"TITLE\nSUB,TITLE\nA,B,C,D,E\n1,2,3,4,5\n2,3,4,5,6\n3,4,5,6,7\n";
        let metadata = Sniffer::new().sniff_bytes(data).unwrap();
        assert_eq!(metadata.dialect.header.num_preamble_rows, 2);
        assert!(metadata.dialect.header.has_header_row);
        assert_eq!(metadata.fields, vec!["A", "B", "C", "D", "E"]);
    }

    #[test]
    fn test_mixed_preamble_detection() {
        // Both comment preamble and structural preamble
        // METADATA has 1 field, data has 3 fields
        let data = b"# File header\nMETADATA\nname,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,CHI\n";
        let metadata = Sniffer::new().sniff_bytes(data).unwrap();
        // 1 comment + 1 structural = 2 total
        assert_eq!(metadata.dialect.header.num_preamble_rows, 2);
        assert!(metadata.dialect.header.has_header_row);
        assert_eq!(metadata.fields, vec!["name", "age", "city"]);
    }

    #[test]
    fn test_no_preamble() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";
        let metadata = Sniffer::new().sniff_bytes(data).unwrap();
        assert_eq!(metadata.dialect.header.num_preamble_rows, 0);
    }

    #[test]
    fn test_detect_structural_preamble_function() {
        use crate::dialect::tum::table::Table;

        // Table with 2 preamble rows (different field counts)
        let mut table = Table::new();
        table.rows = vec![
            vec!["TITLE".to_string()],
            vec!["".to_string(), "".to_string()],
            vec!["A".to_string(), "B".to_string(), "C".to_string()],
            vec!["1".to_string(), "2".to_string(), "3".to_string()],
            vec!["4".to_string(), "5".to_string(), "6".to_string()],
        ];
        table.field_counts = vec![1, 2, 3, 3, 3];
        table.update_modal_field_count();
        assert_eq!(detect_structural_preamble(&table), 2);

        // Table with no preamble (uniform field counts)
        let mut table = Table::new();
        table.rows = vec![
            vec!["A".to_string(), "B".to_string(), "C".to_string()],
            vec!["1".to_string(), "2".to_string(), "3".to_string()],
        ];
        table.field_counts = vec![3, 3];
        table.update_modal_field_count();
        assert_eq!(detect_structural_preamble(&table), 0);

        // Table too small to determine preamble
        let mut table = Table::new();
        table.rows = vec![vec!["A".to_string()]];
        table.field_counts = vec![1];
        table.update_modal_field_count();
        assert_eq!(detect_structural_preamble(&table), 0);
    }

    #[test]
    fn test_avg_record_len_calculated_from_data() {
        // Test that avg_record_len uses raw bytes, not parsed content
        let short_data = b"a,b\n1,2\n3,4\n";
        let sniffer = Sniffer::new();
        let metadata = sniffer.sniff_bytes(short_data).unwrap();

        // Each row: "a,b\n" = 4 bytes, "1,2\n" = 4 bytes, "3,4\n" = 4 bytes
        // Average: 12 / 3 = 4 bytes
        assert_eq!(metadata.avg_record_len, 4);
    }

    #[test]
    fn test_avg_record_len_with_quoted_fields() {
        let quoted_data = b"\"hello\",\"world\"\n\"foo\",\"bar\"\n";
        let sniffer = Sniffer::new();
        let metadata = sniffer.sniff_bytes(quoted_data).unwrap();

        // Raw: 16 + 12 = 28 bytes for 2 rows = 14 bytes avg
        assert_eq!(metadata.avg_record_len, 14);
    }
}
