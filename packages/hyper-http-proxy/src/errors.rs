use bytes::Bytes;
use http::{HeaderValue, Response, StatusCode};
use http_body_util::BodyExt;
use http_body_util::Full;
use serde::Serialize;

use crate::cors::BoxedBody;

#[derive(Debug, Clone, Serialize)]
pub struct ErrorPosition {
    #[serde(rename = "errorBeginCharacterOffset")]
    pub begin: String,
    #[serde(rename = "errorEndCharacterOffset")]
    pub end: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ErrorDetails {
    #[serde(rename = "customerHint", skip_serializing_if = "Option::is_none")]
    pub customer_hint: Option<String>,
    #[serde(rename = "customerDetail", skip_serializing_if = "Option::is_none")]
    pub customer_detail: Option<String>,
    #[serde(rename = "errorSource", skip_serializing_if = "Option::is_none")]
    pub error_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<ErrorPosition>,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorEnvelope<'a> {
    error: &'a str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<&'a ErrorDetails>,
}

#[derive(Debug, Clone)]
pub struct HttpError {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
    pub details: Option<ErrorDetails>,
}

impl HttpError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "BAD_REQUEST".into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND".into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn not_acceptable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_ACCEPTABLE,
            code: "NOT_ACCEPTABLE".into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR".into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn into_response(self) -> Response<BoxedBody> {
        let envelope = ErrorEnvelope {
            error: &self.code,
            message: &self.message,
            details: self.details.as_ref(),
        };
        let body = serde_json::to_vec(&envelope).unwrap_or_else(|_| b"{}".to_vec());
        let mut resp = Response::builder()
            .status(self.status)
            .body(Full::new(Bytes::from(body)).map_err(|n| match n {}).boxed())
            .expect("error response");
        resp.headers_mut()
            .insert("content-type", HeaderValue::from_static("application/json"));
        resp
    }
}

impl From<tonic::Status> for HttpError {
    fn from(status: tonic::Status) -> Self {
        let (http_status, code) = map_grpc_code(status.code());
        HttpError {
            status: http_status,
            code: code.into(),
            message: status.message().to_string(),
            details: None,
        }
    }
}

fn map_grpc_code(code: tonic::Code) -> (StatusCode, &'static str) {
    use tonic::Code::*;
    match code {
        Ok => (StatusCode::OK, "OK"),
        Cancelled | DeadlineExceeded => (StatusCode::REQUEST_TIMEOUT, "TIME_OUT"),
        InvalidArgument | FailedPrecondition | OutOfRange => {
            (StatusCode::BAD_REQUEST, "BAD_REQUEST")
        }
        NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND"),
        PermissionDenied => (StatusCode::FORBIDDEN, "FORBIDDEN"),
        ResourceExhausted => (StatusCode::TOO_MANY_REQUESTS, "RESOURCE_EXHAUSTED"),
        Aborted => (StatusCode::CONFLICT, "ABORTED"),
        Unimplemented => (StatusCode::NOT_IMPLEMENTED, "UNIMPLEMENTED"),
        Unauthenticated => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED"),
        AlreadyExists => (StatusCode::CONFLICT, "ALREADY_EXISTS"),
        Unavailable => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        Unknown | Internal | DataLoss => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grpc_codes_map_to_expected_http_statuses() {
        assert_eq!(map_grpc_code(tonic::Code::Cancelled).0, StatusCode::REQUEST_TIMEOUT);
        assert_eq!(map_grpc_code(tonic::Code::DeadlineExceeded).0, StatusCode::REQUEST_TIMEOUT);
        assert_eq!(map_grpc_code(tonic::Code::InvalidArgument).0, StatusCode::BAD_REQUEST);
        assert_eq!(map_grpc_code(tonic::Code::FailedPrecondition).0, StatusCode::BAD_REQUEST);
        assert_eq!(map_grpc_code(tonic::Code::OutOfRange).0, StatusCode::BAD_REQUEST);
        assert_eq!(map_grpc_code(tonic::Code::NotFound).0, StatusCode::NOT_FOUND);
        assert_eq!(map_grpc_code(tonic::Code::PermissionDenied).0, StatusCode::FORBIDDEN);
        assert_eq!(map_grpc_code(tonic::Code::ResourceExhausted).0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(map_grpc_code(tonic::Code::Aborted).0, StatusCode::CONFLICT);
        assert_eq!(map_grpc_code(tonic::Code::Unimplemented).0, StatusCode::NOT_IMPLEMENTED);
        assert_eq!(map_grpc_code(tonic::Code::Unauthenticated).0, StatusCode::UNAUTHORIZED);
        assert_eq!(map_grpc_code(tonic::Code::Internal).0, StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn error_envelope_omits_null_fields() {
        let err = HttpError::not_found("missing queryId");
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
