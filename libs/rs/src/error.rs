use std::fmt;

#[derive(Debug, Clone)]
pub enum Error {
    Raw(String),
    InvalidStringData,
}

impl From<std::ffi::NulError> for Error {
    fn from(_: std::ffi::NulError) -> Self {
        Error::InvalidStringData
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Raw(e) => write!(f, "{}", e),
            Error::InvalidStringData => write!(f, "invalid string data"),
        }
    }
}

