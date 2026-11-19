//! The errors of the Trino connector.

use std::collections::BTreeMap;
use std::fmt;

use crate::connections::DetailedError;

/// What went wrong
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrinoErrorKind {
    /// The server rejected a request with a status
    Http { status: u16 },
    /// A request failed in the network
    Network,
    /// Trino reported an error of the query, with its error code
    Query { code: i64 },
    /// A response doesn't follow the protocol, e.g. a body that is no JSON or rows without a schema
    Protocol,
    /// The OAuth flow failed, e.g. the callback reported an error
    OAuth,
    /// The task was aborted
    Aborted,
}

/// An error of the Trino connector with a message and details, e.g. the status of a rejected request
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoError {
    /// What went wrong
    pub kind: TrinoErrorKind,
    /// The message
    pub message: String,
    /// The details, empty without any
    pub data: BTreeMap<String, String>,
}

impl TrinoError {
    /// An error with a message and no details
    pub fn new(kind: TrinoErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), data: BTreeMap::new() }
    }

    /// A rejected request: the status and the status text are the details
    pub fn http(message: impl Into<String>, status: u16, status_text: &str) -> Self {
        let mut error = Self::new(TrinoErrorKind::Http { status }, message);
        error.data.insert("status".into(), status.to_string());
        error.data.insert("message".into(), status_text.to_string());
        error
    }

    /// A response that doesn't follow the protocol
    pub fn protocol(message: impl Into<String>) -> Self {
        Self::new(TrinoErrorKind::Protocol, message)
    }

    /// The error as the error of a connection, e.g. a failed health check
    pub fn to_detailed_error(&self) -> DetailedError {
        DetailedError { message: self.message.clone(), data: self.data.clone() }
    }
}

impl fmt::Display for TrinoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for TrinoError {}

/// A result of the Trino connector
pub type TrinoResult<T> = std::result::Result<T, TrinoError>;
