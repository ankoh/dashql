use bytes::Bytes;
use http::header::HeaderName;
use http::{HeaderMap, HeaderValue, Response, StatusCode};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty};

use crate::config::Config;

pub type BoxedBody = BoxBody<Bytes, std::convert::Infallible>;

pub fn empty_body() -> BoxedBody {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

pub fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "proxy-connection"
            | "keep-alive"
            | "transfer-encoding"
            | "te"
            | "trailer"
            | "upgrade"
            | "content-length"
    )
}

pub fn preflight_response(cfg: &Config, req_headers: &HeaderMap) -> Response<BoxedBody> {
    let requested = req_headers
        .get("access-control-request-headers")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*")
        .to_string();

    let mut resp = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(empty_body())
        .expect("preflight response");

    let h = resp.headers_mut();
    h.insert(
        "access-control-allow-origin",
        HeaderValue::from_str(&cfg.allow_origin).unwrap_or(HeaderValue::from_static("*")),
    );
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
    );
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_str(&requested).unwrap_or(HeaderValue::from_static("*")),
    );
    h.insert("access-control-max-age", HeaderValue::from_static("86400"));
    h.insert(
        "vary",
        HeaderValue::from_static("Origin, Access-Control-Request-Headers"),
    );
    resp
}

/// Adds the CORS response headers onto an already-built response.
/// Call this on every non-preflight response.
pub fn decorate_with_cors(cfg: &Config, resp: &mut Response<BoxedBody>) {
    let h = resp.headers_mut();
    h.insert(
        "access-control-allow-origin",
        HeaderValue::from_str(&cfg.allow_origin).unwrap_or(HeaderValue::from_static("*")),
    );
    // Browsers need "status" exposed to read the QueryStatus header from fetch().
    h.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("status"),
    );
    h.insert("vary", HeaderValue::from_static("Origin"));
}
