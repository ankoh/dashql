//! Encoding detection and transcoding using chardetng and `encoding_rs`.

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};

/// Check if the given bytes are valid UTF-8.
///
pub fn is_utf8(data: &[u8]) -> bool {
    std::str::from_utf8(data).is_ok()
}

/// Check if the data starts with a UTF-8 BOM (Byte Order Mark).
///
/// The UTF-8 BOM is the byte sequence: EF BB BF
pub fn has_utf8_bom(data: &[u8]) -> bool {
    data.starts_with(&[0xEF, 0xBB, 0xBF])
}

/// Skip the UTF-8 BOM if present and return the remaining data.
pub fn skip_bom(data: &[u8]) -> &[u8] {
    data.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(data)
}

/// Check whether a *sampled* buffer is valid UTF-8, tolerating a multi-byte
/// character cut in half by the end of the buffer.
///
/// Samples are truncated at a raw byte offset, so a boundary landing inside a
/// multi-byte character would otherwise report a perfectly valid file as
/// non-UTF-8. An *incomplete* sequence at the very end of the buffer is
/// accepted; a genuinely invalid sequence anywhere is not.
///
/// Only for data known to be a prefix of something larger. Callers holding
/// complete input want [`is_utf8`] or [`detect_encoding`], both of which stay
/// strict — an incomplete sequence at a real EOF is malformed, not truncated.
pub(crate) fn is_utf8_ignoring_truncated_tail(data: &[u8]) -> bool {
    match std::str::from_utf8(data) {
        Ok(_) => true,
        // `error_len() == None` means "incomplete sequence at end of input",
        // which is exactly the sample-boundary case.
        Err(e) => e.error_len().is_none(),
    }
}

/// Detect the encoding of the data.
///
/// Detects UTF-8, UTF-16 BOMs, and legacy encodings using `chardetng`.
///
/// Strict: the data is taken to be complete, so an incomplete multi-byte
/// sequence at the end is invalid. The sniffer tolerates an incomplete UTF-8
/// sequence when a sample boundary splits a character.
pub fn detect_encoding(data: &[u8]) -> EncodingInfo {
    detect_encoding_impl(data, is_utf8).1
}

/// The encoding of a sample, as `encoding_rs` names it: an incomplete character at its end doesn't make it no UTF-8
pub(crate) fn detect_sample_encoding(data: &[u8]) -> &'static encoding_rs::Encoding {
    detect_encoding_impl(data, is_utf8_ignoring_truncated_tail).0
}

/// Detect the input encoding, retaining the `encoding_rs` value needed for
/// transcoding alongside the public metadata representation.
fn detect_encoding_impl(
    data: &[u8],
    utf8_validator: fn(&[u8]) -> bool,
) -> (&'static encoding_rs::Encoding, EncodingInfo) {
    // Check BOMs before UTF-8 validation and statistical detection. UTF-16
    // data is not valid UTF-8, and chardetng cannot reliably identify it.
    if data.starts_with(&[0xFF, 0xFE]) {
        return (encoding_rs::UTF_16LE, EncodingInfo::with_name("UTF-16LE", false, true));
    }
    if data.starts_with(&[0xFE, 0xFF]) {
        return (encoding_rs::UTF_16BE, EncodingInfo::with_name("UTF-16BE", false, true));
    }

    let has_bom = has_utf8_bom(data);
    let data_without_bom = skip_bom(data);
    let valid_utf8 = utf8_validator(data_without_bom);

    if valid_utf8 {
        return (encoding_rs::UTF_8, EncodingInfo::with_name("UTF-8", true, has_bom));
    }

    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(data, true);
    let encoding = detector.guess(None, Utf8Detection::Allow);

    (encoding, EncodingInfo::with_name(encoding.name(), false, has_bom))
}

/// Information about the detected encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodingInfo {
    /// Name of the detected encoding, such as `UTF-8` or `windows-1252`.
    pub name: &'static str,
    /// Whether the data is valid UTF-8.
    pub is_utf8: bool,
    /// Whether a byte order mark was present.
    pub has_bom: bool,
}

impl EncodingInfo {
    /// Create a new `EncodingInfo`.
    pub const fn new(is_utf8: bool, has_bom: bool) -> Self {
        Self { name: if is_utf8 { "UTF-8" } else { "unknown" }, is_utf8, has_bom }
    }

    /// Create an `EncodingInfo` with an explicit encoding name.
    pub const fn with_name(name: &'static str, is_utf8: bool, has_bom: bool) -> Self {
        Self { name, is_utf8, has_bom }
    }
}

/// Detect the encoding of data and transcode to UTF-8 if necessary.
///
/// Uses chardetng for robust encoding detection supporting:
/// - Windows-1251 (Cyrillic)
/// - Windows-1250 (Central European)
/// - ISO-8859 variants
/// - GB2312/GBK (Chinese)
/// - UTF-16 LE/BE
/// - And many more
///
/// Returns the UTF-8 working data and metadata for the original encoding.
/// The UTF-8 check tolerates an incomplete final code point because the
/// sniffer operates on samples that may end between bytes of a character.
pub fn detect_and_transcode(data: &[u8]) -> (std::borrow::Cow<'_, [u8]>, EncodingInfo) {
    let (encoding, encoding_info) = detect_encoding_impl(data, is_utf8_ignoring_truncated_tail);

    // UTF-8 input can be parsed without allocating a transcoded copy.
    if encoding == encoding_rs::UTF_8 {
        return (std::borrow::Cow::Borrowed(data), encoding_info);
    }

    // Transcode to UTF-8
    let (decoded, _, _) = encoding.decode(data);
    let transcoded = std::borrow::Cow::Owned(decoded.into_owned().into_bytes());
    (transcoded, encoding_info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_utf8() {
        assert!(is_utf8(b"Hello, World!"));
        assert!(is_utf8("こんにちは".as_bytes()));
        assert!(is_utf8(b""));
    }

    #[test]
    fn test_invalid_utf8() {
        // Invalid UTF-8 sequence
        assert!(!is_utf8(&[0xFF, 0xFE]));
        assert!(!is_utf8(&[0x80, 0x81, 0x82]));
    }

    #[test]
    fn test_utf8_bom() {
        let with_bom = [0xEF, 0xBB, 0xBF, b'a', b'b', b'c'];
        let without_bom = b"abc";

        assert!(has_utf8_bom(&with_bom));
        assert!(!has_utf8_bom(without_bom));

        assert_eq!(skip_bom(&with_bom), b"abc");
        assert_eq!(skip_bom(without_bom), b"abc");
    }

    #[test]
    fn test_detect_encoding() {
        let info = detect_encoding(b"Hello");
        assert_eq!(info.name, "UTF-8");
        assert!(info.is_utf8);
        assert!(!info.has_bom);

        let with_bom = [0xEF, 0xBB, 0xBF, b'H', b'i'];
        let info = detect_encoding(&with_bom);
        assert_eq!(info.name, "UTF-8");
        assert!(info.is_utf8);
        assert!(info.has_bom);

        let utf16le = [0xFF, 0xFE, b'H', 0x00];
        let info = detect_encoding(&utf16le);
        assert_eq!(info.name, "UTF-16LE");
        assert!(!info.is_utf8);
        assert!(info.has_bom);
    }

    #[test]
    fn test_detect_encoding_is_strict_about_incomplete_tail() {
        // 0xC3 opens a two-byte sequence that never completes. At a real EOF
        // that is malformed, and the public API must say so.
        assert!(!detect_encoding(b"caf\xC3").is_utf8);
        assert!(!is_utf8(b"caf\xC3"));
    }

    #[test]
    fn test_sampled_check_tolerates_only_a_truncated_tail() {
        // A sample cut mid-character is still valid UTF-8 data.
        assert!(is_utf8_ignoring_truncated_tail(b"caf\xC3"));
        // ...but a bad sequence in the middle is not, tail intact or not.
        assert!(!is_utf8_ignoring_truncated_tail(b"ca\xC3\xC3fe"));
        assert!(!is_utf8_ignoring_truncated_tail(&[0x80, 0x81]));
        assert!(is_utf8_ignoring_truncated_tail("café".as_bytes()));
    }

    #[test]
    fn test_detect_and_transcode_utf8() {
        // Valid UTF-8 should not be transcoded and should report its encoding.
        let data = b"Hello, World!";
        let (result, encoding) = detect_and_transcode(data);
        assert_eq!(&result[..], data);
        assert_eq!(encoding, EncodingInfo::with_name("UTF-8", true, false));
    }

    #[test]
    fn test_detect_and_transcode_utf16_le() {
        // UTF-16 LE with BOM: "Hi"
        let data: &[u8] = &[0xFF, 0xFE, b'H', 0x00, b'i', 0x00];
        let (result, encoding) = detect_and_transcode(data);
        // Result should be UTF-8 (without BOM marker in content)
        assert!(is_utf8(&result));
        assert_eq!(encoding, EncodingInfo::with_name("UTF-16LE", false, true));
    }

    #[test]
    fn test_detect_and_transcode_windows1251() {
        // Windows-1251 encoded Cyrillic text: "Привет" (Hello in Russian)
        // П=0xCF, р=0xF0, и=0xE8, в=0xE2, е=0xE5, т=0xF2
        let data: &[u8] = &[0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2];
        let (result, encoding) = detect_and_transcode(data);
        // Result should be valid UTF-8
        assert!(is_utf8(&result));
        assert_eq!(encoding.name, "windows-1251");
        assert!(!encoding.is_utf8);
        assert!(!encoding.has_bom);
    }
}
