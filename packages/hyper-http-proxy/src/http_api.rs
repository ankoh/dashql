use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use http::{HeaderValue, Method, Request, Response, StatusCode, Uri};
use http_body_util::BodyExt;
use http_body_util::Full;
use hyper::body::Incoming;
use serde::Deserialize;
use tonic::metadata::MetadataMap;

use crate::arrow_stream::{arrow_response, concat_chunks, CONTENT_TYPE_ARROW};
use crate::config::Config;
use crate::cors::{decorate_with_cors, empty_body, preflight_response, BoxedBody};
use crate::errors::HttpError;
use crate::grpc_client::{execute_query, prepare_metadata, HEADER_GRPC_ENDPOINT};
use crate::proto::hyper::query_param::OutputFormat;
use crate::proto::hyper::query_result::Result as QueryResultKind;
use crate::proto::hyper::QueryParam;
use crate::query_state::QueryState;

#[derive(Debug, Deserialize)]
struct ExecuteBody {
    sql: String,
    #[serde(default)]
    settings: Option<std::collections::HashMap<String, serde_json::Value>>,
}

pub async fn handle(
    req: Request<Incoming>,
    cfg: Arc<Config>,
) -> Result<Response<BoxedBody>, std::convert::Infallible> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    log::info!("{} {}", method, path);

    if method == Method::OPTIONS {
        return Ok(preflight_response(&cfg, req.headers()));
    }

    let mut resp = match route(req, &cfg).await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("{} {} -> {} {}", method, path, e.status, e.message);
            e.into_response()
        }
    };
    decorate_with_cors(&cfg, &mut resp);
    Ok(resp)
}

async fn route(req: Request<Incoming>, cfg: &Arc<Config>) -> Result<Response<BoxedBody>, HttpError> {
    let method = req.method().clone();
    let path = req.uri().path().trim_end_matches('/').to_string();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // All routes under /v3/query
    match (method.clone(), segments.as_slice()) {
        (Method::POST, ["v3", "query"]) => handle_post_query(req, cfg).await,
        (Method::GET, ["v3", "query", id]) => {
            let id = (*id).to_string();
            handle_get_status(req, cfg, id).await
        }
        (Method::DELETE, ["v3", "query", id]) => {
            let id = (*id).to_string();
            handle_delete_query(cfg, id).await
        }
        (Method::GET, ["v3", "query", id, "chunk", cid]) => {
            let id = (*id).to_string();
            let cid = (*cid).to_string();
            handle_get_chunk(req, cfg, id, cid).await
        }
        (Method::GET, ["v3", "query", id, "row"]) => {
            let id = (*id).to_string();
            handle_get_rows(req, cfg, id).await
        }
        _ => Err(HttpError::not_found(format!("route not found: {} {}", method, path))),
    }
}

fn negotiate_arrow(req: &Request<Incoming>) -> Result<(), HttpError> {
    let accept = match req.headers().get("accept") {
        None => return Ok(()),
        Some(v) => v,
    };
    let raw = accept.to_str().unwrap_or("").trim();
    if raw.is_empty() {
        return Ok(());
    }
    let ok = raw.split(',').any(|part| {
        let t = part.split(';').next().unwrap_or("").trim();
        t == CONTENT_TYPE_ARROW || t == "*/*"
    });
    if ok {
        Ok(())
    } else {
        Err(HttpError::not_acceptable(format!(
            "Accept must include {} (got {})",
            CONTENT_TYPE_ARROW, raw
        )))
    }
}

fn resolve_endpoint(req: &Request<Incoming>, cfg: &Config) -> Result<Uri, HttpError> {
    let hv = req
        .headers()
        .get(HEADER_GRPC_ENDPOINT)
        .ok_or_else(|| HttpError::bad_request(format!("missing {} header", HEADER_GRPC_ENDPOINT)))?;
    let s = hv
        .to_str()
        .map_err(|_| HttpError::bad_request(format!("invalid {} header", HEADER_GRPC_ENDPOINT)))?;
    let uri: Uri = s
        .parse()
        .map_err(|e| HttpError::bad_request(format!("parse {}: {}", HEADER_GRPC_ENDPOINT, e)))?;
    let host = uri
        .host()
        .ok_or_else(|| HttpError::bad_request(format!("{} missing host", HEADER_GRPC_ENDPOINT)))?;
    if !cfg.host_allowed(host) {
        return Err(HttpError::bad_request(format!(
            "host {} not in --allow-forward-to",
            host
        )));
    }
    Ok(uri)
}

async fn handle_post_query(
    req: Request<Incoming>,
    cfg: &Arc<Config>,
) -> Result<Response<BoxedBody>, HttpError> {
    negotiate_arrow(&req)?;
    let upstream = resolve_endpoint(&req, cfg)?;

    let (parts, body) = req.into_parts();
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| HttpError::bad_request(format!("read body: {}", e)))?
        .to_bytes();
    let parsed: ExecuteBody = serde_json::from_slice(&body_bytes)
        .map_err(|e| HttpError::bad_request(format!("parse body: {}", e)))?;
    if parsed.sql.is_empty() {
        return Err(HttpError::bad_request("sql is required"));
    }

    let channel = cfg.channels.get_or_build(&upstream).await?;
    let mut metadata = MetadataMap::new();
    prepare_metadata(&parts.headers, &mut metadata);

    let params = QueryParam {
        query: parsed.sql,
        database: Vec::new(),
        output_format: OutputFormat::ArrowStream as i32,
        params: settings_to_string_map(parsed.settings),
    };

    let stream = execute_query(channel, metadata, params)
        .await
        .map_err(HttpError::from)?;

    let query_id = uuid::Uuid::new_v4().to_string();
    let state = Arc::new(QueryState::new(query_id.clone(), cfg.expiration_ttl));
    cfg.registry.insert(state.clone());

    // Consumer task owns the gRPC stream for the lifetime of the query.
    tokio::spawn(consume_stream(state.clone(), stream));

    // Give fast queries a short window to finish inline.
    if cfg.inline_deadline > Duration::ZERO {
        let _ = tokio::time::timeout(cfg.inline_deadline, wait_until_terminal(state.clone())).await;
    }

    let snapshot = state.snapshot_status();
    let status_header = snapshot.to_header_value();

    if snapshot.completion_status.is_terminal() {
        if let Some(err) = state.take_error() {
            cfg.registry.remove(&query_id);
            return Err(HttpError::from(err));
        }
        let body = concat_chunks(&state.snapshot_chunks());
        Ok(arrow_response(body, status_header))
    } else {
        // Empty body, client polls via GET /v3/query/{id} and /chunk/{cid}.
        let mut resp = Response::builder()
            .status(StatusCode::OK)
            .body(empty_body())
            .expect("post response");
        resp.headers_mut()
            .insert("content-type", HeaderValue::from_static(CONTENT_TYPE_ARROW));
        if let Some(v) = status_header {
            resp.headers_mut().insert("status", v);
        }
        Ok(resp)
    }
}

async fn handle_get_status(
    req: Request<Incoming>,
    cfg: &Arc<Config>,
    query_id: String,
) -> Result<Response<BoxedBody>, HttpError> {
    let state = cfg
        .registry
        .get(&query_id)
        .ok_or_else(|| HttpError::not_found(format!("unknown query_id: {}", query_id)))?;

    let wait_ms = parse_query(&req, "waitTimeMs")?
        .map(|s| s.parse::<u64>().unwrap_or(0))
        .unwrap_or(cfg.long_poll_default.as_millis() as u64);
    let wait = Duration::from_millis(wait_ms.min(cfg.long_poll_max.as_millis() as u64));

    if !state.is_terminal() && wait > Duration::ZERO {
        state.wait_for_change(wait).await;
    }

    let snapshot = state.snapshot_status();
    let body = serde_json::to_vec(&snapshot).unwrap_or_else(|_| b"{}".to_vec());
    let mut resp = Response::builder()
        .status(StatusCode::OK)
        .body(Full::new(Bytes::from(body)).map_err(|n| match n {}).boxed())
        .expect("status response");
    resp.headers_mut()
        .insert("content-type", HeaderValue::from_static("application/json"));
    Ok(resp)
}

async fn handle_delete_query(
    cfg: &Arc<Config>,
    query_id: String,
) -> Result<Response<BoxedBody>, HttpError> {
    if let Some(state) = cfg.registry.remove(&query_id) {
        state.request_cancel();
    }
    Ok(Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(empty_body())
        .expect("delete response"))
}

async fn handle_get_chunk(
    req: Request<Incoming>,
    cfg: &Arc<Config>,
    query_id: String,
    chunk_id_raw: String,
) -> Result<Response<BoxedBody>, HttpError> {
    negotiate_arrow(&req)?;
    let chunk_id: usize = chunk_id_raw
        .parse()
        .map_err(|_| HttpError::bad_request(format!("chunk id must be a non-negative integer: {}", chunk_id_raw)))?;
    let state = cfg
        .registry
        .get(&query_id)
        .ok_or_else(|| HttpError::not_found(format!("unknown query_id: {}", query_id)))?;

    loop {
        if let Some(chunk) = state.chunk_at(chunk_id) {
            let status = state.snapshot_status();
            if let Some(err) = state.take_error() {
                return Err(HttpError::from(err));
            }
            return Ok(arrow_response(chunk, status.to_header_value()));
        }
        if state.is_terminal() {
            if let Some(err) = state.take_error() {
                return Err(HttpError::from(err));
            }
            return Err(HttpError::not_found(format!(
                "chunk {} not available; total={}",
                chunk_id,
                state.chunk_count()
            )));
        }
        state.wait_for_change(cfg.long_poll_default).await;
    }
}

async fn handle_get_rows(
    req: Request<Incoming>,
    cfg: &Arc<Config>,
    query_id: String,
) -> Result<Response<BoxedBody>, HttpError> {
    negotiate_arrow(&req)?;
    let offset: u64 = parse_query(&req, "offset")?
        .ok_or_else(|| HttpError::bad_request("offset query parameter is required"))?
        .parse()
        .map_err(|_| HttpError::bad_request("offset must be a non-negative integer"))?;
    if offset != 0 {
        return Err(HttpError::bad_request(
            "row streaming with offset != 0 is not supported by this proxy",
        ));
    }
    let state = cfg
        .registry
        .get(&query_id)
        .ok_or_else(|| HttpError::not_found(format!("unknown query_id: {}", query_id)))?;

    // Long-poll until terminal, then emit the concatenated IPC stream.
    while !state.is_terminal() {
        state.wait_for_change(cfg.long_poll_default).await;
    }
    if let Some(err) = state.take_error() {
        return Err(HttpError::from(err));
    }
    let body = concat_chunks(&state.snapshot_chunks());
    Ok(arrow_response(body, state.snapshot_status().to_header_value()))
}

fn parse_query(req: &Request<Incoming>, key: &str) -> Result<Option<String>, HttpError> {
    let q = match req.uri().query() {
        Some(q) => q,
        None => return Ok(None),
    };
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        if k == key {
            return Ok(Some(v.to_string()));
        }
    }
    Ok(None)
}

fn settings_to_string_map(
    settings: Option<std::collections::HashMap<String, serde_json::Value>>,
) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    if let Some(map) = settings {
        for (k, v) in map {
            let s = match v {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            };
            out.insert(k, s);
        }
    }
    out
}

async fn wait_until_terminal(state: Arc<QueryState>) {
    while !state.is_terminal() {
        state.wait_for_change(Duration::from_secs(3_600)).await;
    }
}

async fn consume_stream(
    state: Arc<QueryState>,
    mut stream: tonic::codec::Streaming<crate::proto::hyper::QueryResult>,
) {
    loop {
        if state.is_cancelled() {
            log::info!("query_id={} cancelled by client", state.query_id);
            break;
        }
        match stream.next().await {
            Some(Ok(msg)) => match msg.result {
                Some(QueryResultKind::Header(_)) => {
                    // No-op for ARROW_STREAM: the first chunk carries the IPC schema.
                }
                Some(QueryResultKind::ArrowChunk(chunk)) => {
                    state.append_chunk(Bytes::from(chunk.data));
                }
                Some(QueryResultKind::Qsv1Chunk(_)) => {
                    // Unexpected: we always request ARROW_STREAM. Ignore.
                }
                None => {}
            },
            Some(Err(err)) => {
                log::warn!("query_id={} grpc error: {}", state.query_id, err);
                state.mark_error(err);
                return;
            }
            None => break,
        }
    }
    state.mark_finished();
}
