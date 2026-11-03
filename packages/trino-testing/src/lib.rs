//! A Trino server for the integration tests: a single-node Trino with only the tpch catalog, started
//! from the Bazel runfiles, and a small client of the Trino REST API that keeps every response.
//!
//! The server and the Java runtime come from `@trino_server` and `@temurin_jre_25_*`
//! (`//bazel:external_trino.bzl`). The test targets pass their runfiles paths in `TRINO_LAUNCHER` and
//! `TRINO_JAVA`.

pub mod queries;

use serde_json::Value;
use std::fs;
use std::io;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The user of the test queries
pub const TRINO_USER: &str = "dashql-test";
/// How long the server may take to start
const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);

/// A running Trino server, stopped on drop
pub struct TrinoServer {
    /// The launcher process
    process: Child,
    /// The HTTP endpoint, e.g. `http://127.0.0.1:41234`
    pub endpoint: String,
    /// The server log
    pub log_path: PathBuf,
}

/// Resolve a runfiles path from an environment variable
fn runfile_from_env(name: &str) -> io::Result<PathBuf> {
    let path = std::env::var(name).map_err(|_| io::Error::other(format!("{name} is not set")))?;
    fs::canonicalize(&path).map_err(|e| io::Error::other(format!("{name}={path}: {e}")))
}

/// Pick a free local port
fn free_port() -> io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// A writable scratch directory: the Bazel test tmpdir, or the system temp directory
fn scratch_dir(name: &str) -> io::Result<PathBuf> {
    let base = std::env::var_os("TEST_TMPDIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join(format!("{name}-{}", std::process::id()));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write the configuration of a single-node server with the tpch catalog
fn write_config(etc: &Path, data: &Path, plugin_dir: &Path, port: u16) -> io::Result<()> {
    fs::create_dir_all(etc.join("catalog"))?;
    fs::create_dir_all(data)?;
    fs::write(
        etc.join("node.properties"),
        format!("node.environment=test\nnode.id=dashql-test\nnode.data-dir={}\n", data.display()),
    )?;
    fs::write(
        etc.join("jvm.config"),
        "-server\n-Xmx1G\n-XX:+UseG1GC\n-XX:+ExitOnOutOfMemoryError\n-Djdk.attach.allowAttachSelf=true\n",
    )?;
    fs::write(
        etc.join("config.properties"),
        format!(
            "coordinator=true\n\
             node-scheduler.include-coordinator=true\n\
             http-server.http.port={port}\n\
             discovery.uri=http://127.0.0.1:{port}\n\
             plugin.dir={}\n\
             task.max-worker-threads=2\n\
             query.max-memory=512MB\n\
             query.max-memory-per-node=512MB\n",
            plugin_dir.display()
        ),
    )?;
    fs::write(etc.join("log.properties"), "io.trino=WARN\n")?;
    fs::write(etc.join("catalog/tpch.properties"), "connector.name=tpch\ntpch.column-naming=STANDARD\n")?;
    Ok(())
}

impl TrinoServer {
    /// Start a server on a free port and wait until it accepts queries
    pub fn start() -> io::Result<Self> {
        Self::start_on_port(free_port()?)
    }

    /// Start a server on a port and wait until it accepts queries
    pub fn start_on_port(port: u16) -> io::Result<Self> {
        let launcher = runfile_from_env("TRINO_LAUNCHER")?;
        let java = runfile_from_env("TRINO_JAVA")?;
        let trino_home = launcher.parent().and_then(Path::parent).ok_or_else(|| io::Error::other("bad launcher path"))?;
        let java_home = java.parent().and_then(Path::parent).ok_or_else(|| io::Error::other("bad java path"))?;

        let scratch = scratch_dir("trino")?;
        let etc = scratch.join("etc");
        let data = scratch.join("data");
        write_config(&etc, &data, &trino_home.join("plugin"), port)?;

        // Keep the log next to the test outputs when Bazel collects them
        let outputs = std::env::var_os("TEST_UNDECLARED_OUTPUTS_DIR").map(PathBuf::from);
        let log_dir = outputs.unwrap_or_else(|| scratch.clone());
        let log_path = log_dir.join("trino-server.log");
        let log = fs::File::create(&log_path)?;
        let path = format!("{}:{}", java_home.join("bin").display(), std::env::var("PATH").unwrap_or_default());
        let process = Command::new(&launcher)
            .arg("run")
            .arg(format!("--etc-dir={}", etc.display()))
            .arg(format!("--data-dir={}", data.display()))
            .env("JAVA_HOME", java_home)
            .env("PATH", path)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()?;

        let mut server = TrinoServer { process, endpoint: format!("http://127.0.0.1:{port}"), log_path };
        server.wait_until_ready()?;
        Ok(server)
    }

    /// Wait until `/v1/info` reports that the server finished starting
    fn wait_until_ready(&mut self) -> io::Result<()> {
        let client = TrinoClient::new(&self.endpoint);
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        while Instant::now() < deadline {
            if let Some(status) = self.process.try_wait()? {
                return Err(io::Error::other(format!("Trino exited with {status}, see {}", self.log_path.display())));
            }
            if let Ok(info) = client.get_json("/v1/info") {
                if info.get("starting").and_then(Value::as_bool) == Some(false) {
                    return Ok(());
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let log = self.log_path.display();
        Err(io::Error::other(format!("Trino did not start within {STARTUP_TIMEOUT:?}, see {log}")))
    }

    /// A client for this server
    pub fn client(&self) -> TrinoClient {
        TrinoClient::new(&self.endpoint)
    }
}

impl Drop for TrinoServer {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}

/// A response of the Trino API, with the time it arrived at
#[derive(Clone, Debug)]
pub struct TimedResponse {
    /// Milliseconds since the query was submitted
    pub elapsed_ms: u64,
    /// The response body
    pub body: Value,
}

/// Everything the client saw of one query
#[derive(Clone, Debug, Default)]
pub struct QueryRun {
    /// The query id
    pub query_id: String,
    /// The `/v1/statement` responses: the POST, then every `nextUri` GET
    pub statement_responses: Vec<TimedResponse>,
    /// The `/v1/query/{id}` responses sampled while the query ran (with `query_info_params`), and the
    /// full ones after it reached a final state
    pub query_infos: Vec<TimedResponse>,
}

impl QueryRun {
    /// The `stats` of every statement response
    pub fn stats(&self) -> impl Iterator<Item = &Value> {
        self.statement_responses.iter().filter_map(|r| r.body.get("stats"))
    }
    /// The error of the query, if any
    pub fn error(&self) -> Option<&Value> {
        self.statement_responses.iter().find_map(|r| r.body.get("error"))
    }
    /// The last QueryInfo
    pub fn final_query_info(&self) -> Option<&Value> {
        self.query_infos.last().map(|r| &r.body)
    }
}

/// How to run a query
#[derive(Clone, Debug, Default)]
pub struct QueryOptions {
    /// Session properties, sent as `X-Trino-Session`
    pub session: Vec<(String, String)>,
    /// Sample `/v1/query/{id}` at most this often while the query runs (none if unset)
    pub query_info_interval: Option<Duration>,
    /// Query parameters of the sampled `/v1/query/{id}` requests, e.g. `pruned=true`
    pub query_info_params: String,
    /// Cancel the query after this long
    pub cancel_after: Option<Duration>,
}

/// A client of the Trino REST API
pub struct TrinoClient {
    /// The endpoint
    endpoint: String,
    /// The HTTP client
    http: reqwest::Client,
    /// A runtime for the blocking API
    runtime: tokio::runtime::Runtime,
}

impl TrinoClient {
    /// Constructor
    pub fn new(endpoint: &str) -> Self {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("tokio runtime");
        let http = reqwest::Client::builder().build().expect("http client");
        Self { endpoint: endpoint.to_string(), http, runtime }
    }

    /// GET a JSON document of the server
    pub fn get_json(&self, path: &str) -> io::Result<Value> {
        self.send_json(self.http.get(format!("{}{path}", self.endpoint)))
    }

    /// Send a request and read its JSON body
    fn send_json(&self, request: reqwest::RequestBuilder) -> io::Result<Value> {
        self.runtime.block_on(async {
            let response = request.header("X-Trino-User", TRINO_USER).send().await.map_err(io::Error::other)?;
            let status = response.status();
            let text = response.text().await.map_err(io::Error::other)?;
            if !status.is_success() {
                return Err(io::Error::other(format!("HTTP {status}: {text}")));
            }
            serde_json::from_str(&text).map_err(io::Error::other)
        })
    }

    /// Run a query to completion and keep every response.
    ///
    /// The `nextUri` requests are long polls, so `/v1/query/{id}` is sampled on a separate thread.
    pub fn run_query(&self, sql: &str, options: &QueryOptions) -> io::Result<QueryRun> {
        let started = Instant::now();
        let elapsed_ms = || started.elapsed().as_millis() as u64;
        let session = options.session.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(",");
        let mut submit = self
            .http
            .post(format!("{}/v1/statement", self.endpoint))
            .header("X-Trino-Catalog", "tpch")
            .header("X-Trino-Schema", "tiny")
            .body(sql.to_string());
        if !session.is_empty() {
            submit = submit.header("X-Trino-Session", session);
        }
        let first = self.send_json(submit)?;
        let mut run = QueryRun {
            query_id: first.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
            ..Default::default()
        };
        let mut next_uri = first.get("nextUri").and_then(Value::as_str).map(str::to_string);
        run.statement_responses.push(TimedResponse { elapsed_ms: elapsed_ms(), body: first });

        let info_path = match options.query_info_params.as_str() {
            "" => format!("/v1/query/{}", run.query_id),
            params => format!("/v1/query/{}?{params}", run.query_id),
        };

        // Sample QueryInfo until the statement loop is done
        let stop = Arc::new(AtomicBool::new(false));
        let sampler = options.query_info_interval.map(|interval| {
            let (endpoint, path, stop) = (self.endpoint.clone(), info_path.clone(), stop.clone());
            std::thread::spawn(move || {
                let client = TrinoClient::new(&endpoint);
                let mut samples = Vec::new();
                while !stop.load(Ordering::Relaxed) {
                    if let Ok(info) = client.get_json(&path) {
                        samples.push(TimedResponse { elapsed_ms: started.elapsed().as_millis() as u64, body: info });
                    }
                    std::thread::sleep(interval);
                }
                samples
            })
        });

        let mut result = Ok(());
        while let Some(uri) = next_uri.take() {
            if options.cancel_after.is_some_and(|t| started.elapsed() >= t) {
                result = self
                    .runtime
                    .block_on(async {
                        self.http.delete(&uri).header("X-Trino-User", TRINO_USER).send().await.map_err(io::Error::other)
                    })
                    .map(|_| ());
                break;
            }
            match self.send_json(self.http.get(&uri)) {
                Ok(body) => {
                    next_uri = body.get("nextUri").and_then(Value::as_str).map(str::to_string);
                    run.statement_responses.push(TimedResponse { elapsed_ms: elapsed_ms(), body });
                }
                Err(e) => result = Err(e),
            }
        }
        stop.store(true, Ordering::Relaxed);
        if let Some(sampler) = sampler {
            run.query_infos = sampler.join().map_err(|_| io::Error::other("QueryInfo sampler panicked"))?;
        }
        result?;

        // The final QueryInfo, once the query reached a final state. Never pruned, it carries the plans.
        if options.query_info_interval.is_some() {
            let final_path = format!("/v1/query/{}", run.query_id);
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let info = self.get_json(&final_path)?;
                let done = matches!(info.get("state").and_then(Value::as_str), Some("FINISHED" | "FAILED"));
                run.query_infos.push(TimedResponse { elapsed_ms: elapsed_ms(), body: info });
                if done || Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }
        Ok(run)
    }

    /// Run a query and return its rows
    pub fn query_rows(&self, sql: &str) -> io::Result<Vec<Value>> {
        let run = self.run_query(sql, &QueryOptions::default())?;
        if let Some(error) = run.error() {
            return Err(io::Error::other(format!("query failed: {error}")));
        }
        Ok(run
            .statement_responses
            .iter()
            .filter_map(|r| r.body.get("data").and_then(Value::as_array))
            .flatten()
            .cloned()
            .collect())
    }

    /// The fragments of `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)`
    pub fn explain_distributed(&self, sql: &str) -> io::Result<Value> {
        let rows = self.query_rows(&format!("EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON) {sql}"))?;
        let text = rows
            .first()
            .and_then(|row| row.get(0))
            .and_then(Value::as_str)
            .ok_or_else(|| io::Error::other("EXPLAIN returned no text"))?;
        serde_json::from_str(text).map_err(io::Error::other)
    }
}
