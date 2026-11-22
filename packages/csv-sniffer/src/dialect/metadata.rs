use crate::dialect::encoding::EncodingInfo;
use crate::dialect::field_type::Type;
use std::fmt;

/// Metadata about a CSV file.
#[derive(Debug, Clone)]
pub struct Metadata {
    /// The detected CSV dialect.
    pub dialect: Dialect,
    /// The detected input encoding.
    pub encoding: EncodingInfo,
    /// Average record length in bytes.
    pub avg_record_len: usize,
    /// Number of fields per record.
    pub num_fields: usize,
    /// Field names from the header row (or generated names if no header).
    pub fields: Vec<String>,
    /// Detected type for each field.
    pub types: Vec<Type>,
}

impl Metadata {
    /// Create a new Metadata instance.
    pub const fn new(
        dialect: Dialect,
        avg_record_len: usize,
        num_fields: usize,
        fields: Vec<String>,
        types: Vec<Type>,
    ) -> Self {
        let encoding = EncodingInfo::new(dialect.is_utf8, false);
        Self::with_encoding(dialect, encoding, avg_record_len, num_fields, fields, types)
    }

    /// Create a new Metadata instance with explicit encoding information.
    pub const fn with_encoding(
        mut dialect: Dialect,
        encoding: EncodingInfo,
        avg_record_len: usize,
        num_fields: usize,
        fields: Vec<String>,
        types: Vec<Type>,
    ) -> Self {
        dialect.is_utf8 = encoding.is_utf8;
        Self { dialect, encoding, avg_record_len, num_fields, fields, types }
    }
}

/// CSV dialect specification.
#[derive(Debug, Clone, PartialEq)]
pub struct Dialect {
    /// Field delimiter character.
    pub delimiter: u8,
    /// Header configuration.
    pub header: Header,
    /// Quote character configuration.
    pub quote: Quote,
    /// Whether the CSV has variable field counts across records.
    pub flexible: bool,
    /// Whether the sniffed sample is valid UTF-8.
    ///
    /// Like every other field here this is inferred from the sample, not the
    /// whole file: invalid bytes beyond the sampled prefix are not seen. A
    /// multi-byte character split by the sample boundary does *not* count as
    /// invalid.
    pub is_utf8: bool,
}

impl Default for Dialect {
    fn default() -> Self {
        Self { delimiter: b',', header: Header::default(), quote: Quote::Some(b'"'), flexible: false, is_utf8: true }
    }
}

impl Dialect {
    /// Create a new Dialect with the given parameters.
    pub const fn new(delimiter: u8, header: Header, quote: Quote, flexible: bool, is_utf8: bool) -> Self {
        Self { delimiter, header, quote, flexible, is_utf8 }
    }
}

/// Header configuration for a CSV file.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Header {
    /// Whether the CSV has a header row.
    pub has_header_row: bool,
    /// Number of rows to skip before the data (preamble/comment rows).
    pub num_preamble_rows: usize,
}

impl Header {
    /// Create a new Header configuration.
    pub const fn new(has_header_row: bool, num_preamble_rows: usize) -> Self {
        Self { has_header_row, num_preamble_rows }
    }
}

/// Quote character configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Quote {
    /// No quoting.
    None,
    /// Quote with the specified character.
    Some(u8),
}

impl Default for Quote {
    fn default() -> Self {
        Quote::Some(b'"')
    }
}

impl Quote {
    /// Returns the quote character if set.
    #[inline]
    pub fn char(&self) -> Option<u8> {
        match self {
            Quote::None => None,
            Quote::Some(c) => Some(*c),
        }
    }
}

impl fmt::Display for Quote {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Quote::None => write!(f, "none"),
            Quote::Some(c) => write!(f, "{}", *c as char),
        }
    }
}
