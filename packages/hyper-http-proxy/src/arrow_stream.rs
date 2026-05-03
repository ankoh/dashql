use bytes::{Bytes, BytesMut};
use http::{HeaderValue, Response, StatusCode};
use http_body_util::BodyExt;
use http_body_util::Full;

use crate::cors::BoxedBody;

pub const CONTENT_TYPE_ARROW: &str = "application/vnd.apache.arrow.stream";

pub fn concat_chunks(chunks: &[Bytes]) -> Bytes {
    if chunks.is_empty() {
        return Bytes::new();
    }
    let total: usize = chunks.iter().map(|c| c.len()).sum();
    let mut buf = BytesMut::with_capacity(total);
    for c in chunks {
        buf.extend_from_slice(c);
    }
    buf.freeze()
}

pub fn arrow_response(body: Bytes, status_header: Option<HeaderValue>) -> Response<BoxedBody> {
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .body(Full::new(body).map_err(|n| match n {}).boxed())
        .expect("arrow response");
    resp.headers_mut()
        .insert("content-type", HeaderValue::from_static(CONTENT_TYPE_ARROW));
    if let Some(v) = status_header {
        resp.headers_mut().insert("status", v);
    }
    resp
}
