//! The errors of the HTTP API of Hyper: the error bodies of the server, an error response with its diagnostics and the
//! error type of the module.

use std::fmt;

use serde_json::{Map, Value};

use super::error_info::{from_http_error_response, HyperErrorInfo};
use crate::connections::DetailedError;
use crate::http::HttpResponse;

/// The log context of the HTTP client, the target of its errors
pub const HTTP_CLIENT_LOG_CONTEXT: &str = "hyperdb_http_client";
/// The log context of the web channel, the target of the query errors it raises
pub const WEB_CHANNEL_LOG_CONTEXT: &str = "web_hyperdb_http_client";

/// The maximum length of a raw header value in the error diagnostics
const MAX_DIAGNOSTIC_LENGTH: usize = 2000;
/// How deep to search nested objects for an error
const MAX_ERROR_SEARCH_DEPTH: usize = 3;

/// The position of an error in the SQL text, the offsets as the server wrote them
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryErrorPosition {
    pub error_begin_character_offset: String,
    pub error_end_character_offset: String,
}

/// The details of an error body
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QueryErrorDetails {
    pub customer_hint: Option<String>,
    pub customer_detail: Option<String>,
    pub system_detail: Option<String>,
    pub error_source: Option<String>,
    pub position: Option<QueryErrorPosition>,
}

/// An error of the server: the V3 error envelope, or what the module reads from the other shapes of errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryErrorResponse {
    /// The error code, a SQL state or a word like `INVALID_ARGUMENT`
    pub error: String,
    /// The message, may be empty
    pub message: String,
    /// The details
    pub details: Option<QueryErrorDetails>,
}

/// A non-blank string
fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).filter(|text| !text.trim().is_empty()).map(str::to_string)
}

/// The first of two fields, in camelCase or snake_case. A null counts as missing.
fn either<'a>(raw: &'a Map<String, Value>, camel: &str, snake: &str) -> Option<&'a Value> {
    raw.get(camel).filter(|value| !value.is_null()).or_else(|| raw.get(snake))
}

/// An offset of a position as text, like `String(offset)`
fn offset_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        other => Some(other.to_string()),
    }
}

/// Read a position with offsets in camelCase or snake_case
fn read_position(position: Option<&Value>) -> Option<QueryErrorPosition> {
    let position = position?.as_object()?;
    let begin = either(position, "errorBeginCharacterOffset", "error_begin_character_offset").and_then(offset_text)?;
    let end = either(position, "errorEndCharacterOffset", "error_end_character_offset").and_then(offset_text)?;
    Some(QueryErrorPosition { error_begin_character_offset: begin, error_end_character_offset: end })
}

/// Read a Hyper ErrorInfo serialized as JSON, in camelCase or snake_case
fn read_error_info(raw: &Map<String, Value>, http_status: u16) -> Option<QueryErrorResponse> {
    let primary_message = non_empty_string(either(raw, "primaryMessage", "primary_message"))?;
    Some(QueryErrorResponse {
        error: non_empty_string(raw.get("sqlstate")).unwrap_or_else(|| format!("HTTP {http_status}")),
        message: primary_message,
        details: Some(QueryErrorDetails {
            customer_hint: non_empty_string(either(raw, "customerHint", "customer_hint")),
            customer_detail: non_empty_string(either(raw, "customerDetail", "customer_detail")),
            system_detail: non_empty_string(either(raw, "systemDetail", "system_detail")),
            error_source: non_empty_string(either(raw, "errorSource", "error_source")),
            position: read_position(raw.get("position")),
        }),
    })
}

/// Read the details object of the V3 error envelope
fn read_envelope_details(details: &Map<String, Value>) -> QueryErrorDetails {
    let text =
        |name: &str| details.get(name).and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string);
    QueryErrorDetails {
        customer_hint: text("customerHint"),
        customer_detail: text("customerDetail"),
        system_detail: text("systemDetail"),
        error_source: text("errorSource"),
        position: read_position(details.get("position")),
    }
}

/// Read an error from a JSON error body or the JSON status header. Recognizes the V3 error envelope, Salesforce error
/// arrays, Hyper ErrorInfo objects, `google.rpc.Status` objects with packed details, and any of these nested in other
/// objects.
pub fn read_error_response(raw: &Value, http_status: u16) -> Option<QueryErrorResponse> {
    read_error_response_at(raw, http_status, 0)
}

fn read_error_response_at(raw: &Value, http_status: u16, depth: usize) -> Option<QueryErrorResponse> {
    if depth > MAX_ERROR_SEARCH_DEPTH {
        return None;
    }
    let object = match raw {
        Value::Array(entries) => {
            return entries.iter().find_map(|entry| read_error_response_at(entry, http_status, depth + 1));
        }
        Value::Object(object) => object,
        _ => return None,
    };

    // Hyper ErrorInfo
    if let Some(info) = read_error_info(object, http_status) {
        return Some(info);
    }

    // google.rpc.Status, prefer a packed ErrorInfo over the terse message
    if let Some(Value::Array(details)) = object.get("details") {
        if let Some(info) =
            details.iter().filter_map(Value::as_object).find_map(|detail| read_error_info(detail, http_status))
        {
            return Some(info);
        }
    }

    // V3 error envelope or Salesforce error
    let message = non_empty_string(object.get("message"));
    let error = non_empty_string(object.get("error"));
    let error_code = non_empty_string(object.get("errorCode"));
    if message.is_some() || error.is_some() || error_code.is_some() {
        return Some(QueryErrorResponse {
            message: message.unwrap_or_default(),
            error: error.or(error_code).unwrap_or_else(|| format!("HTTP {http_status}")),
            details: object.get("details").and_then(Value::as_object).map(read_envelope_details),
        });
    }

    // An error nested in another object, e.g. the error of a query status
    object.values().find_map(|value| read_error_response_at(value, http_status, depth + 1))
}

/// An error response of the HTTP API with the diagnostics of the response
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperHttpError {
    /// The status code
    pub http_status: u16,
    /// The error that the body or the status header holds, none if neither holds one the module recognizes
    pub error_response: Option<QueryErrorResponse>,
    /// The diagnostics of the response for the log, a missing value is none
    pub diagnostics: Vec<(String, Option<String>)>,
}

impl HyperHttpError {
    /// The message: the message of the server, its error code or the status
    pub fn message(&self) -> String {
        let response = self.error_response.as_ref();
        response
            .map(|response| response.message.clone())
            .filter(|message| !message.is_empty())
            .or_else(|| response.map(|response| response.error.clone()).filter(|error| !error.is_empty()))
            .unwrap_or_else(|| format!("HTTP {}", self.http_status))
    }

    /// A diagnostic of the response
    pub fn diagnostic(&self, key: &str) -> Option<&str> {
        self.diagnostics.iter().find(|(name, _)| name == key).and_then(|(_, value)| value.as_deref())
    }
}

/// Truncate a text to a number of characters
fn truncate(text: &str, max_length: usize) -> String {
    match text.char_indices().nth(max_length) {
        Some((end, _)) => format!("{}...", text.get(..end).unwrap_or(text)),
        None => text.to_string(),
    }
}

/// The type of a JSON body, as `typeof` names it
fn body_type(body: &Value) -> &'static str {
    match body {
        Value::Null => "null",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
    }
}

/// The keys of a JSON body that describe an error, of the first entry of an array
fn body_keys(body: &Value) -> String {
    let object = match body {
        Value::Array(entries) => entries.first().and_then(Value::as_object),
        Value::Object(object) => Some(object),
        _ => None,
    };
    let Some(object) = object else {
        return String::new();
    };
    object
        .keys()
        .filter(|key| ["message", "error", "errorCode", "details", "detail"].contains(&key.as_str()))
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(",")
}

/// Check a response: a status from 400 is an error, read from the JSON body or the status header
pub fn check_response(response: &HttpResponse) -> Result<(), HyperHttpError> {
    if response.status < 400 {
        return Ok(());
    }
    let mut error_response = None;
    let mut origin = "none";
    let mut body_kind = "unreadable";
    let mut keys = String::new();
    if let Ok(body) = serde_json::from_slice::<Value>(&response.body) {
        body_kind = body_type(&body);
        keys = body_keys(&body);
        error_response = read_error_response(&body, response.status);
        if error_response.is_some() {
            origin = "body";
        }
    }
    // The body may be empty and the error is only in the status header
    let raw_status = response.headers.get("x-hyperdb-status");
    if error_response.is_none() {
        if let Some(raw_status) = raw_status.filter(|raw| !raw.is_empty()) {
            if let Ok(status) = serde_json::from_str::<Value>(raw_status) {
                error_response = read_error_response(&status, response.status);
                if error_response.is_some() {
                    origin = "x-hyperdb-status";
                }
            }
        }
    }
    let diagnostics = vec![
        ("status".to_string(), Some(response.status.to_string())),
        ("statusText".to_string(), Some(response.status_text.clone())),
        ("contentType".to_string(), response.headers.get("content-type").map(str::to_string)),
        ("hyperdbStatusPresent".to_string(), Some(raw_status.is_some().to_string())),
        ("hyperdbStatus".to_string(), raw_status.map(|raw| truncate(raw, MAX_DIAGNOSTIC_LENGTH))),
        ("bodyType".to_string(), Some(body_kind.to_string())),
        ("bodyKeys".to_string(), Some(keys)),
        ("hyperErrorRecognized".to_string(), Some(error_response.is_some().to_string())),
        ("hyperErrorOrigin".to_string(), Some(origin.to_string())),
    ];
    Err(HyperHttpError { http_status: response.status, error_response, diagnostics })
}

/// A failed query with the rich error model of Hyper, of either transport
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperQueryError {
    /// The error
    pub info: HyperErrorInfo,
    /// The log context that raised it
    pub target: String,
}

/// An error of the Hyper connector
#[derive(Debug, Clone, PartialEq)]
pub enum HyperError {
    /// An error response that holds no error the module recognizes
    Http(HyperHttpError),
    /// A failed query, from an error response the module recognizes
    Query(HyperQueryError),
    /// An endpoint that is missing
    MissingEndpoint,
    /// An url that can't be parsed
    InvalidUrl(String),
    /// A response that breaks the protocol, e.g. a query response without status header or a broken Arrow stream
    Protocol(String),
}

impl HyperError {
    /// An error response as the web channel raises it: a recognized error becomes a query error
    pub fn from_http(error: HyperHttpError) -> Self {
        match &error.error_response {
            Some(response) => HyperError::Query(HyperQueryError {
                info: from_http_error_response(response),
                target: WEB_CHANNEL_LOG_CONTEXT.to_string(),
            }),
            None => HyperError::Http(error),
        }
    }

    /// The message
    pub fn message(&self) -> String {
        match self {
            HyperError::Http(error) => error.message(),
            HyperError::Query(error) => error.info.primary_message.clone(),
            HyperError::MissingEndpoint => "missing hyper endpoint".to_string(),
            HyperError::InvalidUrl(url) => format!("invalid url: {url}"),
            HyperError::Protocol(message) => message.clone(),
        }
    }

    /// The details of the error as key-value pairs, for the log and the viewer of error details. Missing values are
    /// left out.
    pub fn key_values(&self) -> Vec<(String, String)> {
        match self {
            HyperError::Http(error) => error
                .diagnostics
                .iter()
                .filter_map(|(key, value)| value.as_ref().map(|value| (key.clone(), value.clone())))
                .collect(),
            HyperError::Query(error) => error.info.key_values(),
            HyperError::MissingEndpoint | HyperError::InvalidUrl(_) | HyperError::Protocol(_) => Vec::new(),
        }
    }

    /// The target of the error in the log
    pub fn target(&self) -> &str {
        match self {
            HyperError::Http(_) => HTTP_CLIENT_LOG_CONTEXT,
            HyperError::Query(error) => &error.target,
            HyperError::MissingEndpoint | HyperError::InvalidUrl(_) | HyperError::Protocol(_) => {
                WEB_CHANNEL_LOG_CONTEXT
            }
        }
    }

    /// The error as the details of a failed setup step, e.g. a health check
    pub fn to_detailed_error(&self) -> DetailedError {
        DetailedError { message: self.message(), data: self.key_values().into_iter().collect() }
    }
}

impl fmt::Display for HyperError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for HyperError {}

impl From<HyperError> for dashql_core::error::Error {
    fn from(error: HyperError) -> Self {
        dashql_core::error::Error::invalid_argument(error.message())
    }
}
