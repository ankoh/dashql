//! Generation of potential CSV dialect combinations.

use crate::dialect::metadata::Quote;

/// A potential CSV dialect to test.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PotentialDialect {
    /// Field delimiter character.
    pub delimiter: u8,
    /// Quote character configuration.
    pub quote: Quote,
    /// Line terminator sequence.
    pub line_terminator: LineTerminator,
}

impl PotentialDialect {
    /// Create a new potential dialect.
    pub const fn new(delimiter: u8, quote: Quote, line_terminator: LineTerminator) -> Self {
        Self { delimiter, quote, line_terminator }
    }
}

/// Line terminator sequences.
#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LineTerminator {
    /// Unix-style line ending (\n).
    LF,
    /// Windows-style line ending (\r\n).
    CRLF,
    /// Old Mac-style line ending (\r).
    CR,
}

impl LineTerminator {
    /// Returns the byte sequence for this line terminator.
    #[allow(dead_code)]
    pub const fn as_bytes(&self) -> &'static [u8] {
        match self {
            LineTerminator::LF => b"\n",
            LineTerminator::CRLF => b"\r\n",
            LineTerminator::CR => b"\r",
        }
    }

    /// Returns the string representation.
    #[allow(dead_code)]
    pub const fn as_str(&self) -> &'static str {
        match self {
            LineTerminator::LF => "\\n",
            LineTerminator::CRLF => "\\r\\n",
            LineTerminator::CR => "\\r",
        }
    }
}

/// Common delimiters to test (ordered by frequency in real-world data).
/// Note: Colon is intentionally excluded as it commonly appears in time values (HH:MM:SS).
// pub const DELIMITERS: &[u8] = &[
//     b',',  // Comma (most common)
//     b';',  // Semicolon (common in European locales)
//     b'\t', // Tab (TSV files)
//     b'|',  // Pipe
//     b' ',  // Space
//     b'^',  // Caret
//     b'~',  // Tilde
//     b'#',  // Hash (rare)car
//     b'&',  // Ampersand (rare)
// ];
pub const DELIMITERS: &[u8] = b",;\t| ^~#&\xa7/";

/// Quote characters to test.
pub const QUOTES: &[Quote] = &[
    Quote::Some(b'"'),  // Double quote (most common)
    Quote::Some(b'\''), // Single quote
    Quote::None,        // No quoting
];

/// Line terminators to test.
#[allow(dead_code)]
pub const LINE_TERMINATORS: &[LineTerminator] = &[
    LineTerminator::CRLF, // Windows (check first as it's a superset of LF)
    LineTerminator::LF,   // Unix
    LineTerminator::CR,   // Old Mac
];

/// Generate all potential dialect combinations.
///
/// Returns 99 combinations (11 delimiters × 3 quotes × 3 line endings).
///
/// Note the live sniffing path does not use this: it detects the line
/// terminator first and calls [`generate_dialects_with_terminator`], which
/// yields 33 candidates.
#[allow(dead_code)]
pub fn generate_potential_dialects() -> Vec<PotentialDialect> {
    let mut dialects = Vec::with_capacity(DELIMITERS.len() * QUOTES.len() * LINE_TERMINATORS.len());

    for &delimiter in DELIMITERS {
        for &quote in QUOTES {
            for &line_terminator in LINE_TERMINATORS {
                dialects.push(PotentialDialect::new(delimiter, quote, line_terminator));
            }
        }
    }

    dialects
}

/// Detect the most likely line terminator from data.
pub fn detect_line_terminator(data: &[u8]) -> LineTerminator {
    let mut crlf_count = 0;
    let mut lf_count = 0;
    let mut cr_count = 0;

    let mut bytes = data.iter().copied().peekable();
    while let Some(byte) = bytes.next() {
        if byte == b'\r' {
            if bytes.next_if_eq(&b'\n').is_some() {
                crlf_count += 1;
                continue;
            }
            cr_count += 1;
        } else if byte == b'\n' {
            lf_count += 1;
        }
    }

    // Prefer CRLF if present (Windows), then LF (Unix), then CR (old Mac)
    if crlf_count > 0 && crlf_count >= lf_count && crlf_count >= cr_count {
        LineTerminator::CRLF
    } else if lf_count >= cr_count {
        LineTerminator::LF
    } else {
        LineTerminator::CR
    }
}

/// Generate potential dialects with a detected line terminator.
///
/// This reduces the search space by detecting the line terminator first.
pub fn generate_dialects_with_terminator(line_terminator: LineTerminator) -> Vec<PotentialDialect> {
    let mut dialects = Vec::with_capacity(DELIMITERS.len() * QUOTES.len());

    for &delimiter in DELIMITERS {
        for &quote in QUOTES {
            dialects.push(PotentialDialect::new(delimiter, quote, line_terminator));
        }
    }

    dialects
}

/// Normalize line endings to LF for consistent parsing.
///
/// Returns `Cow::Borrowed` for LF data (zero-copy) and `Cow::Owned` for CR/CRLF.
/// This is used to normalize data once before scoring multiple dialects.
pub fn normalize_line_endings(data: &[u8], line_terminator: LineTerminator) -> std::borrow::Cow<'_, [u8]> {
    use std::borrow::Cow;

    match line_terminator {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_potential_dialects() {
        let dialects = generate_potential_dialects();
        assert_eq!(dialects.len(), 99); // 11 * 3 * 3
    }

    #[test]
    fn test_detect_line_terminator() {
        assert_eq!(detect_line_terminator(b"a,b\nc,d\n"), LineTerminator::LF);
        assert_eq!(detect_line_terminator(b"a,b\r\nc,d\r\n"), LineTerminator::CRLF);
        assert_eq!(detect_line_terminator(b"a,b\rc,d\r"), LineTerminator::CR);
    }
}
