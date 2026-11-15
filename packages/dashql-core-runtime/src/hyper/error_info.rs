//! The rich error model of Hyper, independent of the transport. The HTTP API sends it as a JSON error body, the gRPC
//! proxy of the desktop app as the base64 `google.rpc.Status` of the header `dashql-grpc-status-details-bin`. Both
//! become a `HyperErrorInfo`.

use base64::Engine;

use super::error::QueryErrorResponse;
use super::http::Headers;
use super::url::decode_uri_component;

/// The gRPC "richer error model" trailer that carries the base64-encoded `google.rpc.Status`, as the native proxy
/// forwards it
pub const HEADER_GRPC_STATUS_DETAILS: &str = "dashql-grpc-status-details-bin";
/// The terse gRPC status message forwarded by the native proxy
pub const HEADER_GRPC_MESSAGE: &str = "dashql-grpc-message";
/// The numeric gRPC status code forwarded by the native proxy
pub const HEADER_GRPC_STATUS: &str = "dashql-grpc-status";

/// The full name of the protobuf message ErrorInfo of Hyper
const ERROR_INFO_TYPE_NAME: &str = "salesforce.hyperdb.grpc.v1.ErrorInfo";

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
    /// The numeric gRPC status code, if the error came from a gRPC call
    pub grpc_status_code: Option<i64>,
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
            grpc_status_code: None,
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
        push("grpcStatus", self.grpc_status_code.map(|code| code.to_string()));
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
        grpc_status_code: None,
    }
}

/// A reader of the protobuf wire format, enough for `google.rpc.Status`, `google.protobuf.Any` and ErrorInfo
struct WireReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

/// A field of a protobuf message
enum WireValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

impl<'a> WireReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *self.bytes.get(self.offset)?;
            self.offset += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    fn skip(&mut self, length: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(length)?;
        let bytes = self.bytes.get(self.offset..end)?;
        self.offset = end;
        Some(bytes)
    }

    /// The next field, none at the end. A malformed message is an error.
    fn next(&mut self) -> Result<Option<(u64, WireValue<'a>)>, ()> {
        if self.offset >= self.bytes.len() {
            return Ok(None);
        }
        let tag = self.varint().ok_or(())?;
        let field = tag >> 3;
        let value = match tag & 7 {
            0 => WireValue::Varint(self.varint().ok_or(())?),
            1 => {
                self.skip(8).ok_or(())?;
                WireValue::Fixed
            }
            2 => {
                let length = usize::try_from(self.varint().ok_or(())?).map_err(|_| ())?;
                WireValue::Bytes(self.skip(length).ok_or(())?)
            }
            5 => {
                self.skip(4).ok_or(())?;
                WireValue::Fixed
            }
            _ => return Err(()),
        };
        if field == 0 {
            return Err(());
        }
        Ok(Some((field, value)))
    }
}

/// A string field, an error if it isn't UTF-8
fn wire_string(bytes: &[u8]) -> Result<String, ()> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ())
}

/// The fields of a decoded `google.rpc.Status`
#[derive(Default)]
struct GrpcStatus {
    code: i64,
    message: String,
    /// The packed details: the type url and the value
    details: Vec<(String, Vec<u8>)>,
}

fn decode_any(bytes: &[u8]) -> Result<(String, Vec<u8>), ()> {
    let mut reader = WireReader::new(bytes);
    let (mut type_url, mut value) = (String::new(), Vec::new());
    while let Some((field, field_value)) = reader.next()? {
        match (field, field_value) {
            (1, WireValue::Bytes(bytes)) => type_url = wire_string(bytes)?,
            (2, WireValue::Bytes(bytes)) => value = bytes.to_vec(),
            _ => {}
        }
    }
    Ok((type_url, value))
}

fn decode_status(bytes: &[u8]) -> Result<GrpcStatus, ()> {
    let mut reader = WireReader::new(bytes);
    let mut status = GrpcStatus::default();
    while let Some((field, value)) = reader.next()? {
        match (field, value) {
            // An int32, a negative one is sign-extended to 64 bits
            (1, WireValue::Varint(code)) => status.code = i64::from(code as i32),
            (2, WireValue::Bytes(bytes)) => status.message = wire_string(bytes)?,
            (3, WireValue::Bytes(bytes)) => status.details.push(decode_any(bytes)?),
            _ => {}
        }
    }
    Ok(status)
}

fn decode_text_position(bytes: &[u8]) -> Result<HyperTextPosition, ()> {
    let mut reader = WireReader::new(bytes);
    let mut position = HyperTextPosition { begin_character_offset: 0, end_character_offset: 0 };
    while let Some((field, value)) = reader.next()? {
        match (field, value) {
            (2, WireValue::Varint(offset)) => position.begin_character_offset = offset as i64,
            (3, WireValue::Varint(offset)) => position.end_character_offset = offset as i64,
            _ => {}
        }
    }
    Ok(position)
}

fn decode_error_info(bytes: &[u8], grpc_status_code: Option<i64>) -> Result<HyperErrorInfo, ()> {
    let mut reader = WireReader::new(bytes);
    let mut info = HyperErrorInfo::from_message("");
    let mut error_source = String::new();
    let non_empty = |text: String| (!text.is_empty()).then_some(text);
    while let Some((field, value)) = reader.next()? {
        let WireValue::Bytes(bytes) = value else {
            continue;
        };
        match field {
            1 => info.primary_message = wire_string(bytes)?,
            2 => info.sqlstate = non_empty(wire_string(bytes)?),
            3 => info.customer_hint = non_empty(wire_string(bytes)?),
            4 => info.customer_detail = non_empty(wire_string(bytes)?),
            5 => info.system_detail = non_empty(wire_string(bytes)?),
            6 => info.position = Some(decode_text_position(bytes)?),
            7 => error_source = wire_string(bytes)?,
            _ => {}
        }
    }
    info.error_source = HyperErrorSource::from_name(Some(&error_source));
    info.grpc_status_code = grpc_status_code;
    Ok(info)
}

/// Decode a base64-encoded `google.rpc.Status`, the `grpc-status-details-bin` trailer, and unpack its first Hyper
/// ErrorInfo. Without one, the message of the status. None if the text isn't a status.
pub fn decode_grpc_status_details(base64_details: &str, grpc_status_code: Option<i64>) -> Option<HyperErrorInfo> {
    // Like atob: whitespace is ignored, the padding is optional
    let compact: String = base64_details.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD_PAD_INDIFFERENT.decode(compact).ok()?;
    let status = decode_status(&bytes).ok()?;
    for (type_url, value) in &status.details {
        let type_name = type_url.rsplit_once('/').map_or(type_url.as_str(), |(_, name)| name);
        if type_name == ERROR_INFO_TYPE_NAME {
            if let Ok(info) = decode_error_info(value, grpc_status_code) {
                return Some(info);
            }
        }
    }
    // No ErrorInfo packed: the plain message of the status
    if !status.message.is_empty() {
        return Some(HyperErrorInfo {
            grpc_status_code: grpc_status_code.or(Some(status.code)),
            ..HyperErrorInfo::from_message(&status.message)
        });
    }
    None
}

/// The error of the headers and trailers that the native gRPC proxy forwards, none without error data
pub fn decode_grpc_error_headers(headers: Option<&Headers>) -> Option<HyperErrorInfo> {
    let headers = headers?;
    let grpc_status_code = headers.get(HEADER_GRPC_STATUS).and_then(parse_int);
    if let Some(details) = headers.get(HEADER_GRPC_STATUS_DETAILS).filter(|details| !details.is_empty()) {
        if let Some(info) = decode_grpc_status_details(details, grpc_status_code) {
            return Some(info);
        }
    }
    // No status details: the terse grpc-message, which the proxy percent-encodes since a header holds no line breaks
    let message = headers.get(HEADER_GRPC_MESSAGE).filter(|message| !message.is_empty())?;
    Some(HyperErrorInfo {
        grpc_status_code,
        ..HyperErrorInfo::from_message(&decode_uri_component(message).unwrap_or_else(|| message.to_string()))
    })
}
