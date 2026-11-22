use std::fmt;
use std::io;

/// Error type for CSV sniffing operations.
#[derive(Debug)]
pub enum SnifferError {
    /// IO error during file operations.
    Io(io::Error),

    /// CSV parsing error.
    Csv(csv::Error),

    /// No valid dialect could be detected.
    NoDialectDetected(String),

    /// Empty file or no data.
    EmptyData,

    /// Invalid configuration.
    InvalidConfig(String),
}

impl fmt::Display for SnifferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SnifferError::Io(e) => write!(f, "IO error: {e}"),
            SnifferError::Csv(e) => write!(f, "CSV parsing error: {e}"),
            SnifferError::NoDialectDetected(m) => write!(f, "Could not detect CSV dialect: {m}"),
            SnifferError::EmptyData => write!(f, "Empty file or no data to analyze"),
            SnifferError::InvalidConfig(m) => write!(f, "Invalid configuration: {m}"),
        }
    }
}

impl std::error::Error for SnifferError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            SnifferError::Io(e) => Some(e),
            SnifferError::Csv(e) => Some(e),
            _ => None,
        }
    }
}

impl From<io::Error> for SnifferError {
    fn from(e: io::Error) -> Self {
        SnifferError::Io(e)
    }
}

impl From<csv::Error> for SnifferError {
    fn from(e: csv::Error) -> Self {
        SnifferError::Csv(e)
    }
}

/// Result type alias for sniffing operations.
pub type Result<T> = std::result::Result<T, SnifferError>;
