//! The scanner reads a whole CSV file in chunks and finds the type of every column, the rows that Hyper can't read and
//! the first rows as a preview.

use crate::reader::{Record, RecordReader};
use crate::schema::{column_names, Column, ColumnState};
use crate::sniff::CsvFormat;

/// The characters of a value in the preview, a longer one is cut
const PREVIEW_VALUE_CHARS: usize = 200;
/// The windows of a sample besides the first bytes, and their bytes
const SAMPLE_WINDOWS: u64 = 16;
const SAMPLE_WINDOW_BYTES: u64 = 256 * 1024;

/// The schema of a scanned CSV file
#[derive(Clone, Debug, PartialEq)]
pub struct CsvSchema {
    pub columns: Vec<Column>,
    /// The rows of the data, without the header
    pub rows: u64,
    /// The end of the data in the UTF-8 of the file: after the last record that is no blank line. Hyper reads a blank
    /// line as a row, the import leaves the blank lines at the end out.
    pub data_end: u64,
    /// The bytes of the file in UTF-8
    pub bytes: u64,
    /// The first rows, `None` for a NULL: an empty field or a missing one
    pub preview: Vec<Vec<Option<String>>>,
    /// Why Hyper may fail to read the file, as sentences
    pub problems: Vec<String>,
    /// Is the schema the one of a sample? Then the rows are those of the first bytes.
    pub sampled: bool,
}

/// What the scanner counts of the records
struct Tally {
    columns: Vec<ColumnState>,
    check_utf8: bool,
    header_pending: bool,
    header: Vec<String>,
    rows: u64,
    /// Blank lines that are rows if a record follows them
    pending_blank_rows: u64,
    ragged_rows: u64,
    blank_ragged_rows: u64,
    first_ragged_row: Option<u64>,
    invalid_utf8_rows: u64,
    first_invalid_utf8_row: Option<u64>,
    preview: Vec<Vec<Option<String>>>,
    preview_rows: usize,
}

impl Tally {
    fn ragged(&mut self) {
        self.ragged_rows += 1;
        self.first_ragged_row.get_or_insert(self.rows);
    }

    fn record(&mut self, record: &Record<'_>) {
        if record.blank {
            // A blank line before the header is no row, Hyper would skip it as the header
            if !self.header_pending {
                self.pending_blank_rows += 1;
            }
            return;
        }
        if self.header_pending {
            self.header_pending = false;
            self.header = record.fields().map(|(bytes, _)| String::from_utf8_lossy(bytes).into_owned()).collect();
            return;
        }
        // The blank lines before the record are rows of Hyper, a NULL with one column, too few fields with more
        for _ in 0..std::mem::take(&mut self.pending_blank_rows) {
            self.rows += 1;
            if let [column] = self.columns.as_mut_slice() {
                column.observe_missing();
            } else {
                self.blank_ragged_rows += 1;
                self.ragged();
            }
            if self.preview.len() < self.preview_rows {
                self.preview.push(vec![None; self.columns.len()]);
            }
        }
        self.rows += 1;
        if record.len() != self.columns.len() {
            self.ragged();
        }
        let mut invalid_utf8 = false;
        let mut preview = (self.preview.len() < self.preview_rows).then(|| Vec::with_capacity(self.columns.len()));
        for ((bytes, field), column) in record.fields().zip(self.columns.iter_mut()) {
            column.observe(bytes, field.quoted, field.truncated);
            if self.check_utf8 && !field.truncated && std::str::from_utf8(bytes).is_err() {
                invalid_utf8 = true;
            }
            if let Some(values) = preview.as_mut() {
                values.push((field.quoted || !bytes.is_empty()).then(|| preview_value(bytes)));
            }
        }
        if invalid_utf8 {
            self.invalid_utf8_rows += 1;
            self.first_invalid_utf8_row.get_or_insert(self.rows);
        }
        if let Some(mut values) = preview {
            values.resize(self.columns.len(), None);
            self.preview.push(values);
        }
    }
}

/// A value of the preview, cut after `PREVIEW_VALUE_CHARS`
fn preview_value(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    match text.char_indices().nth(PREVIEW_VALUE_CHARS) {
        Some((end, _)) => format!("{}…", text.get(..end).unwrap_or_default()),
        None => text.into_owned(),
    }
}

/// "1 row" or "2 rows"
fn rows(count: u64) -> String {
    if count == 1 {
        "1 row".to_string()
    } else {
        format!("{count} rows")
    }
}

/// A scanner of the chunks of a CSV file, from its first byte to its last
pub struct CsvScanner {
    format: CsvFormat,
    /// The decoder of a file that is no UTF-8
    decoder: Option<encoding_rs::Decoder>,
    /// The bytes of the file in UTF-8 that the scanner saw
    position: u64,
    reader: RecordReader,
    tally: Tally,
}

impl CsvScanner {
    /// A scanner of a file in a format, it keeps the first rows as a preview
    pub fn new(format: CsvFormat, preview_rows: usize) -> Self {
        let decoder = format.transcoded().then(|| format.encoding.new_decoder());
        let tally = Tally {
            columns: vec![ColumnState::default(); format.columns],
            check_utf8: !format.transcoded(),
            header_pending: format.has_header,
            header: Vec::new(),
            rows: 0,
            pending_blank_rows: 0,
            ragged_rows: 0,
            blank_ragged_rows: 0,
            first_ragged_row: None,
            invalid_utf8_rows: 0,
            first_invalid_utf8_row: None,
            preview: Vec::new(),
            preview_rows,
        };
        let reader = RecordReader::new(format.delimiter, format.quote);
        Self { format, decoder, position: 0, reader, tally }
    }

    /// The format of the file
    pub fn format(&self) -> &CsvFormat {
        &self.format
    }

    /// Scan the next chunk of the file. The UTF-8 of a file that is decoded is returned: the import reads it instead of
    /// the file, the offsets of the format and the schema count its bytes.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        match self.decoder.as_mut() {
            None => {
                self.read(chunk);
                Vec::new()
            }
            Some(decoder) => {
                let decoded = decode(decoder, chunk, false);
                self.read(&decoded);
                decoded
            }
        }
    }

    /// Scan the end of the file and return its schema, and the last UTF-8 of a file that is decoded
    /// The windows of a file whose records a sample classifies besides the first bytes: evenly spread over the rest of
    /// the file, as `(start, end)` in bytes of the file. A decoded file has none, its bytes can't be read from the middle.
    pub fn sample_windows(&self, size: u64, prefix: u64) -> Vec<(u64, u64)> {
        if self.format.transcoded() || size <= prefix {
            return Vec::new();
        }
        let rest = size - prefix;
        let count = rest.div_ceil(SAMPLE_WINDOW_BYTES).min(SAMPLE_WINDOWS);
        (0..count)
            .map(|i| {
                let start = prefix + rest * i / count;
                (start, (start + SAMPLE_WINDOW_BYTES).min(size))
            })
            .collect()
    }

    /// Classify the records of a window of the middle of a file: the first record, which the window cuts, and the
    /// last one, which may be cut, are dropped, and so are records with another number of fields: the window may start
    /// in quoted text. The records count for the types only, not for the rows or the preview.
    pub fn sample_window(&mut self, bytes: &[u8]) {
        let mut reader = RecordReader::new(self.format.delimiter, self.format.quote);
        let columns = &mut self.tally.columns;
        let mut first = true;
        reader.read(bytes, &mut |record| {
            if std::mem::take(&mut first) || record.blank || record.len() != columns.len() {
                return;
            }
            for ((value, field), column) in record.fields().zip(columns.iter_mut()) {
                column.observe(value, field.quoted, field.truncated);
            }
        });
    }

    /// Finish a sample: the schema of the first bytes and the windows. If the first bytes are not the whole file, their
    /// last record may be cut and doesn't count.
    pub fn finish_sample(&mut self, complete: bool) -> CsvSchema {
        if complete {
            return self.finish().0;
        }
        let mut schema = self.schema(false);
        schema.sampled = true;
        schema
    }

    /// Scan the end of the file and return its schema, and the last UTF-8 of a file that is decoded
    pub fn finish(&mut self) -> (CsvSchema, Vec<u8>) {
        let decoded = match self.decoder.as_mut() {
            Some(decoder) => decode(decoder, &[], true),
            None => Vec::new(),
        };
        self.read(&decoded);
        let unterminated_quote = self.reader.in_quotes();
        let tally = &mut self.tally;
        self.reader.finish(&mut |record| tally.record(record));
        (self.schema(unterminated_quote), decoded)
    }

    fn read(&mut self, bytes: &[u8]) {
        // The bytes before the data are no records
        let skip = self.format.data_offset.saturating_sub(self.position).min(bytes.len() as u64) as usize;
        self.position += bytes.len() as u64;
        let tally = &mut self.tally;
        self.reader.read(bytes.get(skip..).unwrap_or_default(), &mut |record| tally.record(record));
    }

    fn schema(&self, unterminated_quote: bool) -> CsvSchema {
        let tally = &self.tally;
        let names = column_names(&tally.header, tally.columns.len());
        let columns = tally.columns.iter().zip(names).map(|(state, name)| state.column(name)).collect();
        let mut problems = Vec::new();
        if tally.ragged_rows > 0 {
            let mut problem = format!(
                "{} of {} {} another number of fields than the {} columns, the first is row {}.",
                rows(tally.ragged_rows),
                tally.rows,
                if tally.ragged_rows == 1 { "has" } else { "have" },
                tally.columns.len(),
                tally.first_ragged_row.unwrap_or(0),
            );
            match tally.blank_ragged_rows {
                0 => {}
                1 => problem.push_str(" One of them is a blank line."),
                n => problem.push_str(&format!(" {n} of them are blank lines.")),
            }
            problem.push_str(" Hyper can't read these rows.");
            problems.push(problem);
        }
        if tally.invalid_utf8_rows > 0 {
            problems.push(format!(
                "{} of {} {} no valid UTF-8, the first is row {}. Hyper reads only UTF-8.",
                rows(tally.invalid_utf8_rows),
                tally.rows,
                if tally.invalid_utf8_rows == 1 { "is" } else { "are" },
                tally.first_invalid_utf8_row.unwrap_or(0),
            ));
        }
        if unterminated_quote {
            problems.push("The file ends in a quoted field, a quote is not closed.".to_string());
        }
        CsvSchema {
            columns,
            rows: tally.rows,
            data_end: self.format.data_offset + self.reader.content_end(),
            bytes: self.position,
            preview: tally.preview.clone(),
            problems,
            sampled: false,
        }
    }
}

/// Decode a chunk to UTF-8, `last` at the end of the file
pub(crate) fn decode(decoder: &mut encoding_rs::Decoder, mut input: &[u8], last: bool) -> Vec<u8> {
    let mut output = Vec::new();
    loop {
        let capacity = decoder.max_utf8_buffer_length(input.len()).unwrap_or(input.len().saturating_mul(3)).max(16);
        let start = output.len();
        output.resize(start + capacity, 0);
        let (result, read, written, _) =
            decoder.decode_to_utf8(input, output.get_mut(start..).unwrap_or_default(), last);
        output.truncate(start + written);
        input = input.get(read..).unwrap_or_default();
        if result == encoding_rs::CoderResult::InputEmpty {
            return output;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ColumnType, DateFormat};
    use crate::sniff::sniff;

    /// Scan a file in chunks of a size
    fn scan(data: &[u8], chunk: usize) -> (CsvFormat, CsvSchema, Vec<u8>) {
        let format = sniff(data, true).unwrap();
        let mut scanner = CsvScanner::new(format.clone(), 3);
        let mut decoded = Vec::new();
        for part in data.chunks(chunk) {
            decoded.extend(scanner.push(part));
        }
        let (schema, rest) = scanner.finish();
        decoded.extend(rest);
        (format, schema, decoded)
    }

    /// A comma-separated UTF-8 file with a header
    fn comma_format(columns: usize) -> CsvFormat {
        CsvFormat {
            encoding: encoding_rs::UTF_8,
            bom: false,
            delimiter: b',',
            quote: Some(b'"'),
            has_header: true,
            preamble_rows: 0,
            data_offset: 0,
            columns,
        }
    }

    /// Scan a file in a format in chunks of a size
    fn scan_as(format: CsvFormat, data: &[u8], chunk: usize) -> CsvSchema {
        let mut scanner = CsvScanner::new(format, 0);
        for part in data.chunks(chunk) {
            scanner.push(part);
        }
        scanner.finish().0
    }

    fn types(schema: &CsvSchema) -> Vec<ColumnType> {
        schema.columns.iter().map(|c| c.column_type).collect()
    }

    #[test]
    fn test_scan_types_over_the_whole_file() {
        let mut data = b"id,price,day,label\n".to_vec();
        for i in 0..500 {
            data.extend(format!("{i},{i}.5,2024-01-{:02},item {i}\n", i % 28 + 1).as_bytes());
        }
        // A value far after the sample of the sniffer makes the id a text
        data.extend(b"x1,2,2024-02-01,last\n");
        for chunk in [7, 4096] {
            let (_, schema, _) = scan(&data, chunk);
            assert_eq!(types(&schema), vec![ColumnType::Text, ColumnType::Double, ColumnType::Date, ColumnType::Text]);
            assert_eq!(schema.rows, 501);
            assert_eq!(schema.data_end, data.len() as u64);
            assert!(schema.problems.is_empty(), "{:?}", schema.problems);
            let names: Vec<&str> = schema.columns.iter().map(|c| c.name.as_str()).collect();
            assert_eq!(names, vec!["id", "price", "day", "label"]);
        }
    }

    #[test]
    fn test_scan_preview_and_nulls() {
        let data = b"a,b,c\n1,\"\",x\n2,NA,\n3,4,\"\"\n4,5,y\n";
        let (_, schema, _) = scan(data, 5);
        assert_eq!(
            schema.preview,
            vec![
                vec![Some("1".into()), Some("".into()), Some("x".into())],
                vec![Some("2".into()), Some("NA".into()), None],
                vec![Some("3".into()), Some("4".into()), Some("".into())],
            ]
        );
        let b = schema.columns.get(1).unwrap();
        assert_eq!(
            (b.column_type, b.null_values.clone(), b.nulls),
            (ColumnType::BigInt, vec!["NA".into(), "".into()], 2)
        );
    }

    #[test]
    fn test_scan_ragged_and_blank_rows() {
        let data = b"a,b\n1,2\n\n3\n4,5,6\n7,8\n\n\n";
        let schema = scan_as(comma_format(2), data, 3);
        assert_eq!(schema.rows, 5);
        assert_eq!(schema.data_end, 21);
        assert_eq!(
            schema.problems,
            vec!["3 rows of 5 have another number of fields than the 2 columns, the first is row 2. One of them is a blank \
                  line. Hyper can't read these rows."]
        );
    }

    #[test]
    fn test_scan_blank_rows_of_one_column() {
        let data = b"value\n1\n2\n\n3\n4\n\n";
        let (_, schema, _) = scan(data, 64);
        assert_eq!(schema.rows, 5);
        assert!(schema.problems.is_empty());
        assert_eq!(schema.columns.first().map(|c| (c.column_type, c.nulls)), Some((ColumnType::BigInt, 1)));
    }

    #[test]
    fn test_scan_decodes_legacy_encodings() {
        let data = b"Name;Gr\xF6\xDFe;Datum\nA;1;31.01.2024\nB;3;01.02.2024\nC;5;15.03.2024\n";
        let (format, schema, decoded) = scan(data, 4);
        assert!(format.transcoded());
        assert_eq!(
            String::from_utf8(decoded.clone()).unwrap(),
            "Name;Größe;Datum\nA;1;31.01.2024\nB;3;01.02.2024\nC;5;15.03.2024\n"
        );
        assert_eq!(schema.columns.get(1).map(|c| c.name.as_str()), Some("Größe"));
        let date = schema.columns.get(2).unwrap();
        assert_eq!((date.column_type, date.date_format), (ColumnType::Date, DateFormat::DayMonthYearDots));
        assert_eq!(schema.data_end, decoded.len() as u64);
    }

    #[test]
    fn test_scan_invalid_utf8_and_unterminated_quote() {
        let data = b"a,b\n1,x\n2,y\n3,z\n4,\xFF\n5,\"open\n";
        let schema = scan_as(comma_format(2), data, 4);
        assert_eq!(
            schema.problems,
            vec![
                "1 row of 5 is no valid UTF-8, the first is row 4. Hyper reads only UTF-8.".to_string(),
                "The file ends in a quoted field, a quote is not closed.".to_string(),
            ]
        );
    }

    #[test]
    fn test_sample_windows_find_late_values() {
        let mut data = b"id,price\n".to_vec();
        for i in 0..20_000 {
            data.extend(format!("{i},{}\n", i % 100).as_bytes());
        }
        data.extend(b"x,1.5\n");
        for i in 0..20_000 {
            data.extend(format!("{i},{}\n", i % 100).as_bytes());
        }
        let prefix = &data[..4096];
        let format = sniff(prefix, false).unwrap();
        let mut scanner = CsvScanner::new(format, 5);
        scanner.push(prefix);
        let windows = scanner.sample_windows(data.len() as u64, prefix.len() as u64);
        assert_eq!(windows.len(), 2);
        // A window over the late values widens the types of the sample
        scanner.sample_window(&data[data.len() / 2 - 100..data.len() / 2 + 300]);
        let schema = scanner.finish_sample(false);
        assert!(schema.sampled);
        assert_eq!(types(&schema), vec![ColumnType::Text, ColumnType::Double]);
        assert_eq!(schema.preview.len(), 5);
    }
}
