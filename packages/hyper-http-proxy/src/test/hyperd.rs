//! Integration test that drives the proxy against a real `hyperd`.
//!
//! The test binary is optional: it runs only when `HYPERD_BIN` is set in the
//! environment and the file exists. Under Bazel this env var is wired via the
//! `rust_test(..., env = { "HYPERD_BIN": "$(location ...)" })` on the hyperd
//! binary runfile. For `cargo test`, point it at a local hyperd:
//!
//!   HYPERD_BIN=/path/to/hyperd cargo test -p hyper-http-proxy -- --ignored
//!
//! The test is marked `#[ignore]` so it never runs on plain `cargo test`, which
//! would time out trying to locate a hyperd binary that does not exist.

use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;

use crate::config::{Args, Config};
use crate::http_api;

struct Hyperd {
    child: Child,
    port: u16,
}

impl Hyperd {
    fn endpoint(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

impl Drop for Hyperd {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn pick_port() -> u16 {
    let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    listener.local_addr().unwrap().port()
}

/// Spawn hyperd and block until its gRPC port accepts TCP connections.
async fn spawn_hyperd(bin: PathBuf) -> Hyperd {
    let port = pick_port();
    let mut cmd = Command::new(&bin);
    cmd.arg("run")
        .arg(format!("--listen-connection=tcp.grpc://127.0.0.1:{}", port))
        .arg("--skip-license")
        .arg("--no-password")
        .arg("--init-user=tableau_internal_user")
        .arg("--log_config=cerr,json,all")
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    // If the binary lives next to its shared library (as it does when laid
    // out by our bazel repo rule), make sure the loader can find the library.
    if let Some(parent) = bin.parent() {
        cmd.env("LD_LIBRARY_PATH", parent);
        cmd.env("DYLD_LIBRARY_PATH", parent);
    }

    let child = cmd.spawn().expect("spawn hyperd");
    let handle = Hyperd { child, port };

    // Poll for the gRPC port to open. Hyperd's cold-start is typically a
    // few seconds.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if StdTcpListener::bind(("127.0.0.1", port)).is_err() {
            // Port is taken → hyperd is listening.
            break;
        }
        if Instant::now() > deadline {
            panic!("hyperd failed to open port {} within 30s", port);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    handle
}

async fn spawn_proxy(cfg: Arc<Config>) -> (std::net::SocketAddr, tokio::sync::oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
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
    (addr, shutdown_tx)
}

fn hyperd_binary() -> Option<PathBuf> {
    let path = std::env::var_os("HYPERD_BIN")?;
    let pb = PathBuf::from(path);
    if pb.exists() {
        Some(pb)
    } else {
        None
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires real hyperd; enable with HYPERD_BIN=/path/to/hyperd and --ignored"]
async fn proxy_executes_select_one_on_real_hyperd() {
    let bin = match hyperd_binary() {
        Some(p) => p,
        None => {
            eprintln!("skipping: HYPERD_BIN not set or file missing");
            return;
        }
    };

    let hyperd = spawn_hyperd(bin).await;
    let args = Args {
        allow_forward_to: vec!["127.0.0.1".into()],
        listen: "127.0.0.1:0".into(),
        allow_origin: "http://localhost:9002".into(),
        expiration_ttl_secs: 60,
        long_poll_default_ms: 500,
        long_poll_max_ms: 5_000,
        inline_deadline_ms: 5_000, // real queries take time; let POST finish inline
    };
    let cfg = Arc::new(Config::from_args(args).unwrap());
    let (proxy_addr, proxy_shutdown) = spawn_proxy(cfg.clone()).await;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{}/api/v3/query", proxy_addr))
        .header("dashql-grpc-endpoint", hyperd.endpoint())
        .header("accept", "application/vnd.apache.arrow.stream")
        .header("content-type", "application/json")
        .body(r#"{"sql":"select 1 as healthy"}"#)
        .send()
        .await
        .expect("POST /api/v3/query");
    assert_eq!(resp.status().as_u16(), 200, "status header: {:?}", resp.headers().get("status"));

    let status_header = resp
        .headers()
        .get("status")
        .expect("status header on response")
        .to_str()
        .unwrap()
        .to_string();
    let status: serde_json::Value = serde_json::from_str(&status_header).unwrap();
    let completion = status["completionStatus"]
        .as_str()
        .expect("completionStatus present")
        .to_string();
    let query_id = status["queryId"].as_str().unwrap().to_string();
    assert!(!query_id.is_empty());

    let body = resp.bytes().await.unwrap();

    // If the stream finished inline (typical for select 1) the body contains
    // an Arrow IPC stream with at least the 8-byte magic. If it didn't, the
    // client is expected to poll — but for `select 1` on a freshly-started
    // hyperd this should always complete inline.
    if completion == "FINISHED" {
        assert!(
            body.len() >= 8,
            "expected non-empty Arrow stream for FINISHED select 1, got {} bytes",
            body.len()
        );
        // Arrow IPC stream magic: "ARROW1\0\0" or the stream format header.
        // We just sanity-check non-emptiness here.
    } else {
        // Poll the chunk endpoint instead.
        let mut collected = 0usize;
        for cid in 0..16 {
            let r = client
                .get(format!(
                    "http://{}/api/v3/query/{}/chunk/{}",
                    proxy_addr, query_id, cid
                ))
                .header("accept", "application/vnd.apache.arrow.stream")
                .send()
                .await
                .unwrap();
            if r.status().as_u16() == 404 {
                break;
            }
            assert_eq!(r.status().as_u16(), 200);
            collected += r.bytes().await.unwrap().len();
        }
        assert!(collected > 0, "no chunks returned for select 1");
    }

    // Cleanup
    let _ = client
        .delete(format!("http://{}/api/v3/query/{}", proxy_addr, query_id))
        .send()
        .await;
    let _ = proxy_shutdown.send(());
    drop(hyperd); // kill child
}
