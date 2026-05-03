use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::config::{Args, Config};
use crate::http_api;
use crate::proto::hyper::{
    query_result::Result as QueryResultKind, QueryBinaryResultChunk, QueryResult,
    QueryResultHeader, QueryResultSchema,
};
use crate::test::hyper_service_mock::{spawn, HyperServiceMock};

struct ProxyHandle {
    addr: SocketAddr,
    shutdown: oneshot::Sender<()>,
}

async fn spawn_proxy(cfg: Arc<Config>) -> ProxyHandle {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accepted = listener.accept() => {
                    let (stream, _peer) = match accepted {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let cfg = cfg.clone();
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = service_fn(move |req| http_api::handle(req, cfg.clone()));
                        let _ = hyper::server::conn::http1::Builder::new()
                            .serve_connection(io, service)
                            .await;
                    });
                }
            }
        }
    });
    ProxyHandle { addr, shutdown: shutdown_tx }
}

fn test_config() -> Arc<Config> {
    let args = Args {
        allow_forward_to: vec!["localhost".into(), "127.0.0.1".into()],
        listen: "127.0.0.1:0".into(),
        allow_origin: "http://localhost:9002".into(),
        expiration_ttl_secs: 300,
        long_poll_default_ms: 500,
        long_poll_max_ms: 2_000,
        inline_deadline_ms: 0,
    };
    Arc::new(Config::from_args(args).unwrap())
}

fn arrow_chunk(bytes: &[u8]) -> QueryResult {
    QueryResult {
        result: Some(QueryResultKind::ArrowChunk(QueryBinaryResultChunk {
            data: bytes.to_vec(),
        })),
    }
}

fn schema_header() -> QueryResult {
    QueryResult {
        result: Some(QueryResultKind::Header(QueryResultHeader {
            header: Some(
                crate::proto::hyper::query_result_header::Header::Schema(QueryResultSchema {
                    column: vec![],
                }),
            ),
        })),
    }
}

#[tokio::test]
async fn post_then_poll_chunk_then_delete() {
    let (mock, mut setup) = HyperServiceMock::new();
    let (grpc_addr, grpc_shutdown) = spawn(mock).await;
    let cfg = test_config();
    let proxy = spawn_proxy(cfg.clone()).await;

    let client = reqwest::Client::new();
    let grpc_endpoint = format!("http://{}", grpc_addr);

    // Drive the mock on a side task: respond with schema + 2 chunks, then close.
    let driver = tokio::spawn(async move {
        let (params, responder) = setup.recv().await.expect("setup received");
        assert_eq!(params.query, "select 1");
        responder.send(Ok(schema_header())).await.unwrap();
        responder.send(Ok(arrow_chunk(b"chunk-0"))).await.unwrap();
        responder.send(Ok(arrow_chunk(b"chunk-1"))).await.unwrap();
        drop(responder);
    });

    // Kick off the POST.
    let resp = client
        .post(format!("http://{}/v3/query", proxy.addr))
        .header("x-grpc-endpoint", &grpc_endpoint)
        .header("accept", "application/vnd.apache.arrow.stream")
        .header("content-type", "application/json")
        .body(r#"{"sql":"select 1"}"#)
        .send()
        .await
        .expect("POST");
    assert_eq!(resp.status().as_u16(), 200);
    let status_header = resp
        .headers()
        .get("status")
        .expect("status header present")
        .to_str()
        .unwrap()
        .to_string();
    let v: serde_json::Value = serde_json::from_str(&status_header).unwrap();
    let query_id = v["queryId"].as_str().unwrap().to_string();

    driver.await.unwrap();

    // Poll status until FINISHED.
    let mut terminal = false;
    for _ in 0..20 {
        let resp = client
            .get(format!(
                "http://{}/v3/query/{}?waitTimeMs=500",
                proxy.addr, query_id
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 200);
        let body: serde_json::Value = resp.json().await.unwrap();
        if body["completionStatus"] == "FINISHED" {
            terminal = true;
            // chunkCount serializes as a string.
            assert_eq!(body["chunkCount"], "2");
            break;
        }
    }
    assert!(terminal, "status did not reach FINISHED");

    // Fetch chunks.
    for (idx, expected) in [(0, b"chunk-0".to_vec()), (1, b"chunk-1".to_vec())] {
        let resp = client
            .get(format!(
                "http://{}/v3/query/{}/chunk/{}",
                proxy.addr, query_id, idx
            ))
            .header("accept", "application/vnd.apache.arrow.stream")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 200);
        assert_eq!(
            resp.headers().get("content-type").unwrap(),
            "application/vnd.apache.arrow.stream"
        );
        let body = resp.bytes().await.unwrap();
        assert_eq!(body.to_vec(), expected);
    }

    // Chunk past end returns 404.
    let resp = client
        .get(format!(
            "http://{}/v3/query/{}/chunk/9",
            proxy.addr, query_id
        ))
        .header("accept", "application/vnd.apache.arrow.stream")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 404);

    // DELETE is idempotent.
    let resp = client
        .delete(format!("http://{}/v3/query/{}", proxy.addr, query_id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 204);
    let resp = client
        .delete(format!("http://{}/v3/query/{}", proxy.addr, query_id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 204);

    let _ = grpc_shutdown.send(());
    let _ = proxy.shutdown.send(());
}

#[tokio::test]
async fn post_rejects_missing_endpoint_header() {
    let cfg = test_config();
    let proxy = spawn_proxy(cfg.clone()).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{}/v3/query", proxy.addr))
        .header("accept", "application/vnd.apache.arrow.stream")
        .header("content-type", "application/json")
        .body(r#"{"sql":"select 1"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 400);
    let _ = proxy.shutdown.send(());
}

#[tokio::test]
async fn post_rejects_disallowed_host() {
    let cfg = test_config();
    let proxy = spawn_proxy(cfg.clone()).await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{}/v3/query", proxy.addr))
        .header("x-grpc-endpoint", "http://not-allowed.example")
        .header("accept", "application/vnd.apache.arrow.stream")
        .header("content-type", "application/json")
        .body(r#"{"sql":"select 1"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 400);
    let _ = proxy.shutdown.send(());
}

#[tokio::test]
async fn preflight_options_returns_cors_headers() {
    let cfg = test_config();
    let proxy = spawn_proxy(cfg.clone()).await;
    let client = reqwest::Client::new();
    let resp = client
        .request(
            reqwest::Method::OPTIONS,
            format!("http://{}/v3/query", proxy.addr),
        )
        .header("origin", "http://localhost:9002")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "content-type,accept")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 204);
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "http://localhost:9002"
    );
    let _ = proxy.shutdown.send(());
}

#[tokio::test]
async fn delete_cancels_in_flight_query() {
    let (mock, mut setup) = HyperServiceMock::new();
    let (grpc_addr, grpc_shutdown) = spawn(mock).await;
    let cfg = test_config();
    let proxy = spawn_proxy(cfg.clone()).await;

    // Responder never closes its stream — proxy must cancel on DELETE.
    tokio::spawn(async move {
        let (_params, responder) = setup.recv().await.unwrap();
        responder.send(Ok(schema_header())).await.unwrap();
        // Keep open until client cancels.
        loop {
            if responder.is_closed() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{}/v3/query", proxy.addr))
        .header("x-grpc-endpoint", format!("http://{}", grpc_addr))
        .header("accept", "application/vnd.apache.arrow.stream")
        .header("content-type", "application/json")
        .body(r#"{"sql":"select long"}"#)
        .send()
        .await
        .unwrap();
    let status_header = resp.headers().get("status").unwrap().to_str().unwrap().to_string();
    let v: serde_json::Value = serde_json::from_str(&status_header).unwrap();
    let query_id = v["queryId"].as_str().unwrap().to_string();

    let resp = client
        .delete(format!("http://{}/v3/query/{}", proxy.addr, query_id))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 204);

    let _ = grpc_shutdown.send(());
    let _ = proxy.shutdown.send(());
}
