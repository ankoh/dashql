//! Generic HTTP request forwarder.
//!
//! Any request whose path isn't claimed by the `/api/v3/query*` routes and that
//! carries an `Dashql-Forward-To: <scheme>://<host>[:port]` header is
//! forwarded verbatim to that upstream (path and query preserved). The target
//! host is validated against `--allow-forward-to` — same allowlist semantics as
//! `Dashql-Grpc-Endpoint`.
//!
//! Used by the dashql-app Salesforce connector to tunnel OAuth /
//! token-exchange / metadata calls that can't be made directly from a browser
//! because of CORS.

use std::sync::Arc;

use http::header::HeaderName;
use http::{HeaderMap, HeaderValue, Request, Response, StatusCode, Uri};
use http_body_util::BodyExt;
use http_body_util::Full;
use hyper::body::Incoming;

use crate::config::Config;
use crate::cors::{is_hop_by_hop, BoxedBody};
use crate::errors::HttpError;

pub const HEADER_FORWARD_TO: &str = "dashql-forward-to";

pub async fn handle(
    req: Request<Incoming>,
    cfg: &Arc<Config>,
    rid: &str,
) -> Result<Response<BoxedBody>, HttpError> {
    // Resolve and validate the upstream origin.
    let forward_to = req
        .headers()
        .get(HEADER_FORWARD_TO)
        .ok_or_else(|| HttpError::bad_request(format!("missing {} header", HEADER_FORWARD_TO)))?
        .to_str()
        .map_err(|_| HttpError::bad_request(format!("invalid {} header", HEADER_FORWARD_TO)))?
        .to_string();
    let base: Uri = forward_to
        .parse()
        .map_err(|e| HttpError::bad_request(format!("parse {}: {}", HEADER_FORWARD_TO, e)))?;
    let host = base
        .host()
        .ok_or_else(|| HttpError::bad_request(format!("{} missing host", HEADER_FORWARD_TO)))?;
    if !cfg.host_allowed(host) {
        return Err(HttpError::bad_request(format!(
            "host {} not in --allow-forward-to",
            host
        )));
    }
    let scheme = base.scheme_str().unwrap_or("https");
    let authority = base
        .authority()
        .ok_or_else(|| HttpError::bad_request(format!("{} missing authority", HEADER_FORWARD_TO)))?
        .as_str()
        .to_string();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".to_string());
    let upstream_url = format!("{}://{}{}", scheme, authority, path_and_query);

    // Collect body + headers, then issue the upstream request.
    let (parts, body) = req.into_parts();
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| HttpError::bad_request(format!("read body: {}", e)))?
        .to_bytes();

    let mut fwd_headers = reqwest::header::HeaderMap::with_capacity(parts.headers.len());
    copy_request_headers(&parts.headers, &mut fwd_headers);

    let reqwest_method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes())
        .map_err(|e| HttpError::bad_request(format!("invalid method: {}", e)))?;

    let upstream = cfg
        .http_client
        .request(reqwest_method, &upstream_url)
        .headers(fwd_headers)
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| HttpError::bad_gateway(format!("upstream request failed: {}", e)))?;

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let upstream_body = upstream
        .bytes()
        .await
        .map_err(|e| HttpError::bad_gateway(format!("read upstream body: {}", e)))?;

    log::info!(
        "[req={}] forward {} {} -> {} ({} bytes)",
        rid,
        parts.method,
        upstream_url,
        status.as_u16(),
        upstream_body.len()
    );

    let hyper_status = StatusCode::from_u16(status.as_u16())
        .map_err(|e| HttpError::bad_gateway(format!("invalid upstream status: {}", e)))?;

    let mut resp = Response::builder()
        .status(hyper_status)
        .body(Full::new(upstream_body).map_err(|n| match n {}).boxed())
        .expect("upstream response");
    copy_response_headers(&upstream_headers, resp.headers_mut());
    Ok(resp)
}

fn copy_request_headers(src: &HeaderMap, dst: &mut reqwest::header::HeaderMap) {
    for (name, value) in src.iter() {
        if is_hop_by_hop(name) {
            continue;
        }
        match name.as_str() {
            "host" | "origin" | "referer" | HEADER_FORWARD_TO => continue,
            _ => {}
        }
        if let (Ok(n), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(name.as_ref()),
            reqwest::header::HeaderValue::from_bytes(value.as_bytes()),
        ) {
            dst.append(n, v);
        }
    }
}

fn copy_response_headers(src: &reqwest::header::HeaderMap, dst: &mut HeaderMap) {
    for (name, value) in src.iter() {
        let name_str = name.as_str();
        if matches!(
            name_str,
            "connection"
                | "proxy-connection"
                | "keep-alive"
                | "transfer-encoding"
                | "te"
                | "trailer"
                | "upgrade"
                | "content-length"
                | "access-control-allow-origin"
                | "access-control-expose-headers"
                | "vary"
        ) {
            continue;
        }
        if let (Ok(n), Ok(v)) = (
            HeaderName::from_bytes(name_str.as_bytes()),
            HeaderValue::from_bytes(value.as_bytes()),
        ) {
            dst.append(n, v);
        }
    }
}

