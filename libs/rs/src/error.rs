use std::fmt;

#[derive(Debug, Clone)]
pub enum Error {
    RawError(String),
    ErrorDecodingError,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::RawError(e) => write!(f, "{}", e),
            Error::ErrorDecodingError => write!(f, "string decoding"),
        }
    }
}

