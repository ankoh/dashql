//! The rich error model of Hyper as the HTTP API sends it, a JSON error body that becomes a `HyperErrorInfo`. The
//! gRPC channel of the desktop app decodes the error headers of its proxy in TypeScript
//! (`hyper_error_info.ts` of `@akohn/dashql`), the side that receives them.

use super::error::QueryErrorResponse;

/// A position in the SQL text, in Unicode code points
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HyperTextPosition {
    pub begin_character_offset: i64,
    pub end_character_offset: i64,
}

/// The origin of an error, as Hyper classifies it
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HyperErrorSource {
    User,
    System,
    Unknown,
}

impl HyperErrorSource {
    /// The source of its name, unknown for any other name
    pub fn from_name(name: Option<&str>) -> Self {
        match name {
            Some("User") => HyperErrorSource::User,
            Some("System") => HyperErrorSource::System,
            _ => HyperErrorSource::Unknown,
        }
    }

    /// The name of the source
    pub fn name(self) -> &'static str {
        match self {
            HyperErrorSource::User => "User",
            HyperErrorSource::System => "System",
            HyperErrorSource::Unknown => "Unknown",
        }
    }
}

/// An error of Hyper with its rich error model
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperErrorInfo {
    /// The primary, terse message
    pub primary_message: String,
    /// The SQL state, none means unknown or internal
    pub sqlstate: Option<String>,
    /// A suggestion what to do about the problem
    pub customer_hint: Option<String>,
    /// A detail with customer data
    pub customer_detail: Option<String>,
    /// A detail with system data
    pub system_detail: Option<String>,
    /// The position of the error in the SQL text
    pub position: Option<HyperTextPosition>,
    /// The cause
    pub error_source: HyperErrorSource,
}

impl HyperErrorInfo {
    /// An error with only a message
    pub fn from_message(message: &str) -> Self {
        Self {
            primary_message: message.to_string(),
            sqlstate: None,
            customer_hint: None,
            customer_detail: None,
            system_detail: None,
            position: None,
            error_source: HyperErrorSource::Unknown,
        }
    }

    /// The populated fields as key-value pairs for the log and the viewer of error details. The system detail is
    /// included, the logs stay with the client.
    pub fn key_values(&self) -> Vec<(String, String)> {
        let mut values = Vec::new();
        let mut push = |key: &str, value: Option<String>| {
            if let Some(value) = value.filter(|value| !value.is_empty()) {
                values.push((key.to_string(), value));
            }
        };
        push("sqlstate", self.sqlstate.clone());
        push("source", (self.error_source != HyperErrorSource::Unknown).then(|| self.error_source.name().to_string()));
        push("hint", self.customer_hint.clone());
        push("detail", self.customer_detail.clone());
        push("systemDetail", self.system_detail.clone());
        push(
            "position",
            self.position
                .map(|position| format!("{}..{}", position.begin_character_offset, position.end_character_offset)),
        );
        values
    }
}

/// Is a text a SQL state of five characters? The V3 error field holds one or a word like `INTERNAL_ERROR`.
fn is_sqlstate(text: &str) -> bool {
    text.len() == 5 && text.bytes().all(|byte| byte.is_ascii_digit() || byte.is_ascii_uppercase())
}

/// The leading integer of a text like `parseInt`, none if there is none
fn parse_int(text: &str) -> Option<i64> {
    let text = text.trim_start();
    let (sign, digits) = match text.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, text.strip_prefix('+').unwrap_or(text)),
    };
    let end = digits.find(|c: char| !c.is_ascii_digit()).unwrap_or(digits.len());
    digits.get(..end).filter(|digits| !digits.is_empty())?.parse::<i64>().ok().map(|value| sign * value)
}

/// The error of a JSON error body of the HTTP API
pub fn from_http_error_response(response: &QueryErrorResponse) -> HyperErrorInfo {
    let details = response.details.as_ref();
    let position = details.and_then(|details| details.position.as_ref()).and_then(|position| {
        Some(HyperTextPosition {
            begin_character_offset: parse_int(&position.error_begin_character_offset)?,
            end_character_offset: parse_int(&position.error_end_character_offset)?,
        })
    });
    let text = |value: Option<&String>| value.filter(|value| !value.is_empty()).cloned();
    HyperErrorInfo {
        primary_message: if response.message.is_empty() { response.error.clone() } else { response.message.clone() },
        sqlstate: is_sqlstate(&response.error).then(|| response.error.clone()),
        customer_hint: text(details.and_then(|details| details.customer_hint.as_ref())),
        customer_detail: text(details.and_then(|details| details.customer_detail.as_ref())),
        system_detail: text(details.and_then(|details| details.system_detail.as_ref())),
        position,
        error_source: HyperErrorSource::from_name(details.and_then(|details| details.error_source.as_deref())),
    }
}
