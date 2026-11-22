//! Compiled regex patterns for type detection.
//!
//! These patterns are based on the CSVsniffer paper and extended for
//! better real-world coverage.

use regex::Regex;

/// Pattern for NULL-like values.
pub static NULL_PATTERN: std::sync::LazyLock<Option<Regex>> = std::sync::LazyLock::new(|| {
    Regex::new(r"(?i)^(null|nil|none|na|n/a|\?|nan|-|--|\.|\.\.|#n/a|#value!|#ref!|#div/0!)$").ok()
});

/// Pattern for unsigned integers (non-negative whole numbers).
pub static UNSIGNED_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[+]?\d{1,20}$").ok());

/// Pattern for signed integers (including negative).
pub static SIGNED_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[-+]?\d{1,20}$").ok());

/// Pattern for floating point numbers (various formats).
pub static FLOAT_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[-+]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][-+]?\d+)?$").ok());

/// Pattern for European-style floats (comma as decimal separator).
pub static FLOAT_EURO_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[-+]?\d+,\d+$").ok());

/// Pattern for numbers with thousand separators (US style: 1,234,567.89).
pub static FLOAT_THOUSANDS_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[-+]?(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)$").ok());

/// Pattern for boolean values.
pub static BOOLEAN_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"(?i)^(true|false|yes|no|y|n|t|f|1|0|on|off)$").ok());

/// Pattern for ISO 8601 dates (YYYY-MM-DD).
pub static DATE_ISO_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}$").ok());

/// Pattern for US-style dates (MM/DD/YYYY or MM-DD-YYYY).
pub static DATE_US_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$").ok());

/// Pattern for European-style dates (DD.MM.YYYY).
pub static DATE_EURO_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^\d{1,2}\.\d{1,2}\.\d{2,4}$").ok());

/// Pattern for ISO 8601 datetime (YYYY-MM-DDTHH:MM:SS).
pub static DATETIME_ISO_PATTERN: std::sync::LazyLock<Option<Regex>> = std::sync::LazyLock::new(|| {
    Regex::new(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$").ok()
});

/// Pattern for general datetime with various separators.
pub static DATETIME_GENERAL_PATTERN: std::sync::LazyLock<Option<Regex>> = std::sync::LazyLock::new(|| {
    Regex::new(r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}[T ]?\d{1,2}:\d{2}(:\d{2})?(\s*(AM|PM|am|pm))?$").ok()
});

/// Pattern for time values (HH:MM:SS).
pub static TIME_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(\s*(AM|PM|am|pm))?$").ok());

/// Pattern for email addresses.
pub static EMAIL_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$").ok());

/// Pattern for URLs.
pub static URL_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^(https?|ftp)://[^\s/$.?#].[^\s]*$").ok());

/// Pattern for IPv4 addresses.
pub static IPV4_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$").ok());

/// Pattern for currency values.
pub static CURRENCY_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[$€£¥₹]?\s*[-+]?[\d,]+\.?\d*$|^[-+]?[\d,]+\.?\d*\s*[$€£¥₹]$").ok());

/// Pattern for percentage values.
pub static PERCENTAGE_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[-+]?\d+\.?\d*\s*%$").ok());

/// Pattern for UUID values.
pub static UUID_PATTERN: std::sync::LazyLock<Option<Regex>> = std::sync::LazyLock::new(|| {
    Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").ok()
});

/// Pattern for alphanumeric identifiers (common for IDs).
pub static ALPHANUM_PATTERN: std::sync::LazyLock<Option<Regex>> =
    std::sync::LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]+$").ok());

/// All patterns with their type categories for scoring.
pub struct PatternCategory {
    pub pattern: &'static std::sync::LazyLock<Option<Regex>>,
    #[allow(dead_code)]
    pub category: &'static str,
    pub weight: f64,
}

/// Static pattern categories for type detection (cached via LazyLock).
static PATTERN_CATEGORIES: std::sync::LazyLock<Vec<PatternCategory>> = std::sync::LazyLock::new(|| {
    vec![
        PatternCategory { pattern: &NULL_PATTERN, category: "null", weight: 0.5 },
        PatternCategory { pattern: &BOOLEAN_PATTERN, category: "boolean", weight: 1.0 },
        PatternCategory { pattern: &UNSIGNED_PATTERN, category: "unsigned", weight: 1.0 },
        PatternCategory { pattern: &SIGNED_PATTERN, category: "signed", weight: 1.0 },
        PatternCategory { pattern: &FLOAT_PATTERN, category: "float", weight: 1.0 },
        PatternCategory { pattern: &FLOAT_EURO_PATTERN, category: "float_euro", weight: 0.9 },
        PatternCategory { pattern: &FLOAT_THOUSANDS_PATTERN, category: "float_thousands", weight: 0.9 },
        PatternCategory { pattern: &DATE_ISO_PATTERN, category: "date", weight: 1.0 },
        PatternCategory { pattern: &DATE_US_PATTERN, category: "date", weight: 0.9 },
        PatternCategory { pattern: &DATE_EURO_PATTERN, category: "date", weight: 0.9 },
        PatternCategory { pattern: &DATETIME_ISO_PATTERN, category: "datetime", weight: 1.0 },
        PatternCategory { pattern: &DATETIME_GENERAL_PATTERN, category: "datetime", weight: 0.9 },
        PatternCategory { pattern: &TIME_PATTERN, category: "time", weight: 0.8 },
        PatternCategory { pattern: &EMAIL_PATTERN, category: "email", weight: 0.8 },
        PatternCategory { pattern: &URL_PATTERN, category: "url", weight: 0.8 },
        PatternCategory { pattern: &IPV4_PATTERN, category: "ipv4", weight: 0.8 },
        PatternCategory { pattern: &CURRENCY_PATTERN, category: "currency", weight: 0.9 },
        PatternCategory { pattern: &PERCENTAGE_PATTERN, category: "percentage", weight: 0.9 },
        PatternCategory { pattern: &UUID_PATTERN, category: "uuid", weight: 0.8 },
        PatternCategory { pattern: &ALPHANUM_PATTERN, category: "alphanum", weight: 0.3 },
    ]
});

/// Get all pattern categories for type detection.
/// Returns a static reference to avoid allocating a new Vec on each call.
pub fn get_pattern_categories() -> &'static [PatternCategory] {
    &PATTERN_CATEGORIES
}

/// All pattern categories compiled into one set, in `PATTERN_CATEGORIES` order,
/// so the lowest matching index is the first category an ordered scan would hit.
/// A pattern that failed to compile matches nothing in the set, the indexes stay those of the categories.
pub static PATTERN_SET: std::sync::LazyLock<Option<regex::RegexSet>> = std::sync::LazyLock::new(|| {
    regex::RegexSet::new(PATTERN_CATEGORIES.iter().map(|pc| pc.pattern.as_ref().map_or(r"[^\s\S]", Regex::as_str))).ok()
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unsigned_pattern() {
        assert!(UNSIGNED_PATTERN.as_ref().unwrap().is_match("123"));
        assert!(UNSIGNED_PATTERN.as_ref().unwrap().is_match("0"));
        assert!(UNSIGNED_PATTERN.as_ref().unwrap().is_match("+42"));
        assert!(!UNSIGNED_PATTERN.as_ref().unwrap().is_match("-42"));
        assert!(!UNSIGNED_PATTERN.as_ref().unwrap().is_match("12.34"));
    }

    #[test]
    fn test_boolean_pattern() {
        assert!(BOOLEAN_PATTERN.as_ref().unwrap().is_match("true"));
        assert!(BOOLEAN_PATTERN.as_ref().unwrap().is_match("FALSE"));
        assert!(BOOLEAN_PATTERN.as_ref().unwrap().is_match("yes"));
        assert!(BOOLEAN_PATTERN.as_ref().unwrap().is_match("1"));
        assert!(!BOOLEAN_PATTERN.as_ref().unwrap().is_match("maybe"));
    }

    #[test]
    fn test_date_patterns() {
        assert!(DATE_ISO_PATTERN.as_ref().unwrap().is_match("2023-12-31"));
        assert!(DATE_ISO_PATTERN.as_ref().unwrap().is_match("2023/12/31"));
        assert!(DATE_US_PATTERN.as_ref().unwrap().is_match("12/31/2023"));
        assert!(DATE_EURO_PATTERN.as_ref().unwrap().is_match("31.12.2023"));
    }

    #[test]
    fn test_datetime_patterns() {
        assert!(DATETIME_ISO_PATTERN.as_ref().unwrap().is_match("2023-12-31T12:30:45"));
        assert!(DATETIME_ISO_PATTERN.as_ref().unwrap().is_match("2023-12-31 12:30:45"));
        assert!(DATETIME_ISO_PATTERN.as_ref().unwrap().is_match("2023-12-31T12:30:45Z"));
        assert!(DATETIME_ISO_PATTERN.as_ref().unwrap().is_match("2023-12-31T12:30:45+05:30"));
    }

    #[test]
    fn test_null_pattern() {
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("NULL"));
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("null"));
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("NA"));
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("N/A"));
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("-"));
        assert!(NULL_PATTERN.as_ref().unwrap().is_match("NaN"));
    }
}
