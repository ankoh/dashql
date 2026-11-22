//! A streaming reader of CSV records that reads them the way the CSV reader of Hyper does.
//!
//! The reader takes the bytes of a file in chunks of any size and hands every record to a callback. Unlike csv-core it
//! keeps the facts that decide whether Hyper can read a file: a blank line is a record of one empty field (Hyper reads
//! it as a row, a file with more columns fails on it), an empty field knows whether it was quoted (Hyper reads `""` as
//! an empty string, an empty field as NULL), and the reader knows where the last record that is no blank line ends.
//!
//! Fields are quoted with the quote of the dialect, a doubled quote in a quoted field is a quote. Like the CSV reader
//! of PostgreSQL, every quote switches between quoted and unquoted text, also in the middle of a field: `a"b,c"d` is
//! one field `ab,cd`. Whether a byte is quoted therefore depends only on the parity of the quotes before it, which lets
//! workers read ranges of a file in parallel (see `convert`). A record ends at `\n`, at `\r\n` (after its `\n`) or
//! at a `\r` that no `\n` follows: where a record ends depends only on the byte after it, so a reader that starts in
//! the middle of a file finds the same ends. A field or record beyond the limits below is cut, the field is marked as
//! truncated, so that a quote that is never closed doesn't buffer the file.

/// The bytes of a field that the reader keeps by default, the rest is cut
pub const MAX_FIELD_BYTES: usize = 64 * 1024;
/// The bytes of a record that the reader keeps, the fields beyond are cut
pub const MAX_RECORD_BYTES: usize = 4 * 1024 * 1024;

/// A field of a record
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Field {
    /// The end of the field in the buffer of the record
    end: usize,
    /// Was the field quoted?
    pub quoted: bool,
    /// Was the field cut?
    pub truncated: bool,
}

/// A record that the reader read
pub struct Record<'a> {
    buffer: &'a [u8],
    fields: &'a [Field],
    /// Is the record a blank line?
    pub blank: bool,
    /// The position after its terminator
    pub end: u64,
}

impl<'a> Record<'a> {
    /// The number of fields
    pub fn len(&self) -> usize {
        self.fields.len()
    }

    /// Does the record have no fields? A record has at least one, a blank line has one empty field.
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    /// The fields with their bytes
    pub fn fields(&self) -> impl Iterator<Item = (&'a [u8], Field)> + 'a {
        let buffer = self.buffer;
        let mut start = 0;
        self.fields.iter().map(move |field| {
            let bytes = buffer.get(start..field.end).unwrap_or_default();
            start = field.end;
            (bytes, *field)
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    /// At the start of a field
    FieldStart,
    /// In a field without quotes
    Unquoted,
    /// In a quoted field
    Quoted,
    /// After a quote in a quoted field: the end of the quoted text or the first of a doubled quote
    QuoteInQuoted,
    /// After a `\r` outside quotes: the record ends after a `\n` that follows, else after the `\r`
    CarriageReturn,
}

/// A streaming reader of CSV records
pub struct RecordReader {
    delimiter: u8,
    quote: Option<u8>,
    state: State,
    /// The bytes of the fields of the current record
    buffer: Vec<u8>,
    /// The fields of the current record
    fields: Vec<Field>,
    /// The start of the current field in the buffer
    field_start: usize,
    field_quoted: bool,
    field_truncated: bool,
    /// Has the current record a byte other than its terminator?
    record_content: bool,
    /// The bytes that the reader read
    position: u64,
    /// The end of the last record that is no blank line, after its terminator
    content_end: u64,
    /// The quotes that the reader read
    quotes: u64,
    /// The bytes of a field and of a record that the reader keeps
    max_field_bytes: usize,
    max_record_bytes: usize,
}

impl RecordReader {
    /// A reader of records with a delimiter and a quote, `None` reads quotes as text
    pub fn new(delimiter: u8, quote: Option<u8>) -> Self {
        Self::starting_in(delimiter, quote, false)
    }

    /// A reader that starts in the middle of a file, in quoted text or not. The first record it reads is cut off.
    pub fn starting_in(delimiter: u8, quote: Option<u8>, in_quotes: bool) -> Self {
        Self {
            delimiter,
            quote,
            state: if in_quotes { State::Quoted } else { State::FieldStart },
            buffer: Vec::new(),
            fields: Vec::new(),
            field_start: 0,
            field_quoted: false,
            field_truncated: false,
            record_content: false,
            position: 0,
            content_end: 0,
            quotes: 0,
            max_field_bytes: MAX_FIELD_BYTES,
            max_record_bytes: MAX_RECORD_BYTES,
        }
    }

    /// The reader with other limits of the bytes of a field and of a record
    pub fn with_limits(mut self, max_field_bytes: usize, max_record_bytes: usize) -> Self {
        self.max_field_bytes = max_field_bytes;
        self.max_record_bytes = max_record_bytes;
        self
    }

    /// The quotes that the reader read. Their parity tells whether the byte after them is quoted.
    pub fn quotes(&self) -> u64 {
        self.quotes
    }

    /// The bytes that the reader read
    pub fn position(&self) -> u64 {
        self.position
    }

    /// The end of the last record that is no blank line, after its terminator. The bytes after it are blank lines.
    pub fn content_end(&self) -> u64 {
        self.content_end
    }

    /// Is the reader in quoted text?
    pub fn in_quotes(&self) -> bool {
        matches!(self.state, State::Quoted)
    }

    /// Read a chunk of the file, the callback gets every record that ends in it
    pub fn read(&mut self, input: &[u8], on_record: &mut impl FnMut(&Record<'_>)) {
        for &byte in input {
            self.step(byte, on_record);
            self.position += 1;
        }
    }

    /// Finish the file: the callback gets the last record if the file doesn't end with a terminator
    pub fn finish(&mut self, on_record: &mut impl FnMut(&Record<'_>)) {
        match self.state {
            State::FieldStart if !self.record_content => {}
            _ => self.end_record(self.position, on_record),
        }
        self.state = State::FieldStart;
    }

    fn push(&mut self, byte: u8) {
        if self.buffer.len() - self.field_start >= self.max_field_bytes || self.buffer.len() >= self.max_record_bytes {
            self.field_truncated = true;
        } else {
            self.buffer.push(byte);
        }
    }

    fn end_field(&mut self) {
        self.fields.push(Field { end: self.buffer.len(), quoted: self.field_quoted, truncated: self.field_truncated });
        self.field_start = self.buffer.len();
        self.field_quoted = false;
        self.field_truncated = false;
    }

    /// End the record, `end` is the position after its terminator
    fn end_record(&mut self, end: u64, on_record: &mut impl FnMut(&Record<'_>)) {
        self.end_field();
        let blank = !self.record_content;
        if !blank {
            self.content_end = end;
        }
        on_record(&Record { buffer: &self.buffer, fields: &self.fields, blank, end });
        self.buffer.clear();
        self.fields.clear();
        self.field_start = 0;
        self.record_content = false;
    }

    /// A line break outside quotes at the current position: a `\n` ends the record, a `\r` waits for the next byte
    fn end_line(&mut self, byte: u8, on_record: &mut impl FnMut(&Record<'_>)) {
        if byte == b'\r' {
            self.state = State::CarriageReturn;
        } else {
            self.end_record(self.position + 1, on_record);
            self.state = State::FieldStart;
        }
    }

    fn step(&mut self, byte: u8, on_record: &mut impl FnMut(&Record<'_>)) {
        if Some(byte) == self.quote {
            self.quotes += 1;
        }
        self.step_after_quote_count(byte, on_record);
    }

    /// A step for a byte whose quote is counted
    fn step_after_quote_count(&mut self, byte: u8, on_record: &mut impl FnMut(&Record<'_>)) {
        match self.state {
            State::CarriageReturn => {
                if byte == b'\n' {
                    self.end_record(self.position + 1, on_record);
                    self.state = State::FieldStart;
                } else {
                    // A `\r` alone ends the record after it
                    self.end_record(self.position, on_record);
                    self.state = State::FieldStart;
                    self.step_after_quote_count(byte, on_record);
                }
            }
            State::FieldStart => {
                if byte == b'\n' || byte == b'\r' {
                    self.end_line(byte, on_record);
                    return;
                }
                self.record_content = true;
                if Some(byte) == self.quote {
                    self.field_quoted = true;
                    self.state = State::Quoted;
                } else if byte == self.delimiter {
                    self.end_field();
                } else {
                    self.push(byte);
                    self.state = State::Unquoted;
                }
            }
            State::Unquoted => {
                if Some(byte) == self.quote {
                    self.state = State::Quoted;
                } else if byte == self.delimiter {
                    self.end_field();
                    self.state = State::FieldStart;
                } else if byte == b'\n' || byte == b'\r' {
                    self.end_line(byte, on_record);
                } else {
                    self.push(byte);
                }
            }
            State::Quoted => {
                if Some(byte) == self.quote {
                    self.state = State::QuoteInQuoted;
                } else {
                    self.push(byte);
                }
            }
            State::QuoteInQuoted => {
                if Some(byte) == self.quote {
                    self.push(byte);
                    self.state = State::Quoted;
                } else if byte == self.delimiter {
                    self.end_field();
                    self.state = State::FieldStart;
                } else if byte == b'\n' || byte == b'\r' {
                    self.end_line(byte, on_record);
                } else {
                    self.push(byte);
                    self.state = State::Unquoted;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The records of an input read in chunks of a size, as (fields, blank)
    fn read(input: &[u8], chunk: usize, delimiter: u8, quote: Option<u8>) -> (Vec<(Vec<String>, bool)>, RecordReader) {
        let mut reader = RecordReader::new(delimiter, quote);
        let mut records = Vec::new();
        let mut on_record = |record: &Record<'_>| {
            let fields = record
                .fields()
                .map(|(bytes, field)| {
                    let text = String::from_utf8_lossy(bytes).into_owned();
                    if field.quoted {
                        format!("q:{text}")
                    } else {
                        text
                    }
                })
                .collect();
            records.push((fields, record.blank));
        };
        for part in input.chunks(chunk) {
            reader.read(part, &mut on_record);
        }
        reader.finish(&mut on_record);
        (records, reader)
    }

    fn fields(records: &[(Vec<String>, bool)]) -> Vec<Vec<&str>> {
        records.iter().map(|(f, _)| f.iter().map(String::as_str).collect()).collect()
    }

    #[test]
    fn test_records_in_any_chunks() {
        let input = b"a,b\r\n1,\"x\r\ny\"\r\n2,\"say \"\"hi\"\"\"\n3,\n";
        for chunk in [1, 2, 3, 7, 1024] {
            let (records, reader) = read(input, chunk, b',', Some(b'"'));
            assert_eq!(
                fields(&records),
                vec![vec!["a", "b"], vec!["1", "q:x\r\ny"], vec!["2", "q:say \"hi\""], vec!["3", ""]],
                "chunk {chunk}"
            );
            assert_eq!(reader.content_end(), input.len() as u64);
        }
    }

    #[test]
    fn test_blank_lines_and_content_end() {
        let input = b"a;b\n\n1;2\n\n\n";
        let (records, reader) = read(input, 4, b';', Some(b'"'));
        assert_eq!(records.iter().map(|(_, blank)| *blank).collect::<Vec<_>>(), vec![false, true, false, true, true]);
        assert_eq!(reader.content_end(), 9);
        let (_, reader) = read(b"a\r\n1\r\n\r\n", 1, b',', Some(b'"'));
        assert_eq!(reader.content_end(), 6);
    }

    #[test]
    fn test_last_record_without_terminator() {
        let (records, reader) = read(b"a,b\n1,", 2, b',', Some(b'"'));
        assert_eq!(fields(&records), vec![vec!["a", "b"], vec!["1", ""]]);
        assert_eq!(reader.content_end(), 6);
        let (records, _) = read(b"x", 2, b',', Some(b'"'));
        assert_eq!(fields(&records), vec![vec!["x"]]);
    }

    #[test]
    fn test_quoted_empty_and_text_after_quote() {
        let (records, _) = read(b"\"\",,\"a\"b\n", 3, b',', Some(b'"'));
        assert_eq!(fields(&records), vec![vec!["q:", "", "q:ab"]]);
    }

    #[test]
    fn test_no_quote_and_carriage_returns() {
        let (records, _) = read(b"\"a\"\t'b'\rc\td\r", 5, b'\t', None);
        assert_eq!(fields(&records), vec![vec!["\"a\"", "'b'"], vec!["c", "d"]]);
    }

    #[test]
    fn test_unterminated_quote_is_cut() {
        let mut input = b"a,\"".to_vec();
        input.extend(std::iter::repeat_n(b'x', MAX_FIELD_BYTES + 10));
        let mut reader = RecordReader::new(b',', Some(b'"'));
        let mut lengths = Vec::new();
        let mut on_record = |record: &Record<'_>| {
            lengths.extend(record.fields().map(|(bytes, field)| (bytes.len(), field.truncated)));
        };
        reader.read(&input, &mut on_record);
        assert!(reader.in_quotes());
        reader.finish(&mut on_record);
        assert_eq!(lengths, vec![(1, false), (MAX_FIELD_BYTES, true)]);
    }
}
