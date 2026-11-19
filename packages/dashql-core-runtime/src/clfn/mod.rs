//! Client functions: `CALL`s in a namespace with a spec run in the client as HTTP requests. The core checks a call
//! against the signatures of its spec and describes it as JSON (`describe_client_function_call`), this module applies the
//! spec to the description: it builds the requests, pages, polls, reads the errors and turns every page into rows of
//! the result table. It knows no service, a connector binding says where a host is and what a request to it carries.
//!
//! Sans-IO: a call is a state machine that returns the next request or wait and takes the response, the host sends it
//! with its HTTP client. See `docs/design/client_functions.md`.

pub mod connection;
pub mod json;
pub mod request;
pub mod result;
pub mod runtime;
pub mod spec;
pub mod specs;
pub mod time;

use std::fmt;

pub use connection::{
    start_connection_client_function, ClientFunctionBinding, ClientFunctionRegistrations, ClientFunctionRegistryEffect,
    ConnectionCallStart, client_function_binding,
};
pub use crate::http::{HttpRequest, HttpResponse};
pub use request::{
    build_client_function_request, follow_request, http_request, request_url, resolve_follow_url, ClientFunctionHostTarget,
    ClientFunctionRequest, ClientFunctionVariables, STANDARD_OPTIONS,
};
pub use result::{Cell, ClientFunctionResult, ColumnType, ResultField};
pub use runtime::{explain_client_function_call, CallStep, ClientFunctionCallRun, POLL_SAME};
pub use spec::{ClientFunction, ClientFunctionCallDescription, ClientFunctionSpec};
pub use specs::find_client_function_spec;

/// A call that failed, the status is set if a service answered
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientFunctionError {
    /// The message
    pub message: String,
    /// The HTTP status of the response that failed the call
    pub status: Option<u16>,
}

impl ClientFunctionError {
    /// An error without a response
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), status: None }
    }
    /// An error of a response
    pub fn with_status(message: impl Into<String>, status: u16) -> Self {
        Self { message: message.into(), status: Some(status) }
    }
}

impl fmt::Display for ClientFunctionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ClientFunctionError {}
