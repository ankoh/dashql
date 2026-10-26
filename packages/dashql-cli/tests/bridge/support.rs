//! The pieces of the agent bridge tests: the dashql binary as agent server, a DashQL page on the WebSocket and
//! the command line tool as the agent calls it.

#![allow(dead_code)]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

/// The dashql binary under test
pub fn dashql_binary() -> PathBuf {
    let path = PathBuf::from(std::env::var("DASHQL_BINARY").expect("DASHQL_BINARY is set by the test target"));
    std::env::current_dir().unwrap().join(path)
}

/// A file of the test target, absolute
pub fn test_file(variable: &str) -> PathBuf {
    let path = PathBuf::from(std::env::var(variable).unwrap_or_else(|_| panic!("{variable} is set by the test target")));
    std::env::current_dir().unwrap().join(path)
}

/// A new empty folder
pub fn temp_dir(name: &str) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let base = std::env::var_os("TEST_TMPDIR").map_or_else(std::env::temp_dir, PathBuf::from);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = base.join(format!("{name}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

pub const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

/// The environment of the server and the command line tool
pub enum Environment {
    /// Only a fixed PATH, nothing from the user
    Hermetic,
    /// The environment of the test, so real harnesses find their login and configuration
    Inherited,
}

/// `dashql agent serve` in its own home folder on a free port
pub struct Server {
    child: Child,
    pub home: PathBuf,
    pub port: u16,
    hermetic: bool,
    log: Arc<Mutex<String>>,
}

impl Server {
    /// Start a server, `config` is merged into the config.json with the token and the port
    pub fn start(config: Value, environment: Environment) -> Server {
        let home = temp_dir("dashql-agent-home");
        let hermetic = matches!(environment, Environment::Hermetic);
        // Tests run in parallel, another server may take the free port first
        for _ in 0..5 {
            if let Some(server) = Server::try_start(&config, &home, hermetic) {
                return server;
            }
        }
        panic!("the agent server found no free port");
    }

    fn try_start(config: &Value, home: &Path, hermetic: bool) -> Option<Server> {
        let port = free_port();
        let mut stored = json!({ "token": TOKEN, "port": port, "defaultHarness": "claude" });
        stored.as_object_mut().unwrap().extend(config.as_object().cloned().unwrap_or_default());
        std::fs::write(home.join("config.json"), stored.to_string()).unwrap();

        let mut command = Command::new(dashql_binary());
        command.args(["agent", "serve"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        apply_environment(&mut command, home, hermetic);
        let mut child = command.spawn().expect("the dashql binary starts");

        // The server logs to stderr, the first line says that it listens
        let (listening, wait) = std::sync::mpsc::channel();
        let log = Arc::new(Mutex::new(String::new()));
        let stderr = BufReader::new(child.stderr.take().unwrap());
        let shared_log = log.clone();
        std::thread::spawn(move || {
            for line in stderr.lines().map_while(Result::ok) {
                if line.contains("Listening on") {
                    let _ = listening.send(true);
                } else if line.contains("is taken") {
                    let _ = listening.send(false);
                }
                let mut log = shared_log.lock().unwrap();
                log.push_str(&line);
                log.push('\n');
            }
        });
        match wait.recv_timeout(Duration::from_secs(10)) {
            Ok(true) => Some(Server { child, home: home.to_path_buf(), port, hermetic, log }),
            Ok(false) => {
                let _ = child.wait();
                None
            }
            Err(_) => {
                let _ = child.kill();
                panic!("the agent server did not start:\n{}", log.lock().unwrap());
            }
        }
    }

    /// What the server logged so far
    pub fn log(&self) -> String {
        self.log.lock().unwrap().clone()
    }

    /// Run the command line tool as an agent outside a harness run would
    pub fn cli(&self, args: &[&str]) -> CliOutput {
        self.cli_with(args, "", &[])
    }

    /// Run the command line tool with stdin and additional environment variables
    pub fn cli_with(&self, args: &[&str], stdin: &str, env: &[(&str, &str)]) -> CliOutput {
        cli(&self.home, self.hermetic, &[&["agent"], args].concat(), stdin, env)
    }

    /// Run the command line tool with another configuration folder
    pub fn cli_in(&self, home: &Path, args: &[&str]) -> CliOutput {
        cli(home, self.hermetic, &[&["agent"], args].concat(), "", &[])
    }

    /// The working folder of the harness runs of a session
    pub fn session_dir(&self, session: &str) -> PathBuf {
        self.home.join("sessions").join(session)
    }

    pub async fn connect(&self) -> Page {
        Page::connect(self.port, "https://dashql.app").await.expect("the page connects")
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn apply_environment(command: &mut Command, home: &Path, hermetic: bool) {
    if hermetic {
        // Without SHELL the server keeps this PATH for harness runs instead of asking a login shell
        command.env_clear().env("PATH", "/usr/bin:/bin").env("HOME", home);
        if let Some(tmp) = std::env::var_os("TMPDIR") {
            command.env("TMPDIR", tmp);
        }
    }
    command.env("DASHQL_AGENT_HOME", home).env_remove("DASHQL_AGENT_PORT").env_remove("DASHQL_SESSION");
}

#[derive(Debug)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

fn cli(home: &Path, hermetic: bool, args: &[&str], stdin: &str, env: &[(&str, &str)]) -> CliOutput {
    let mut command = Command::new(dashql_binary());
    command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_environment(&mut command, home, hermetic);
    command.envs(env.iter().copied());
    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let output = child.wait_with_output().unwrap();
    CliOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into(),
        stderr: String::from_utf8_lossy(&output.stderr).into(),
        code: output.status.code().unwrap_or(-1),
    }
}

/// Run the command line tool off the async runtime, the page answers its call meanwhile
pub async fn cli_async(server: &Server, args: &[&str], stdin: &str, env: &[(&str, &str)]) -> CliOutput {
    let (home, hermetic) = (server.home.clone(), server.hermetic);
    let args: Vec<String> = [&["agent"], args].concat().iter().map(|s| s.to_string()).collect();
    let env: Vec<(String, String)> = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let stdin = stdin.to_string();
    tokio::task::spawn_blocking(move || {
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let env: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        cli(&home, hermetic, &args, &stdin, &env)
    })
    .await
    .unwrap()
}

// ------------------------------------------------------------------------------------------------
// The page

/// The tables of the page, every session has the same
pub const CATALOG: &str = "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, ordered_at TEXT NOT NULL, amount REAL NOT NULL);";

/// The scripts of the sessions and the commands that reached them, as the page holds them
#[derive(Default)]
pub struct Model {
    /// The scripts by session and name
    pub scripts: BTreeMap<String, BTreeMap<String, String>>,
    /// The scripts with a result by session
    results: BTreeMap<String, Vec<String>>,
    /// Every command with its session and args, in order
    pub commands: Vec<Value>,
}

impl Model {
    fn command(&mut self, params: &Value) -> Result<String, (&'static str, String)> {
        self.commands.push(params.clone());
        let session = params["session"].as_str().unwrap_or_default().to_string();
        let args = &params["args"];
        let scripts = self.scripts.entry(session.clone()).or_default();
        let name = args["script"].as_str().unwrap_or_default().trim_end_matches(".sql").to_string();
        let missing = || ("failed", format!("No script named {name}. Scripts: {}", list(scripts)));
        fn list(scripts: &BTreeMap<String, String>) -> String {
            scripts.keys().cloned().collect::<Vec<_>>().join(", ")
        }
        match params["command"].as_str().unwrap_or_default() {
            "scripts" => {
                let lines: Vec<String> = scripts.iter().map(|(n, t)| format!("  {n}  {} lines", t.lines().count())).collect();
                Ok(format!("Session {session}\nScripts:\n{}", lines.join("\n")))
            }
            "read" => scripts.get(&name).cloned().ok_or_else(missing),
            "edit" => {
                let text = args["text"].as_str().ok_or(("usage", "edit needs a text".to_string()))?;
                let created = scripts.insert(name.clone(), text.to_string()).is_none();
                Ok(format!("{} {name}: {} bytes, {} errors", if created { "Created" } else { "Updated" }, text.len(), lint(text).len()))
            }
            "catalog" => Ok(CATALOG.to_string()),
            "lint" => {
                let text = scripts.get(&name).ok_or_else(missing)?;
                let diagnostics = lint(text);
                Ok(if diagnostics.is_empty() { format!("{name}: no diagnostics") } else { format!("{name}:{}", diagnostics.join("\n")) })
            }
            "run" => {
                let text = scripts.get(&name).ok_or_else(missing)?;
                let rows = evaluate(text).map_err(|e| ("failed", format!("{name} failed: {e}")))?;
                self.results.entry(session).or_default().push(name);
                let max_rows = args["maxRows"].as_u64().unwrap_or(20) as usize;
                Ok(format_rows(&rows, 0, max_rows))
            }
            "result" => {
                let text = scripts.get(&name).ok_or_else(missing)?;
                if !self.results.get(&session).is_some_and(|r| r.contains(&name)) {
                    return Err(("failed", format!("{name} has no result, run it with dashql agent run {name}")));
                }
                let page = args["page"].as_u64().unwrap_or(1) as usize;
                Ok(format_rows(&evaluate(text).unwrap_or_default(), (page - 1) * 50, 50))
            }
            other => Err(("usage", format!("unknown command: {other}"))),
        }
    }
}

/// The statements of a script without its comment lines
fn statements(text: &str) -> String {
    text.lines().filter(|l| !l.trim_start().starts_with("--")).collect::<Vec<_>>().join("\n").trim().to_lowercase()
}

fn lint(text: &str) -> Vec<String> {
    let sql = statements(text);
    if sql.is_empty() || sql.starts_with("select") || sql.starts_with("with") {
        Vec::new()
    } else {
        vec!["1:1: error: syntax error".into()]
    }
}

/// The page does not run SQL, it knows the answers to the questions of the tests:
/// 6 orders that sum up to 174.75
fn evaluate(text: &str) -> Result<Vec<(String, String)>, String> {
    let sql = statements(text);
    if sql.is_empty() {
        return Err("the script has no statement".into());
    }
    if !lint(text).is_empty() {
        return Err("syntax error".into());
    }
    if sql.contains("count(") {
        return Ok(vec![("count".into(), "6".into())]);
    }
    if sql.contains("sum(") {
        return Ok(vec![("sum".into(), "174.75".into())]);
    }
    Ok(vec![("value".into(), "1".into())])
}

fn format_rows(rows: &[(String, String)], offset: usize, limit: usize) -> String {
    let mut lines = vec![format!("{} row{}, 1 column", rows.len(), if rows.len() == 1 { "" } else { "s" })];
    if let Some((column, _)) = rows.first() {
        lines.push(column.clone());
    }
    lines.extend(rows.iter().skip(offset).take(limit).map(|(_, value)| value.clone()));
    lines.join("\n")
}

/// A DashQL page on the WebSocket: answers the commands of the server from its model and records the rest
pub struct Page {
    outgoing: mpsc::UnboundedSender<Value>,
    incoming: mpsc::UnboundedReceiver<Value>,
    received: Vec<Value>,
    next_id: u64,
    pub model: Arc<Mutex<Model>>,
    /// Commands for this script are never answered, to drop the page during a call
    hang: Arc<Mutex<Option<String>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Page {
    /// Connect, the HTTP status of a refused handshake
    pub async fn connect(port: u16, origin: &str) -> Result<Page, u16> {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = format!(
            "GET /v1/ws HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {origin}\r\nConnection: Upgrade\r\n\
             Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut head = Vec::new();
        let mut byte = [0; 1];
        while !head.ends_with(b"\r\n\r\n") {
            assert!(stream.read(&mut byte).await.unwrap() > 0, "the server closed the connection");
            head.push(byte[0]);
        }
        let head = String::from_utf8_lossy(&head);
        let status: u16 = head.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
        if status != 101 {
            return Err(status);
        }
        let socket = WebSocketStream::from_raw_socket(stream, Role::Client, None).await;
        let (mut sink, mut source) = socket.split();
        let (outgoing, mut to_send) = mpsc::unbounded_channel::<Value>();
        let (received, incoming) = mpsc::unbounded_channel();
        let model = Arc::new(Mutex::new(Model::default()));
        let hang = Arc::new(Mutex::new(None::<String>));
        let (task_model, task_hang, replies) = (model.clone(), hang.clone(), outgoing.clone());
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(message) = to_send.recv() => {
                        if sink.send(Message::text(message.to_string())).await.is_err() {
                            return;
                        }
                    }
                    message = source.next() => {
                        // The socket answers the keepalive pings of the server itself
                        let text = match message {
                            Some(Ok(Message::Text(text))) => text,
                            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                            _ => return,
                        };
                        let message: Value = serde_json::from_str(text.as_str()).unwrap();
                        if message["method"] == "command" {
                            let params = &message["params"];
                            let hang = task_hang.lock().unwrap().clone();
                            if hang.is_some() && hang.as_deref() == params["args"]["script"].as_str() {
                                task_model.lock().unwrap().commands.push(params.clone());
                                continue;
                            }
                            let answer = task_model.lock().unwrap().command(params);
                            let reply = match answer {
                                Ok(text) => json!({ "id": message["id"], "result": { "text": text } }),
                                Err((code, text)) => json!({ "id": message["id"], "error": { "code": code, "message": text } }),
                            };
                            let _ = replies.send(reply);
                        }
                        if received.send(message).is_err() {
                            return;
                        }
                    }
                }
            }
        });
        Ok(Page { outgoing, incoming, received: Vec::new(), next_id: 1, model, hang, task })
    }

    /// Give the page sessions, each starts with the scripts q1 and notes
    pub async fn announce(&mut self, sessions: &[&str], focused: Option<&str>) {
        {
            let mut model = self.model.lock().unwrap();
            for session in sessions {
                let scripts = model.scripts.entry(session.to_string()).or_default();
                scripts.entry("q1".into()).or_insert("-- How many orders are there?\n".into());
                scripts.entry("notes".into()).or_insert("select 1;\n".into());
            }
        }
        let sessions: Vec<Value> = sessions.iter().map(|id| json!({ "id": id, "name": format!("Session {id}") })).collect();
        self.call("client/sessions", json!({ "protocol": 1, "client": "web", "sessions": sessions, "focused": focused }))
            .await
            .unwrap();
    }

    /// Send a request to the server, its result or its error
    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, Value> {
        let id = format!("p{}", self.next_id);
        self.next_id += 1;
        self.outgoing.send(json!({ "id": id, "method": method, "params": params })).unwrap();
        let reply = self.next(|m| m["id"] == id.as_str() && m["method"].is_null(), Duration::from_secs(10)).await;
        match reply["error"].is_null() {
            true => Ok(reply["result"].clone()),
            false => Err(reply["error"].clone()),
        }
    }

    /// Wait for the next message from the server that matches, panics after the timeout
    pub async fn next(&mut self, matches: impl Fn(&Value) -> bool, timeout: Duration) -> Value {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if let Some(index) = self.received.iter().position(&matches) {
                return self.received.remove(index);
            }
            match tokio::time::timeout_at(deadline, self.incoming.recv()).await {
                Ok(Some(message)) => self.received.push(message),
                Ok(None) => panic!("the connection closed, received: {:#?}", self.received),
                Err(_) => panic!("timed out, received: {:#?}", self.received),
            }
        }
    }

    /// Wait for the end of a run: Ok with the message of agent/done, Err with the params of agent/failed
    pub async fn finished(&mut self, run_id: &Value, timeout: Duration) -> Result<String, Value> {
        let end = |m: &Value| (m["method"] == "agent/done" || m["method"] == "agent/failed") && m["params"]["runId"] == *run_id;
        let message = self.next(end, timeout).await;
        match message["method"] == "agent/done" {
            true => Ok(message["params"]["message"].as_str().unwrap_or_default().to_string()),
            false => Err(message["params"].clone()),
        }
    }

    /// The agent/status texts of a run so far
    pub fn statuses(&mut self, run_id: &Value) -> Vec<String> {
        while let Ok(message) = self.incoming.try_recv() {
            self.received.push(message);
        }
        let statuses = self.received.iter().filter(|m| m["method"] == "agent/status" && m["params"]["runId"] == *run_id);
        statuses.map(|m| m["params"]["text"].as_str().unwrap_or_default().to_string()).collect()
    }

    /// Request an agent run, the run id
    pub async fn request(&mut self, session: &str, harness: &str, prompt: &str) -> Value {
        let params = json!({ "session": session, "harness": harness, "prompt": prompt });
        let result = self.call("agent/request", params).await.expect("the request is accepted");
        result["runId"].clone()
    }

    pub async fn context(&mut self, session: &str) -> Value {
        self.call("agent/context", json!({ "session": session })).await.unwrap()
    }

    pub fn script(&self, session: &str, name: &str) -> Option<String> {
        self.model.lock().unwrap().scripts.get(session).and_then(|s| s.get(name)).cloned()
    }

    /// The commands that reached the page: (session, command, script)
    pub fn commands(&self) -> Vec<(String, String, String)> {
        let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
        let model = self.model.lock().unwrap();
        model.commands.iter().map(|c| (text(&c["session"]), text(&c["command"]), text(&c["args"]["script"]))).collect()
    }

    /// Never answer commands for this script
    pub fn hang_on(&self, script: &str) {
        *self.hang.lock().unwrap() = Some(script.to_string());
    }
}

impl Drop for Page {
    fn drop(&mut self) {
        self.task.abort();
    }
}
