use std::io::Write;
use std::time::Duration;

use http::HeaderMap;
use lazy_static::lazy_static;
use tauri::http::header::CONTENT_TYPE;
use tauri::http::Request;
use tauri::http::Response;

use crate::docker_log_stream_manager::DockerStreamBatch;
use crate::docker_proxy::DockerProxy;
use crate::docker_registry_client;
use crate::proxy_headers::HEADER_NAME_BATCH_BYTES;
use crate::proxy_headers::HEADER_NAME_BATCH_EVENT;
use crate::proxy_headers::HEADER_NAME_BATCH_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_READ_TIMEOUT;
use crate::proxy_headers::HEADER_NAME_STREAM_ID;
use crate::status::Status;

lazy_static! {
    static ref DOCKER_PROXY: DockerProxy = DockerProxy::default();
}

fn require_usize_header(headers: &HeaderMap, header_name: &'static str) -> Result<usize, Status> {
    if let Some(header) = headers.get(header_name) {
        let header = header
            .to_str()
            .map_err(|e| Status::HeaderHasInvalidEncoding { header: header_name, message: e.to_string() })?
            .to_string();
        let header: usize = header
            .parse::<usize>()
            .map_err(|e| Status::HeaderIsNotAnUsize { header: header_name, message: e.to_string() })?;
        Ok(header)
    } else {
        Err(Status::HeaderRequiredButMissing { header: header_name })
    }
}

fn json_response(status: u16, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime::APPLICATION_JSON.essence_str())
        .body(body)
        .unwrap()
}

fn empty_response(status: u16) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

/// GET /docker/containers
pub async fn list_containers(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let label = req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "label")
                .map(|(_, v)| v.to_string())
        });
    match DOCKER_PROXY.list_containers(label.as_deref()).await {
        Ok(containers) => {
            let body = serde_json::to_vec(&containers).unwrap_or_default();
            json_response(200, body)
        }
        Err(e) => Response::from(&e),
    }
}

/// POST /docker/containers (create) -> { id }
pub async fn create_container(mut req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let name = req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "name")
                .map(|(_, v)| v.to_string())
        });
    let body = std::mem::take(req.body_mut());
    match DOCKER_PROXY.create_container(name.as_deref(), body).await {
        Ok(id) => {
            let resp = serde_json::json!({ "Id": id });
            json_response(200, serde_json::to_vec(&resp).unwrap_or_default())
        }
        Err(e) => Response::from(&e),
    }
}

/// DELETE /docker/containers/{id}
pub async fn delete_container(id: String, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let force = req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "force")
                .map(|(_, v)| v == "true")
        })
        .unwrap_or(false);
    match DOCKER_PROXY.remove_container(&id, force).await {
        Ok(_) => empty_response(204),
        Err(e) => Response::from(&e),
    }
}

/// POST /docker/containers/{id}/start
pub async fn start_container(id: String, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DOCKER_PROXY.start_container(&id).await {
        Ok(_) => empty_response(204),
        Err(e) => Response::from(&e),
    }
}

/// POST /docker/containers/{id}/stop
pub async fn stop_container(id: String, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    match DOCKER_PROXY.stop_container(&id).await {
        Ok(_) => empty_response(204),
        Err(e) => Response::from(&e),
    }
}

/// POST /docker/log-streams?container={id} → start stream, return stream id.
pub async fn start_log_stream(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let container = match req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "container")
                .map(|(_, v)| v.to_string())
        }) {
        Some(c) => c,
        None => {
            return Response::from(&Status::DockerRequestFailed {
                error: "missing container query parameter".to_string(),
            });
        }
    };
    let path = format!(
        "/containers/{}/logs?stdout=true&stderr=true&follow=true&timestamps=false&tail=200",
        container
    );
    match DOCKER_PROXY.log_streams.start_stream("GET", path) {
        Ok(stream_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_STREAM_ID, stream_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

/// GET /docker/log-streams/{id} → poll one batch.
pub async fn read_log_stream(stream_id: usize, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let read_timeout = match require_usize_header(req.headers(), HEADER_NAME_READ_TIMEOUT) {
        Ok(v) => v,
        Err(e) => return Response::from(&e),
    };
    let batch_timeout = match require_usize_header(req.headers(), HEADER_NAME_BATCH_TIMEOUT) {
        Ok(v) => v,
        Err(e) => return Response::from(&e),
    };
    let batch_bytes = match require_usize_header(req.headers(), HEADER_NAME_BATCH_BYTES) {
        Ok(v) => v,
        Err(e) => return Response::from(&e),
    };
    let result = DOCKER_PROXY
        .log_streams
        .read_stream(
            stream_id,
            Duration::from_millis(read_timeout as u64),
            Duration::from_millis(batch_timeout as u64),
            batch_bytes,
        )
        .await;
    match result {
        Ok(batch) => batch_response(stream_id, batch),
        Err(e) => Response::from(&e),
    }
}

/// DELETE /docker/log-streams/{id}
pub async fn delete_log_stream(stream_id: usize, _req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    DOCKER_PROXY.log_streams.destroy_stream(stream_id).await;
    empty_response(200)
}

/// POST /docker/images/pull?fromImage=...&tag=... → start a pull stream, return stream id.
pub async fn start_pull_stream(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let from_image = match req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "fromImage")
                .map(|(_, v)| v.to_string())
        }) {
        Some(s) => s,
        None => {
            return Response::from(&Status::DockerRequestFailed {
                error: "missing fromImage query parameter".to_string(),
            });
        }
    };
    let tag = req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "tag")
                .map(|(_, v)| v.to_string())
        });
    let from_image_enc: String =
        url::form_urlencoded::byte_serialize(from_image.as_bytes()).collect();
    let path = if let Some(tag) = tag {
        let tag_enc: String = url::form_urlencoded::byte_serialize(tag.as_bytes()).collect();
        format!("/images/create?fromImage={}&tag={}", from_image_enc, tag_enc)
    } else {
        format!("/images/create?fromImage={}", from_image_enc)
    };
    match DOCKER_PROXY.log_streams.start_stream("POST", path) {
        Ok(stream_id) => Response::builder()
            .status(200)
            .header(HEADER_NAME_STREAM_ID, stream_id)
            .body(Vec::new())
            .unwrap(),
        Err(e) => Response::from(&e),
    }
}

fn batch_response(stream_id: usize, batches: DockerStreamBatch) -> Response<Vec<u8>> {
    let mut buffer: Vec<u8> = Vec::with_capacity(batches.total_body_bytes);
    for chunk in batches.body_chunks.iter() {
        let _ = buffer.write(chunk);
    }
    Response::builder()
        .status(200)
        .header(HEADER_NAME_STREAM_ID, stream_id)
        .header(HEADER_NAME_BATCH_EVENT, batches.event.to_str())
        .header(HEADER_NAME_BATCH_BYTES, batches.total_body_bytes)
        .body(buffer)
        .unwrap()
}

/// GET /docker/registry/tags?repository=...
pub async fn list_registry_tags(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let repository = match req
        .uri()
        .query()
        .and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "repository")
                .map(|(_, v)| v.to_string())
        }) {
        Some(s) => s,
        None => {
            return Response::from(&Status::DockerRequestFailed {
                error: "missing repository query parameter".to_string(),
            });
        }
    };
    match docker_registry_client::list_tags(&repository).await {
        Ok(tags) => {
            let body = serde_json::to_vec(&serde_json::json!({ "tags": tags })).unwrap_or_default();
            json_response(200, body)
        }
        Err(e) => Response::from(&e),
    }
}

