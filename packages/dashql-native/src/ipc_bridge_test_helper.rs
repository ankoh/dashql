mod duckdb;
mod duckdb_proxy;
mod duckdb_proxy_globals;
mod duckdb_proxy_routes;
mod grpc_client;
mod grpc_proxy;
mod grpc_proxy_globals;
mod grpc_proxy_routes;
mod grpc_stream_manager;
mod http_proxy;
mod http_proxy_globals;
mod http_proxy_routes;
mod http_stream_manager;
mod ipc_router;
mod proto;
mod proxy_headers;
mod status;

use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};
use tauri::http::Request;

#[derive(Serialize, Deserialize)]
struct BridgeRequest {
    request_id: usize,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct BridgeResponse {
    request_id: usize,
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn build_request(req: &BridgeRequest) -> anyhow::Result<Request<Vec<u8>>> {
    let mut builder = Request::builder().method(req.method.as_str()).uri(req.url.as_str());
    for (key, value) in &req.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }
    Ok(builder.body(req.body.clone())?)
}

fn build_response(request_id: usize, response: tauri::http::Response<Vec<u8>>) -> BridgeResponse {
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| value.to_str().ok().map(|value| (key.as_str().to_string(), value.to_string())))
        .collect();
    BridgeResponse {
        request_id,
        status: response.status().as_u16(),
        status_text: response.status().canonical_reason().unwrap_or_default().to_string(),
        headers,
        body: response.body().clone(),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let req: BridgeRequest = serde_json::from_str(&line)?;
        let request = build_request(&req)?;
        let response = ipc_router::route_ipc_request(request).await;
        let payload = build_response(req.request_id, response);
        serde_json::to_writer(&mut stdout, &payload)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }

    Ok(())
}
