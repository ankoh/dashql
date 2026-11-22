//! The dialect of a CSV file: its encoding, delimiter, quote, header and preamble, found with the Table Uniformity
//! Method of García (2024), "Detecting CSV File Dialects by Table Uniformity Measurement and Data Type Inference".
//!
//! Adopted from csv-nose 1.4.0 by Joel Natividad (<https://github.com/ankoh/csv-nose>, the fork of the MIT release
//! before the license switch), MIT licensed, see `packages/csv-sniffer/LICENSE-MIT`. Changes: the sniffer works on a
//! sample in memory (no files, readers, HTTP or command line tool), it scores the dialects on one thread (no rayon,
//! wasm32 has no threads), the patterns that fail to compile match nothing instead of panicking, and std replaces
//! simdutf8, bytecount, foldhash and thiserror.
//!
//! The dialect scores every candidate: (delimiter, quote, line terminator) combinations, by how uniform the field
//! counts of the parsed rows are and how consistent the types of their columns are, and picks the best.

mod encoding;
mod error;
mod field_type;
pub mod metadata;
mod sample;
mod sniffer;
mod tum;

pub(crate) use encoding::detect_sample_encoding;
pub use encoding::{detect_encoding, is_utf8, EncodingInfo};
pub use error::{Result, SnifferError};
pub use field_type::Type;
pub use metadata::{Dialect, Header, Metadata, Quote};
pub use sample::{DatePreference, SampleSize};
pub(crate) use sniffer::skip_preamble;
pub use sniffer::Sniffer;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_api() {
        // Verify all public types are accessible
        let _sniffer = Sniffer::new();
        let _sample = SampleSize::Records(100);
        let _date_pref = DatePreference::MdyFormat;
        let _quote = Quote::Some(b'"');
        let _type = Type::Text;
    }

    #[test]
    fn test_metadata_constructors_preserve_compatibility_and_allow_encoding() {
        let dialect = Dialect::default();
        let metadata = Metadata::new(dialect.clone(), 10, 2, vec![], vec![]);
        assert_eq!(metadata.encoding, EncodingInfo::new(true, false));

        let encoding = EncodingInfo::with_name("windows-1252", false, false);
        let metadata = Metadata::with_encoding(dialect, encoding, 10, 2, vec![], vec![]);
        assert_eq!(metadata.encoding, encoding);
        assert!(!metadata.dialect.is_utf8);
    }

    #[test]
    fn test_sniff_simple_csv() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";
        let sniffer = Sniffer::new();

        let metadata = sniffer.sniff_bytes(data).unwrap();

        assert_eq!(metadata.dialect.delimiter, b',');
        assert_eq!(metadata.num_fields, 3);
    }

    #[test]
    fn test_builder_pattern() {
        let mut sniffer = Sniffer::new();
        sniffer
            .sample_size(SampleSize::Bytes(4096))
            .date_preference(DatePreference::DmyFormat)
            .delimiter(b';')
            .quote(Quote::None);

        // Verify builder returns &mut Self for chaining
    }
}
