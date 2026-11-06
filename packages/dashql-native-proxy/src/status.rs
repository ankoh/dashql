use std::{collections::HashMap, fmt::Error};
use base64::Engine;
use serde::Serialize;
use http::{header::CONTENT_TYPE, Response, StatusCode};

use crate::proxy_headers::{
    HEADER_NAME_ERROR, HEADER_NAME_GRPC_MESSAGE, HEADER_NAME_GRPC_STATUS,
    HEADER_NAME_GRPC_STATUS_DETAILS,
};

#[derive(Debug)]
pub enum GrpcStreamElement {
    Message,
    Trailers,
}

#[derive(Debug)]
pub enum Status {
    GrpcCallFailed{ status: tonic::Status },
    GrpcChannelIdIsUnknown{ channel_id: usize },
    GrpcEndpointConnectFailed{ message: String },
    GrpcTlsConfigInvalid { message: String },
    GrpcStreamClosed { channel_id: usize, stream_id: usize },
    GrpcStreamIsUnknown { channel_id: usize, stream_id: usize },
    GrpcStreamReadFailed { channel_id: usize, stream_id: usize, element: GrpcStreamElement, status: tonic::Status },
    GrpcStreamReadTimedOut { channel_id: usize, stream_id: usize },
    HeaderHasInvalidEncoding{ header: &'static str, message: String },
    HeaderIsNotAValidEndpoint{ header: &'static str, message: String },
    HeaderIsNotAnUsize{ header: &'static str, message: String },
    HeaderPathIsInvalid{ header: &'static str, path: String, message: String },
    HeaderRequiredButMissing{ header: &'static str },
    HttpClientConfigInvalid{ message: String },
    HttpEndpointIsInvalid{ header: &'static str, endpoint: String, message: String },
    HttpMethodIsInvalid{ header: &'static str, method: String, message: String },
    HttpRequestFailed { stream_id: usize, error: String },
    HttpStreamClosed { stream_id: usize },
    HttpStreamFailed { stream_id: usize, error: String },
    HttpStreamIsUnknown { stream_id: usize },
    HttpStreamReadFailed { stream_id: usize, error: String },
    HttpStreamReadTimedOut { stream_id: usize },
    HttpUrlIsInvalid{ message: String },
}

/// The JSON error body sent for a failed proxy request
#[derive(Serialize)]
pub struct StatusMessage {
    /// The human-readable error message
    message: String,
    /// Additional error details, e.g. the offending header or the underlying error
    details: HashMap<&'static str, String>,
}

impl TryFrom<&Status> for StatusMessage {
    type Error = std::fmt::Error;

    fn try_from(s: &Status) -> Result<StatusMessage, Error> {
        match s {
            Status::HeaderHasInvalidEncoding { header, message } => Ok(StatusMessage {
                message: "header has an invalid encoding".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::HeaderIsNotAValidEndpoint { header, message } => Ok(StatusMessage {
                message: "header is not a valid endpoint".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::HeaderRequiredButMissing { header } => Ok(StatusMessage {
                message: "header is missing".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string())
                ]),
            }),
            Status::HeaderIsNotAnUsize { header, message } => Ok(StatusMessage {
                message: "header is not an unsigned integer".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::HeaderPathIsInvalid { header, path, message } => Ok(StatusMessage {
                message: "header stores invalid path".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("path", path.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::HttpEndpointIsInvalid { header, endpoint, message } => Ok(StatusMessage {
                message: "header stores invalid endpoint".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("endpoint", endpoint.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::HttpMethodIsInvalid { header, method, message } => Ok(StatusMessage {
                message: "header stores invalid method".to_string(),
                details: HashMap::from_iter([
                    ("header", header.to_string()),
                    ("method", method.to_string()),
                    ("error", message.to_string())
                ]),
            }),
            Status::GrpcChannelIdIsUnknown { channel_id } => Ok(StatusMessage {
                message: "gRPC channel id is unknown".to_string(),
                details: HashMap::from_iter([
                    ("channel", channel_id.to_string()),
                ]),
            }),
            Status::GrpcEndpointConnectFailed { message } => Ok(StatusMessage {
                message: format!("connecting to gRPC endpoint failed"),
                details: HashMap::from_iter([
                    ("error", message.to_string()),
                ]),
            }),
            Status::GrpcTlsConfigInvalid { message } => Ok(StatusMessage {
                message: "gRPC tls config is invalid".to_string(),
                details: HashMap::from_iter([
                    ("error", message.to_string()),
                ]),
            }),
            Status::GrpcCallFailed { status } => Ok(StatusMessage {
                message: "gRPC call failed".to_string(),
                details: HashMap::from_iter([
                    ("code", status.code().to_string()),
                    ("error", status.to_string()),
                ]),
            }),
            Status::GrpcStreamReadFailed {  channel_id, stream_id, element, status  } => Ok(StatusMessage {
                message: "reading from gRPC stream failed".to_string(),
                details: HashMap::from_iter([
                    ("target", match element { GrpcStreamElement::Trailers => "trailers", GrpcStreamElement::Message => "message" }.to_string()),
                    ("stream", stream_id.to_string()),
                    ("channel", channel_id.to_string()),
                    ("code", status.code().to_string()),
                    ("error", status.to_string()),
                ]),
            }),
            Status::GrpcStreamReadTimedOut { channel_id, stream_id } => Ok(StatusMessage {
                message: "reading from gRPC stream timed out".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("channel", channel_id.to_string()),
                ]),
            }),
            Status::GrpcStreamIsUnknown { channel_id, stream_id } => Ok(StatusMessage {
                message: "gRPC stream is unknown".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("channel", channel_id.to_string()),
                ]),
            }),
            Status::GrpcStreamClosed { channel_id, stream_id } => Ok(StatusMessage {
                message: "gRPC stream is closed".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("channel", channel_id.to_string()),
                ]),
            }),
            Status::HttpRequestFailed { stream_id, error } => Ok(StatusMessage {
                message: "http request failed".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("error", error.to_string()),
                ]),
            }),
            Status::HttpStreamReadFailed { stream_id, error } => Ok(StatusMessage {
                message: "reading chunk from http stream failed".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("error", error.to_string()),
                ]),
            }),
            Status::HttpStreamReadTimedOut { stream_id } => Ok(StatusMessage {
                message: "reading from http stream timed out".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                ]),
            }),
            Status::HttpStreamIsUnknown { stream_id } => Ok(StatusMessage {
                message: "http stream is unknown".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                ]),
            }),
            Status::HttpStreamClosed { stream_id } => Ok(StatusMessage {
                message: "http stream is closed".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                ]),
            }),
            Status::HttpStreamFailed { stream_id, error } => Ok(StatusMessage {
                message: "http stream failed".to_string(),
                details: HashMap::from_iter([
                    ("stream", stream_id.to_string()),
                    ("error", error.to_string()),
                ]),
            }),
            Status::HttpClientConfigInvalid {  message } => Ok(StatusMessage {
                message: format!("http client config is invalid"),
                details: HashMap::from_iter([
                    ("error", message.to_string()),
                ]),
            }),
            Status::HttpUrlIsInvalid { message } => Ok(StatusMessage {
                message: format!("http url is invalid"),
                details: HashMap::from_iter([
                    ("error", message.to_string()),
                ]),
            }),
        }
    }
}

impl From<&Status> for StatusCode {
    fn from(status: &Status) -> StatusCode {
        match status {
            Status::GrpcCallFailed { status: _ } => StatusCode::BAD_REQUEST,
            Status::GrpcChannelIdIsUnknown { channel_id: _ } => StatusCode::NOT_FOUND,
            Status::GrpcEndpointConnectFailed { message: _ } => StatusCode::BAD_REQUEST,
            Status::GrpcTlsConfigInvalid { message: _ } => StatusCode::BAD_REQUEST,
            Status::GrpcStreamClosed { channel_id: _, stream_id: _ } => StatusCode::BAD_REQUEST,
            Status::GrpcStreamIsUnknown { channel_id: _, stream_id: _ } => StatusCode::NOT_FOUND,
            Status::GrpcStreamReadFailed { channel_id: _, stream_id: _, element: _, status: _ } => StatusCode::BAD_REQUEST,
            Status::GrpcStreamReadTimedOut { channel_id: _, stream_id: _ } => StatusCode::BAD_REQUEST,
            Status::HeaderHasInvalidEncoding { header: _, message: _ } => StatusCode::BAD_REQUEST,
            Status::HeaderIsNotAValidEndpoint { header: _, message: _ } => StatusCode::BAD_REQUEST,
            Status::HeaderIsNotAnUsize { header: _, message: _ } => StatusCode::BAD_REQUEST,
            Status::HeaderPathIsInvalid { header: _, path: _, message: _ } => StatusCode::BAD_REQUEST,
            Status::HeaderRequiredButMissing { header: _ } => StatusCode::BAD_REQUEST,
            Status::HttpClientConfigInvalid { message: _ } => StatusCode::BAD_REQUEST,
            Status::HttpEndpointIsInvalid { header: _, endpoint: _ , message: _ } => StatusCode::BAD_REQUEST,
            Status::HttpMethodIsInvalid { header: _, method: _, message: _ } => StatusCode::BAD_REQUEST,
            Status::HttpRequestFailed { stream_id: _, error: _ } => StatusCode::BAD_REQUEST,
            Status::HttpStreamClosed { stream_id: _ } => StatusCode::BAD_REQUEST,
            Status::HttpStreamFailed { stream_id: _, error: _ } => StatusCode::BAD_REQUEST,
            Status::HttpStreamIsUnknown { stream_id: _ } => StatusCode::NOT_FOUND,
            Status::HttpStreamReadFailed { stream_id: _, error: _ } => StatusCode::BAD_REQUEST,
            Status::HttpStreamReadTimedOut { stream_id: _ } => StatusCode::BAD_REQUEST,
            Status::HttpUrlIsInvalid { message: _ } => StatusCode::BAD_REQUEST,
        }
    }
}

/// Percent-encode a gRPC status message for a header, the encoding of the `grpc-message` trailer.
/// Database errors span lines and quote the text of the user, which a header value cannot hold.
fn encode_grpc_message(message: &str) -> String {
    let mut encoded = String::with_capacity(message.len());
    for byte in message.bytes() {
        if (0x20..=0x7E).contains(&byte) && byte != b'%' {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// Build an error response for a failed gRPC call/stream, forwarding the
/// gRPC "richer error model" data to the frontend:
/// - `dashql-grpc-status`: the numeric gRPC status code
/// - `dashql-grpc-message`: the terse gRPC status message, percent-encoded
/// - `dashql-grpc-status-details-bin`: base64 of the `google.rpc.Status`
///   details envelope (carrying Hyper's `ErrorInfo`), if present.
fn grpc_error_response(s: &Status, status: &tonic::Status, body: Vec<u8>) -> Response<Vec<u8>> {
    let grpc_code = (status.code() as usize).to_string();
    let mut builder = Response::builder()
        .status(StatusCode::from(s).as_u16())
        .header(HEADER_NAME_ERROR, "true")
        .header(HEADER_NAME_GRPC_STATUS, &grpc_code)
        .header(HEADER_NAME_GRPC_MESSAGE, encode_grpc_message(status.message()))
        .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str());
    // Forward the raw status-details-bin (google.rpc.Status) as base64, if any.
    // The frontend decodes it to surface Hyper's ErrorInfo (sqlstate, hint,
    // customer/system detail, SQL text position, ...).
    let details = status.details();
    if !details.is_empty() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(details);
        builder = builder.header(HEADER_NAME_GRPC_STATUS_DETAILS, encoded);
    }
    builder.body(body).unwrap()
}

impl From<&Status> for Response<Vec<u8>> {
    fn from(s: &Status) -> Response<Vec<u8>> {
        let mut body: Vec<u8> = Vec::new();
        if let Ok(status_msg) = StatusMessage::try_from(s) {
            body = serde_json::to_vec(&status_msg).unwrap_or_default();
        }
        match &s {
            Status::GrpcCallFailed { ref status }
            | Status::GrpcStreamReadFailed { channel_id: _, stream_id: _, element: _, ref status } => {
                grpc_error_response(s, status, body)
            },
            _ => {
                Response::builder()
                    .status(StatusCode::from(s).as_u16())
                    .header(HEADER_NAME_ERROR, "true")
                    .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str())
                    .body(body)
                    .unwrap()
            }
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn header(response: &Response<Vec<u8>>, name: &str) -> Option<String> {
        response.headers().get(name).map(|value| value.to_str().unwrap().to_string())
    }

    fn json(response: &Response<Vec<u8>>) -> serde_json::Value {
        serde_json::from_slice(response.body()).unwrap()
    }

    #[test]
    fn every_status_describes_itself_as_json() {
        let text = || "text".to_string();
        let grpc = || tonic::Status::internal("boom");
        let cases: Vec<(Status, u16, &str, &[(&str, &str)])> = vec![
            (Status::GrpcChannelIdIsUnknown { channel_id: 1 }, 404, "gRPC channel id is unknown", &[("channel", "1")]),
            (Status::GrpcEndpointConnectFailed { message: text() }, 400, "connecting to gRPC endpoint failed", &[("error", "text")]),
            (Status::GrpcTlsConfigInvalid { message: text() }, 400, "gRPC tls config is invalid", &[("error", "text")]),
            (Status::GrpcStreamClosed { channel_id: 1, stream_id: 2 }, 400, "gRPC stream is closed", &[("channel", "1"), ("stream", "2")]),
            (Status::GrpcStreamIsUnknown { channel_id: 1, stream_id: 2 }, 404, "gRPC stream is unknown", &[("channel", "1"), ("stream", "2")]),
            (Status::GrpcStreamReadTimedOut { channel_id: 1, stream_id: 2 }, 400, "reading from gRPC stream timed out", &[("channel", "1"), ("stream", "2")]),
            (Status::GrpcCallFailed { status: grpc() }, 400, "gRPC call failed", &[]),
            (Status::GrpcStreamReadFailed { channel_id: 1, stream_id: 2, element: GrpcStreamElement::Message, status: grpc() }, 400, "reading from gRPC stream failed", &[("target", "message")]),
            (Status::GrpcStreamReadFailed { channel_id: 1, stream_id: 2, element: GrpcStreamElement::Trailers, status: grpc() }, 400, "reading from gRPC stream failed", &[("target", "trailers")]),
            (Status::HeaderHasInvalidEncoding { header: "h", message: text() }, 400, "header has an invalid encoding", &[("header", "h"), ("error", "text")]),
            (Status::HeaderIsNotAValidEndpoint { header: "h", message: text() }, 400, "header is not a valid endpoint", &[("header", "h"), ("error", "text")]),
            (Status::HeaderIsNotAnUsize { header: "h", message: text() }, 400, "header is not an unsigned integer", &[("header", "h"), ("error", "text")]),
            (Status::HeaderPathIsInvalid { header: "h", path: "p".to_string(), message: text() }, 400, "header stores invalid path", &[("header", "h"), ("path", "p")]),
            (Status::HeaderRequiredButMissing { header: "h" }, 400, "header is missing", &[("header", "h")]),
            (Status::HttpClientConfigInvalid { message: text() }, 400, "http client config is invalid", &[("error", "text")]),
            (Status::HttpEndpointIsInvalid { header: "h", endpoint: "e".to_string(), message: text() }, 400, "header stores invalid endpoint", &[("endpoint", "e")]),
            (Status::HttpMethodIsInvalid { header: "h", method: "m".to_string(), message: text() }, 400, "header stores invalid method", &[("method", "m")]),
            (Status::HttpRequestFailed { stream_id: 2, error: text() }, 400, "http request failed", &[("stream", "2"), ("error", "text")]),
            (Status::HttpStreamClosed { stream_id: 2 }, 400, "http stream is closed", &[("stream", "2")]),
            (Status::HttpStreamFailed { stream_id: 2, error: text() }, 400, "http stream failed", &[("stream", "2"), ("error", "text")]),
            (Status::HttpStreamIsUnknown { stream_id: 2 }, 404, "http stream is unknown", &[("stream", "2")]),
            (Status::HttpStreamReadFailed { stream_id: 2, error: text() }, 400, "reading chunk from http stream failed", &[("stream", "2"), ("error", "text")]),
            (Status::HttpStreamReadTimedOut { stream_id: 2 }, 400, "reading from http stream timed out", &[("stream", "2")]),
            (Status::HttpUrlIsInvalid { message: text() }, 400, "http url is invalid", &[("error", "text")]),
        ];
        for (status, code, message, details) in cases {
            let response = Response::from(&status);
            assert_eq!(response.status().as_u16(), code, "{status:?}");
            assert_eq!(header(&response, HEADER_NAME_ERROR).as_deref(), Some("true"), "{status:?}");
            assert_eq!(header(&response, "content-type").as_deref(), Some("application/json"), "{status:?}");
            let body = json(&response);
            assert_eq!(body["message"], message, "{status:?}");
            for (name, value) in details {
                assert_eq!(body["details"][name], *value, "{status:?}");
            }
        }
    }

    #[test]
    fn a_failed_grpc_call_forwards_the_rich_error() {
        let status = tonic::Status::with_details(tonic::Code::InvalidArgument, "bad query", vec![0, 1, 255].into());
        let response = Response::from(&Status::GrpcCallFailed { status });
        assert_eq!(header(&response, HEADER_NAME_GRPC_STATUS).as_deref(), Some("3"));
        assert_eq!(header(&response, HEADER_NAME_GRPC_MESSAGE).as_deref(), Some("bad query"));
        assert_eq!(header(&response, HEADER_NAME_GRPC_STATUS_DETAILS).as_deref(), Some("AAH/"));
    }

    #[test]
    fn a_failed_grpc_call_without_details_sends_none() {
        let response = Response::from(&Status::GrpcCallFailed { status: tonic::Status::internal("boom") });
        assert_eq!(header(&response, HEADER_NAME_GRPC_STATUS).as_deref(), Some("13"));
        assert_eq!(header(&response, HEADER_NAME_GRPC_STATUS_DETAILS), None);
    }

    #[test]
    fn a_grpc_message_that_is_no_header_value_reaches_the_app() {
        // Database errors span lines and quote the text of the user
        let message = "syntax error at line 1\nnear \"caf\u{e9}\" 100%";
        let status = tonic::Status::new(tonic::Code::InvalidArgument, message);
        for status in [
            Status::GrpcCallFailed { status: status.clone() },
            Status::GrpcStreamReadFailed { channel_id: 1, stream_id: 2, element: GrpcStreamElement::Message, status },
        ] {
            let response = Response::from(&status);
            assert_eq!(header(&response, HEADER_NAME_GRPC_STATUS).as_deref(), Some("3"));
            // Percent-encoded like the `grpc-message` trailer it comes from
            assert_eq!(
                header(&response, HEADER_NAME_GRPC_MESSAGE).as_deref(),
                Some("syntax error at line 1%0Anear \"caf%C3%A9\" 100%25"),
            );
            assert!(json(&response)["details"]["error"].as_str().unwrap().contains("caf\u{e9}"));
        }
    }
}
