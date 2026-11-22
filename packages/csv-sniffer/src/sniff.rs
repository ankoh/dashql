//! The format of a CSV file from its first bytes: the dialect of csv-nose and where the data starts.

use std::borrow::Cow;

use crate::dialect::{self, SnifferError};
use crate::reader::{Record, RecordReader};

/// The format of a CSV file, everything a reader of its records needs
#[derive(Clone, Debug, PartialEq)]
pub struct CsvFormat {
    /// The encoding of the file. The scanner decodes a file that is no UTF-8 to UTF-8, Hyper reads only UTF-8.
    pub encoding: &'static encoding_rs::Encoding,
    /// Did the file start with a byte order mark?
    pub bom: bool,
    pub delimiter: u8,
    /// The quote, `None` if fields are not quoted
    pub quote: Option<u8>,
    /// Is the first record of the data a header?
    pub has_header: bool,
    /// The lines before the data: comments starting with `#`, and rows that don't fit the table, e.g. a title
    pub preamble_rows: usize,
    /// The bytes before the data (the header or the first row) in the UTF-8 of the file: the byte order mark of UTF-8
    /// and the preamble. Hyper has no option to skip lines, the import reads the file from here.
    pub data_offset: u64,
    /// The number of columns, the most frequent number of fields of the records
    pub columns: usize,
}

impl CsvFormat {
    /// Must the file be decoded to UTF-8?
    pub fn transcoded(&self) -> bool {
        self.encoding != encoding_rs::UTF_8
    }
}

/// The byte order mark of UTF-8
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Find the format of a CSV file from its first bytes, `complete` if they are the whole file. The sample may end in
/// the middle of a record, a sample of an ASCII-compatible encoding is cut after its last line.
pub fn sniff(prefix: &[u8], complete: bool) -> Result<CsvFormat, SnifferError> {
    if prefix.is_empty() {
        return Err(SnifferError::EmptyData);
    }
    let encoding = dialect::detect_sample_encoding(prefix);
    let sample = match prefix.iter().rposition(|b| *b == b'\n') {
        Some(end) if !complete && encoding.is_ascii_compatible() => prefix.get(..=end).unwrap_or(prefix),
        _ => prefix,
    };
    let metadata = dialect::Sniffer::new().sniff_bytes(sample)?;
    let delimiter = metadata.dialect.delimiter;
    let quote = metadata.dialect.quote.char();

    // The sample as the scanner reads it: UTF-8, a decoder drops the byte order mark of another encoding
    let text: Cow<'_, [u8]> = if encoding == encoding_rs::UTF_8 {
        Cow::Borrowed(sample)
    } else {
        Cow::Owned(encoding.decode(sample).0.into_owned().into_bytes())
    };
    let bom = text.starts_with(UTF8_BOM);
    let after_bom = text.strip_prefix(UTF8_BOM).unwrap_or(&text);
    let (comment_rows, rest) = dialect::skip_preamble(after_bom);
    let mut data_offset = (text.len() - rest.len()) as u64;
    let preamble_rows = metadata.dialect.header.num_preamble_rows;
    let structural_rows = preamble_rows.saturating_sub(comment_rows);
    if structural_rows > 0 {
        data_offset += skip_records(rest, delimiter, quote, structural_rows);
    }
    // Hyper reads a blank line as a record, its header would be the blank line after the preamble
    let blank =
        text.get(data_offset as usize..).unwrap_or_default().iter().take_while(|b| **b == b'\n' || **b == b'\r');
    data_offset += blank.count() as u64;
    Ok(CsvFormat {
        encoding,
        bom: bom || prefix.starts_with(&[0xFF, 0xFE]) || prefix.starts_with(&[0xFE, 0xFF]),
        delimiter,
        quote,
        has_header: metadata.dialect.header.has_header_row,
        preamble_rows,
        data_offset,
        columns: metadata.num_fields.max(1),
    })
}

/// The bytes of the first records that are no blank lines, with the blank lines between them
fn skip_records(data: &[u8], delimiter: u8, quote: Option<u8>, count: usize) -> u64 {
    let mut reader = RecordReader::new(delimiter, quote);
    let mut seen = 0;
    let mut end = 0;
    let mut on_record = |record: &Record<'_>| {
        if !record.blank && seen < count {
            seen += 1;
            end = record.end;
        }
    };
    reader.read(data, &mut on_record);
    end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sniff_dialect() {
        let format = sniff(b"name;age\nAlice;30\nBob;25\nCarol;41\n", true).unwrap();
        assert_eq!((format.delimiter, format.quote, format.has_header), (b';', Some(b'"'), true));
        assert_eq!((format.columns, format.data_offset, format.preamble_rows), (2, 0, 0));
        assert!(!format.transcoded());
    }

    #[test]
    fn test_sniff_skips_bom_and_comments() {
        let data = b"\xEF\xBB\xBF# exported\n# by a tool\nid,value\n1,2\n3,4\n5,6\n";
        let format = sniff(data, true).unwrap();
        assert_eq!(format.preamble_rows, 2);
        assert!(format.bom);
        let offset = format.data_offset as usize;
        assert_eq!(data.get(offset..offset + 8), Some(&b"id,value"[..]));
    }

    #[test]
    fn test_sniff_skips_a_title_row() {
        let data = b"Sales report\n\nregion,q1,q2,q3\nnorth,1,2,3\nsouth,4,5,6\neast,7,8,9\nwest,1,1,1\n";
        let format = sniff(data, true).unwrap();
        assert_eq!(format.columns, 4);
        let offset = format.data_offset as usize;
        assert!(data.get(offset..).is_some_and(|rest| rest.starts_with(b"region,")), "offset {offset}");
    }

    #[test]
    fn test_sniff_cuts_a_partial_record() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n7,8";
        let format = sniff(data, false).unwrap();
        assert_eq!(format.columns, 3);
    }

    #[test]
    fn test_sniff_legacy_encoding() {
        // "Größe" and "Fläche" in windows-1252
        let data = b"Name;Gr\xF6\xDFe;Fl\xE4che\nA;1;2\nB;3;4\nC;5;6\n";
        let format = sniff(data, true).unwrap();
        assert!(format.transcoded());
        assert_eq!(format.delimiter, b';');
        assert_eq!(format.data_offset, 0);
    }

    #[test]
    fn test_sniff_empty() {
        assert!(matches!(sniff(b"", true), Err(SnifferError::EmptyData)));
    }
}
