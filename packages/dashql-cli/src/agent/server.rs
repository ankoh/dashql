//! The local agent server: DashQL clients connect over WebSocket, the command line tool over HTTP

use crate::agent::commands::is_workbook_command;
use crate::agent::config::{
    client_origins, create_private_dir, random_bytes, to_json_text, write_private_file, AgentConfig, HarnessChoice,
};
use crate::agent::harness::{
    build_harness_args, resolve_login_shell_path, resolve_program, spawn_harness, HarnessEvent, HarnessOutcome,
    HarnessPicks, HarnessProcess, HarnessSpawnArgs, Kill, KILL_GRACE,
};
use crate::agent::http::{self, Request};
use crate::agent::instructions::{
    claude_instructions, page_features, workbook_instructions, Page, INPUT_FOLDER, OPENCODE_CONFIG,
};
use crate::agent::protocol::{ErrorCode, RpcError, PROTOCOL_VERSION, WEBSOCKET_PATH};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Notify, OnceCell};
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Role, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_HTTP_BODY_BYTES: usize = 8 * 1024 * 1024;
const CLOSE_POLICY_VIOLATION: u16 = 1008;

pub const NOT_CONNECTED_MESSAGE: &str = "DashQL is not connected: open https://dashql.app and turn on agent access";
const DISCONNECTED_MESSAGE: &str = "DashQL disconnected during the call";
const SERVER_STOPPED_MESSAGE: &str = "The agent server stopped";
/// How long a stopping server waits for its clients to take the close frame
const CLOSE_GRACE: Duration = Duration::from_secs(1);
/// Set in the environment of harness runs
pub const AGENT_RUN_ENV: &str = "DASHQL_AGENT_RUN";
/// How long the folder of an unused workbook stays
const WORKBOOK_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// How often the server removes the folders of unused workbooks
const WORKBOOK_SWEEP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Messages and output lines are cut after this many bytes in the log
const LOG_TEXT_LIMIT: usize = 64 * 1024;

/// A text for the log, cut after LOG_TEXT_LIMIT bytes
fn clip(text: &str) -> Cow<'_, str> {
    if text.len() <= LOG_TEXT_LIMIT {
        return Cow::Borrowed(text);
    }
    let mut end = LOG_TEXT_LIMIT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    Cow::Owned(format!("{}... ({} more bytes)", &text[..end], text.len() - end))
}

/// The current time in UTC, e.g. 2026-10-29T12:34:56.789Z
fn timestamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let (days, seconds) = ((now.as_secs() / 86400) as i64, now.as_secs() % 86400);
    // The civil date of a day number, Howard Hinnant's days_from_civil inverted
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60,
        now.subsec_millis()
    )
}

/// Write a line to the log on stderr
pub fn log_line(message: &str) {
    eprintln!("[dashql] {} {message}", timestamp());
}

/// Start a harness process, replaceable in tests
pub type SpawnHarness = Arc<dyn Fn(HarnessSpawnArgs) -> HarnessProcess + Send + Sync>;
/// Resolve the PATH of harness runs, replaceable in tests
pub type ResolvePath = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Option<OsString>> + Send>> + Send + Sync>;

pub struct AgentServerOptions {
    pub config: AgentConfig,
    /// The folder of the state, ~/.dashql/agent
    pub home: PathBuf,
    /// The executable that harness runs call as `dashql`, its folder goes first on their PATH.
    /// None, or an executable with another name, leaves their PATH as it is.
    pub cli: Option<PathBuf>,
    pub spawn_harness: SpawnHarness,
    pub resolve_path: ResolvePath,
    /// The maximum size of a message
    pub max_message_bytes: usize,
    /// The interval of WebSocket keepalive pings, a client that misses one pong is dropped
    pub ping_interval: Duration,
    /// How long a call waits for a call result
    pub call_timeout: Duration,
    /// Log to stderr
    pub log: bool,
}

impl AgentServerOptions {
    pub fn new(config: AgentConfig, home: PathBuf) -> Self {
        AgentServerOptions {
            config,
            home,
            cli: None,
            spawn_harness: Arc::new(spawn_harness),
            resolve_path: Arc::new(|| Box::pin(resolve_login_shell_path()) as Pin<Box<dyn Future<Output = _> + Send>>),
            max_message_bytes: 32 * 1024 * 1024,
            ping_interval: Duration::from_secs(30),
            call_timeout: DEFAULT_CALL_TIMEOUT,
            log: false,
        }
    }
}

/// A message to a client
enum Outgoing {
    Text(String),
    Close(u16, String),
}

#[derive(Clone, Debug)]
struct ClientWorkbook {
    id: String,
    name: String,
}

/// A connected client and the workbooks it holds
struct Client {
    id: String,
    origin: String,
    kind: String,
    workbooks: Vec<ClientWorkbook>,
    focused: Option<String>,
    /// The features of the client that the guide knows (`page_features`), None until it announced its sessions.
    /// Identifiers only, the guide of the agent picks its notes for them.
    features: Option<Vec<String>>,
    /// When the client announced its focus, the most recent focus wins
    focused_at: u64,
    /// When the client announced its sessions, the most recent client holding a workbook receives its calls
    announced_at: u64,
    tx: mpsc::UnboundedSender<Outgoing>,
    /// The calls that wait for their result
    pending: HashMap<String, oneshot::Sender<Result<Value, RpcError>>>,
}

impl Client {
    fn holds(&self, workbook: &str) -> bool {
        self.workbooks.iter().any(|s| s.id == workbook)
    }

    fn send(&self, message: &Value) {
        let _ = self.tx.send(Outgoing::Text(message.to_string()));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TurnState {
    Queued,
    Running,
}

impl TurnState {
    fn name(self) -> &'static str {
        match self {
            TurnState::Queued => "queued",
            TurnState::Running => "running",
        }
    }
}

/// A turn of a workbook: a prompt that a harness works on until it answers
struct Turn {
    turn_id: String,
    workbook: String,
    harness: String,
    picks: HarnessPicks,
    prompt: String,
    state: TurnState,
    status: String,
    cancelled: bool,
    kill: Option<Kill>,
}

/// The state.json of a DashQL workbook
#[derive(Default)]
struct WorkbookState {
    /// The harness session ids by harness name
    harness_sessions: Map<String, Value>,
}

struct State {
    config: AgentConfig,
    clients: BTreeMap<u64, Client>,
    next_client: u64,
    /// The workbooks with a running call
    busy: HashSet<String>,
    /// The turns in the order of their requests, the first turn of a workbook runs, the others wait
    turns: Vec<Turn>,
    /// The deleted workbooks whose folders go once their running turns finish
    forgotten: HashSet<String>,
    /// The harness processes that did not exit yet
    harnesses: usize,
    next_call_id: u64,
    /// Orders announcements and focus changes
    clock: u64,
}

struct Shared {
    options: AgentServerOptions,
    origins: Vec<String>,
    port: u16,
    state: Mutex<State>,
    /// Notified when the workbooks of a client change
    workbooks_changed: Notify,
    path: OnceCell<Option<OsString>>,
}

/// A folder name for a workbook id
pub fn workbook_folder_name(workbook: &str) -> String {
    workbook.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

fn random_uuid() -> String {
    let mut bytes = random_bytes::<16>();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

/// The harness of a request, the default harness if it names none.
/// Clients may only pick among the configured harnesses: commands come from config.json alone, a page must never be
/// able to run a program of its choice.
fn pick_harness(config: &AgentConfig, params: &Value) -> Result<String, RpcError> {
    let harness = params["harness"].as_str().unwrap_or(&config.default_harness);
    match config.harness(harness) {
        Some(_) => Ok(harness.to_string()),
        None => Err(RpcError::new(ErrorCode::Failed, format!("unknown harness: {harness}"))),
    }
}

/// The model and the effort of a request, among the ones of its harness in config.json.
/// Like the harness, a page may only pick a value: the values become arguments of the harness.
fn pick_choices(config: &AgentConfig, harness: &str, params: &Value) -> Result<HarnessPicks, RpcError> {
    let Some(harness_config) = config.harness(harness) else {
        return Err(RpcError::new(ErrorCode::Failed, format!("unknown harness: {harness}")));
    };
    let pick = |key: &str, choice: &HarnessChoice| match &params[key] {
        Value::Null => Ok(None),
        Value::String(value) if choice.values.contains(value) => Ok(Some(value.clone())),
        Value::String(value) => Err(RpcError::new(ErrorCode::Failed, format!("unknown {key} of {harness}: {value}"))),
        _ => Err(RpcError::new(ErrorCode::Usage, format!("the {key} must be a string"))),
    };
    Ok(HarnessPicks { model: pick("model", &harness_config.model)?, effort: pick("effort", &harness_config.effort)? })
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The local agent server
pub struct AgentServer {
    shared: Arc<Shared>,
    accept: tokio::task::JoinHandle<()>,
    sweep: tokio::task::JoinHandle<()>,
}

impl AgentServer {
    /// Listen on 127.0.0.1
    pub async fn listen(options: AgentServerOptions) -> std::io::Result<AgentServer> {
        let listener = TcpListener::bind(("127.0.0.1", options.config.port)).await?;
        let port = listener.local_addr()?.port();
        let mut origins: Vec<String> = client_origins().into_iter().map(str::to_string).collect();
        origins.extend(options.config.origins.iter().cloned());
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                config: options.config.clone(),
                clients: BTreeMap::new(),
                next_client: 0,
                busy: HashSet::new(),
                turns: Vec::new(),
                forgotten: HashSet::new(),
                harnesses: 0,
                next_call_id: 1,
                clock: 0,
            }),
            options,
            origins,
            port,
            workbooks_changed: Notify::new(),
            path: OnceCell::new(),
        });
        shared.log(&format!("Listening on 127.0.0.1:{port}"));
        let accept = tokio::spawn({
            let shared = shared.clone();
            async move {
                loop {
                    match listener.accept().await {
                        Ok((stream, _)) => {
                            tokio::spawn(handle_connection(shared.clone(), stream));
                        }
                        Err(e) => shared.log(&format!("Cannot accept a connection: {e}")),
                    }
                }
            }
        });
        // The folders of unused workbooks go at the start and then once a day
        shared.sweep_workbooks();
        let sweep = tokio::spawn({
            let shared = shared.clone();
            async move {
                let start = tokio::time::Instant::now() + WORKBOOK_SWEEP_INTERVAL;
                let mut interval = tokio::time::interval_at(start, WORKBOOK_SWEEP_INTERVAL);
                loop {
                    interval.tick().await;
                    shared.sweep_workbooks();
                }
            }
        });
        Ok(AgentServer { shared, accept, sweep })
    }

    /// The port the server listens on
    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.shared.port
    }

    /// The state of the server
    #[cfg(test)]
    pub fn status(&self) -> Value {
        self.shared.status(&self.shared.lock())
    }

    /// Remove the folders of unused workbooks now
    #[cfg(test)]
    pub fn sweep_workbooks(&self) {
        self.shared.sweep_workbooks();
    }

    /// Stop listening, fail the turns and kill their harnesses, disconnect the clients.
    /// Returns once the harness processes exited, the runtime would otherwise drop them while they run.
    pub async fn close(self) {
        self.accept.abort();
        self.sweep.abort();
        {
            let mut state = self.shared.lock();
            let state = &mut *state;
            self.shared.log(&format!(
                "Stopping: failing {} turns, closing {} clients",
                state.turns.len(),
                state.clients.len()
            ));
            for turn in state.turns.drain(..) {
                notify_failed(&state.clients, &turn, SERVER_STOPPED_MESSAGE, false);
                if let Some(kill) = &turn.kill {
                    kill();
                }
            }
            for client in state.clients.values() {
                let _ = client.tx.send(Outgoing::Close(1001, "server stops".into()));
            }
        }
        // A killed harness exits within KILL_GRACE, then it is killed for good
        let harnesses_deadline = tokio::time::Instant::now() + KILL_GRACE + CLOSE_GRACE;
        let clients_deadline = tokio::time::Instant::now() + CLOSE_GRACE;
        loop {
            let now = tokio::time::Instant::now();
            let (harnesses, clients) = {
                let state = self.shared.lock();
                (state.harnesses, state.clients.len())
            };
            let waits_for_harnesses = harnesses > 0 && now < harnesses_deadline;
            let waits_for_clients = clients > 0 && now < clients_deadline;
            if !waits_for_harnesses && !waits_for_clients {
                if harnesses > 0 || clients > 0 {
                    self.shared.log(&format!("Stopped with {harnesses} harnesses and {clients} clients left"));
                }
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn log(&self, message: &str) {
        if self.options.log {
            log_line(message);
        }
    }

    fn status(&self, state: &State) -> Value {
        json!({
            "port": self.port,
            "clients": state.clients.values().map(|client| json!({
                "id": client.id,
                "kind": client.kind,
                "origin": client.origin,
                "workbooks": client.workbooks.iter().map(|s| json!({ "id": s.id, "name": s.name })).collect::<Vec<_>>(),
                "focused": client.focused,
                "features": client.features,
            })).collect::<Vec<_>>(),
            "turns": state.turns.iter().map(|turn| json!({
                "turnId": turn.turn_id,
                "workbook": turn.workbook,
                "harness": turn.harness,
                "model": turn.picks.model,
                "effort": turn.picks.effort,
                "state": turn.state.name(),
                "status": turn.status,
            })).collect::<Vec<_>>(),
        })
    }

    async fn resolved_path(&self) -> Option<OsString> {
        self.path.get_or_init(|| (self.options.resolve_path)()).await.clone()
    }

    fn host_allowed(&self, host: Option<&str>) -> bool {
        host == Some(&format!("127.0.0.1:{}", self.port)) || host == Some(&format!("localhost:{}", self.port))
    }

    fn token_valid(&self, request: &Request) -> bool {
        let expected = format!("Bearer {}", self.options.config.token);
        constant_time_eq(request.header("authorization").unwrap_or_default().as_bytes(), expected.as_bytes())
    }
}

/// Send a notification to every client that holds a workbook
fn notify_workbook(clients: &BTreeMap<u64, Client>, workbook: &str, method: &str, params: Value) {
    let message = json!({ "method": method, "params": params });
    for client in clients.values().filter(|c| c.holds(workbook)) {
        client.send(&message);
    }
}

fn notify_status(clients: &BTreeMap<u64, Client>, turn: &Turn) {
    let params = json!({ "workbook": turn.workbook, "turnId": turn.turn_id, "state": turn.state.name(), "text": turn.status });
    notify_workbook(clients, &turn.workbook, "agent/status", params);
}

fn notify_failed(clients: &BTreeMap<u64, Client>, turn: &Turn, error: &str, cancelled: bool) {
    let params = json!({ "workbook": turn.workbook, "turnId": turn.turn_id, "error": error, "cancelled": cancelled });
    notify_workbook(clients, &turn.workbook, "agent/failed", params);
}

impl Shared {
    // ------------------------------------------------------------------------------------------------
    // Calls of the command line tool

    /// Run a command of the command line tool against a workbook
    async fn call(&self, call: &Value) -> Value {
        let Some(command) = call["command"].as_str().filter(|c| is_workbook_command(c)) else {
            let command = call["command"].as_str().map_or_else(|| call["command"].to_string(), str::to_string);
            return RpcError::new(ErrorCode::Usage, format!("unknown command: {command}")).to_call_response();
        };
        let workbook = match &call["workbook"] {
            Value::Null => None,
            Value::String(s) => Some(s.as_str()),
            _ => return RpcError::new(ErrorCode::Usage, "the workbook must be a string").to_call_response(),
        };
        let Some((client, workbook)) = self.wait_for_workbook(workbook).await else {
            let target = workbook.map_or_else(|| "a focused workbook".into(), |s| format!("workbook {s}"));
            self.log(&format!("Call {command}: no client holds {target}"));
            return RpcError::new(ErrorCode::NotConnected, NOT_CONNECTED_MESSAGE).to_call_response();
        };
        self.log(&format!("Call {command}: forwarding to client {client} for workbook {workbook}"));
        if !self.lock().busy.insert(workbook.clone()) {
            self.log(&format!("Call {command}: workbook {workbook} is busy with another call"));
            let message = "Another dashql agent call of this workbook is running, wait for it to finish";
            return RpcError::new(ErrorCode::Busy, message).to_call_response();
        }
        let args = if call["args"].is_null() { json!({}) } else { call["args"].clone() };
        let params = json!({ "workbook": workbook, "command": command, "args": args });
        let result = self.request(client, "command", params).await;
        self.lock().busy.remove(&workbook);
        match result {
            Ok(result) => json!({ "ok": true, "workbook": workbook, "result": result }),
            Err(error) => error.to_call_response(),
        }
    }

    /// The client that holds a workbook or the focused workbook, the most recent announcement or focus wins
    fn resolve(state: &State, workbook: Option<&str>) -> Option<(u64, String)> {
        match workbook {
            None => state
                .clients
                .iter()
                .filter_map(|(key, c)| c.focused.as_ref().map(|f| (c.focused_at, *key, f)))
                .max_by_key(|(at, _, _)| *at)
                .map(|(_, key, focused)| (key, focused.clone())),
            Some(workbook) => state
                .clients
                .iter()
                .filter(|(_, c)| c.holds(workbook))
                .max_by_key(|(_, c)| c.announced_at)
                .map(|(key, _)| (*key, workbook.to_string())),
        }
    }

    /// Wait until a client holds the workbook, queued calls are delivered once a tab reconnects
    async fn wait_for_workbook(&self, workbook: Option<&str>) -> Option<(u64, String)> {
        let wait = self.lock().config.call_wait;
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            let changed = self.workbooks_changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let target = Self::resolve(&self.lock(), workbook);
            if target.is_some() {
                return target;
            }
            if wait.is_zero() {
                return None;
            }
            let target = workbook.map_or_else(|| "a focused workbook".into(), |s| format!("workbook {s}"));
            self.log(&format!("Waiting up to {}ms for a client that holds {target}", wait.as_millis()));
            if tokio::time::timeout_at(deadline, changed).await.is_err() {
                return None;
            }
        }
    }

    async fn request(&self, client: u64, method: &str, params: Value) -> Result<Value, RpcError> {
        let disconnected = || RpcError::new(ErrorCode::Failed, DISCONNECTED_MESSAGE);
        let (tx, rx) = oneshot::channel();
        let id = {
            let mut state = self.lock();
            let id = format!("s{}", state.next_call_id);
            state.next_call_id += 1;
            let client = state.clients.get_mut(&client).ok_or_else(disconnected)?;
            client.pending.insert(id.clone(), tx);
            client.send(&json!({ "id": id, "method": method, "params": params }));
            id
        };
        match tokio::time::timeout(self.options.call_timeout, rx).await {
            Ok(Ok(result)) => result,
            // The client is gone with its pending calls
            Ok(Err(_)) => {
                self.log(&format!("Client {client} disconnected before it answered {id}"));
                Err(disconnected())
            }
            Err(_) => {
                self.log(&format!(
                    "Client {client} did not answer {id} within {}s",
                    self.options.call_timeout.as_secs()
                ));
                if let Some(client) = self.lock().clients.get_mut(&client) {
                    client.pending.remove(&id);
                }
                Err(RpcError::new(ErrorCode::Failed, "DashQL did not answer in time"))
            }
        }
    }

    // ------------------------------------------------------------------------------------------------
    // Messages of clients

    fn send_to(&self, client: u64, message: Value) {
        if let Some(client) = self.lock().clients.get(&client) {
            client.send(&message);
        }
    }

    fn close_client(&self, client: u64, code: u16, reason: String) {
        if let Some(client) = self.lock().clients.get(&client) {
            let _ = client.tx.send(Outgoing::Close(code, reason));
        }
    }

    fn handle_message(self: &Arc<Self>, client: u64, text: &str) {
        let message = match serde_json::from_str::<Value>(text) {
            Ok(message) => message,
            Err(e) => {
                self.log(&format!("Client {client} sent invalid JSON, closing it: {e}"));
                self.close_client(client, CLOSE_POLICY_VIOLATION, "invalid JSON".into());
                return;
            }
        };
        let id = message.get("id").filter(|id| !id.is_null()).cloned();
        let Some(method) = message["method"].as_str() else {
            // A response to a command
            let id = id.map(|id| id.as_str().map_or_else(|| id.to_string(), str::to_string)).unwrap_or_default();
            let mut state = self.lock();
            let Some(pending) = state.clients.get_mut(&client).and_then(|c| c.pending.remove(&id)) else {
                self.log(&format!("Client {client} answered {id}, no call waits for it"));
                return;
            };
            let _ = pending.send(match &message["error"] {
                Value::Null => Ok(message["result"].clone()),
                error => Err(RpcError::from_json(error)),
            });
            return;
        };
        let reply = |result: Result<Value, RpcError>| {
            if let Some(id) = &id {
                match result {
                    Ok(result) => self.send_to(client, json!({ "id": id, "result": result })),
                    Err(error) => self.send_to(client, json!({ "id": id, "error": error.to_json() })),
                }
            }
        };
        let params = &message["params"];
        let workbook = || {
            params["workbook"]
                .as_str()
                .map(str::to_string)
                .ok_or(RpcError::new(ErrorCode::Usage, "the workbook must be a string"))
        };
        match method {
            "client/workbooks" => {
                if self.update_workbooks(client, params) {
                    reply(Ok(json!({})));
                }
            }
            "agent/request" => match self.enqueue_turn(client, params) {
                Ok((result, turn_id)) => {
                    // The response goes out before the first notification
                    reply(Ok(result));
                    tokio::spawn(start_or_queue(self.clone(), turn_id));
                }
                Err(error) => reply(Err(error)),
            },
            "agent/cancel" => reply(workbook().and_then(|workbook| {
                let turn_id = match params.get("turnId") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(turn_id)) => Some(turn_id.as_str()),
                    Some(_) => return Err(RpcError::new(ErrorCode::Usage, "the turn id must be a string")),
                };
                self.cancel_turns(&workbook, turn_id);
                Ok(json!({}))
            })),
            "agent/forget" => reply(workbook().and_then(|workbook| {
                self.forget_workbook(&workbook).map_err(|e| RpcError::new(ErrorCode::Failed, e))?;
                Ok(json!({}))
            })),
            "agent/reset" => reply(workbook().and_then(|workbook| {
                self.log(&format!("Forgetting the harness sessions of workbook {workbook}"));
                let state = WorkbookState::default();
                self.write_workbook_state(&workbook, &state).map_err(|e| RpcError::new(ErrorCode::Failed, e))?;
                Ok(json!({}))
            })),
            "agent/context" => reply(workbook().and_then(|workbook| self.workbook_context(&workbook, params))),
            "agent/info" => {
                let (shared, id) = (self.clone(), id.clone());
                tokio::spawn(async move {
                    let info = shared.info().await;
                    if let Some(id) = id {
                        shared.send_to(client, json!({ "id": id, "result": info }));
                    }
                });
            }
            _ => reply(Err(RpcError::new(ErrorCode::Usage, format!("unknown method: {method}")))),
        }
    }

    /// Take the workbooks of a client, false if the client was turned away
    fn update_workbooks(&self, client: u64, params: &Value) -> bool {
        if params["protocol"].as_u64() != Some(PROTOCOL_VERSION) {
            let reason =
                format!("protocol version {} is not supported, expected {PROTOCOL_VERSION}", params["protocol"]);
            self.log(&format!("Turning client {client} away: {reason}"));
            self.close_client(client, CLOSE_POLICY_VIOLATION, reason);
            return false;
        }
        {
            let mut state = self.lock();
            state.clock += 1;
            let now = state.clock;
            let Some(client) = state.clients.get_mut(&client) else { return false };
            client.kind = params["client"].as_str().unwrap_or("unknown").to_string();
            client.features =
                Some(page_features(params["features"].as_array().map(|f| f.iter().filter_map(Value::as_str))));
            client.workbooks.clear();
            for workbook in params["workbooks"].as_array().into_iter().flatten() {
                let Some(id) = workbook["id"].as_str() else { continue };
                let name = workbook["name"].as_str().unwrap_or_default().to_string();
                match client.workbooks.iter_mut().find(|s| s.id == id) {
                    Some(existing) => existing.name = name,
                    None => client.workbooks.push(ClientWorkbook { id: id.to_string(), name }),
                }
            }
            client.announced_at = now;
            let focused = params["focused"].as_str().filter(|f| client.holds(f)).map(str::to_string);
            if focused != client.focused {
                client.focused_at = now;
            }
            client.focused = focused;
        }
        // A workbook that a client shows is in use, its folder stays
        for workbook in params["workbooks"].as_array().into_iter().flatten().filter_map(|s| s["id"].as_str()) {
            if self.workbook_dir(workbook).is_dir() {
                self.mark_workbook_used(workbook);
            }
        }
        self.workbooks_changed.notify_waiters();
        true
    }

    /// The configuration and the state of the server, for the settings of the app.
    /// Shows the harness commands, they are changed in config.json only.
    async fn info(&self) -> Value {
        let path = self.resolved_path().await;
        let state = self.lock();
        let mut info = self.status(&state);
        let harnesses: Vec<Value> = state
            .config
            .harnesses
            .iter()
            .map(|(name, harness)| {
                let program = resolve_program(&harness.command[0], path.as_deref());
                json!({
                    "name": name,
                    "command": harness.command,
                    "adapter": harness.adapter.name(),
                    "program": program.map(|p| p.display().to_string()),
                    "models": harness.model.values,
                    "efforts": harness.effort.values,
                })
            })
            .collect();
        let extra = json!({
            "home": self.options.home.display().to_string(),
            "configPath": self.options.home.join("config.json").display().to_string(),
            "defaultHarness": state.config.default_harness,
            "harnesses": harnesses,
        });
        if let (Some(info), Value::Object(extra)) = (info.as_object_mut(), extra) {
            info.extend(extra);
        }
        info
    }

    // ------------------------------------------------------------------------------------------------
    // Turns

    fn workbook_dir(&self, workbook: &str) -> PathBuf {
        self.options.home.join("workbooks").join(workbook_folder_name(workbook))
    }

    fn read_workbook_state(&self, workbook: &str) -> WorkbookState {
        let text = std::fs::read_to_string(self.workbook_dir(workbook).join("state.json")).unwrap_or_default();
        let Ok(Value::Object(mut state)) = serde_json::from_str::<Value>(&text) else { return WorkbookState::default() };
        WorkbookState {
            harness_sessions: match state.remove("harnessSessions") {
                Some(Value::Object(workbooks)) => workbooks,
                _ => Map::new(),
            },
        }
    }

    fn write_workbook_state(&self, workbook: &str, workbook_state: &WorkbookState) -> Result<(), String> {
        let dir = self.workbook_dir(workbook);
        create_private_dir(&dir)?;
        let state = json!({ "harnessSessions": workbook_state.harness_sessions });
        write_private_file(&dir.join("state.json"), &(to_json_text(&state) + "\n"))
    }

    /// Mark a workbook as used: the time of its state.json is the last use, the sweep keeps the folders of used
    /// workbooks
    fn mark_workbook_used(&self, workbook: &str) {
        let path = self.workbook_dir(workbook).join("state.json");
        let marked = match std::fs::File::options().write(true).open(&path) {
            Ok(file) => file.set_modified(SystemTime::now()).map_err(|e| e.to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                self.write_workbook_state(workbook, &WorkbookState::default())
            }
            Err(e) => Err(e.to_string()),
        };
        if let Err(e) = marked {
            self.log(&format!("Cannot mark workbook {workbook} as used: {e}"));
        }
    }

    /// Remove the folder of a workbook
    fn remove_workbook_dir(&self, workbook: &str) -> Result<(), String> {
        let dir = self.workbook_dir(workbook);
        match std::fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{}: {e}", dir.display())),
            _ => Ok(()),
        }
    }

    /// Forget a deleted workbook: stop its turns and remove its folder, once a running turn finished
    fn forget_workbook(self: &Arc<Self>, workbook: &str) -> Result<(), String> {
        // An empty workbook id would name the folder of all workbooks
        if workbook_folder_name(workbook).is_empty() {
            return Err("the workbook is empty".into());
        }
        self.cancel_turns(workbook, None);
        let mut state = self.lock();
        if state.turns.iter().any(|turn| turn.workbook == workbook) {
            self.log(&format!("Forgetting workbook {workbook} once its running turn stopped"));
            state.forgotten.insert(workbook.to_string());
            return Ok(());
        }
        self.log(&format!("Forgetting workbook {workbook}"));
        self.remove_workbook_dir(workbook)
    }

    /// Remove the folders of the workbooks that were not used within the retention.
    /// A client may hold workbooks that no other client knows, so only the age tells that a folder is no longer needed.
    fn sweep_workbooks(&self) {
        let root = self.options.home.join("workbooks");
        // Workbooks were called sessions, the folders of older versions move once
        let legacy = self.options.home.join("sessions");
        if legacy.is_dir() && !root.exists() {
            if let Err(error) = std::fs::rename(&legacy, &root) {
                self.log(&format!("Could not move {} to {}: {error}", legacy.display(), root.display()));
            }
        }
        let Ok(entries) = std::fs::read_dir(&root) else { return };
        // The lock keeps new turns from starting in a folder while it is removed
        let state = self.lock();
        let in_use: HashSet<String> = state
            .turns
            .iter()
            .map(|turn| turn.workbook.as_str())
            .chain(state.busy.iter().map(String::as_str))
            .chain(state.clients.values().flat_map(|client| client.workbooks.iter().map(|s| s.id.as_str())))
            .map(workbook_folder_name)
            .collect();
        let now = SystemTime::now();
        let mut removed = 0;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if in_use.contains(&name) || !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            // A folder without state.json is as old as the folder itself, an unknown time keeps it
            let dir = entry.path();
            let used = std::fs::metadata(dir.join("state.json")).or_else(|_| std::fs::metadata(&dir));
            let Ok(used) = used.and_then(|m| m.modified()) else { continue };
            if now.duration_since(used).unwrap_or_default() < WORKBOOK_RETENTION {
                continue;
            }
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => removed += 1,
                Err(e) => self.log(&format!("Cannot remove the folder of an unused workbook {}: {e}", dir.display())),
            }
        }
        drop(state);
        if removed > 0 {
            let days = WORKBOOK_RETENTION.as_secs() / 86400;
            self.log(&format!("Removed the folders of {removed} workbooks unused for {days} days"));
        }
    }

    fn workbook_context(&self, workbook: &str, params: &Value) -> Result<Value, RpcError> {
        let state = self.lock();
        let harness = pick_harness(&state.config, params)?;
        let workbook_state = self.read_workbook_state(workbook);
        let harness_session = workbook_state.harness_sessions.get(&harness).and_then(Value::as_str).map(str::to_string);
        let template = state.config.harness(&harness).and_then(|h| h.terminal_command.as_ref());
        let terminal_command = match (&harness_session, template) {
            (Some(id), Some(template)) => {
                Some(template.iter().map(|arg| arg.replace("{harnessSession}", id)).collect::<Vec<_>>())
            }
            _ => None,
        };
        Ok(json!({
            "folder": self.workbook_dir(workbook).display().to_string(),
            "harness": harness,
            "harnessSession": harness_session,
            "terminalCommand": terminal_command,
        }))
    }

    fn enqueue_turn(&self, client: u64, params: &Value) -> Result<(Value, String), RpcError> {
        let mut state = self.lock();
        let workbook = params["workbook"].as_str().unwrap_or_default();
        if !state.clients.get(&client).is_some_and(|c| c.holds(workbook)) {
            return Err(RpcError::new(ErrorCode::Usage, "the workbook has no agent access"));
        }
        let harness = pick_harness(&state.config, params)?;
        let picks = pick_choices(&state.config, &harness, params)?;
        let prompt = params["prompt"].as_str().unwrap_or_default();
        if prompt.trim().is_empty() {
            return Err(RpcError::new(ErrorCode::Failed, "the prompt is empty"));
        }
        // A new turn keeps the folder of a workbook that was forgotten while a turn ran
        state.forgotten.remove(workbook);
        let turn_id = random_uuid();
        let ahead = state.turns.iter().filter(|turn| turn.workbook == workbook).count();
        self.log(&format!(
            "Turn {turn_id}: queued for workbook {workbook} with {harness} (model {}, effort {}), {ahead} turns ahead, prompt: {}",
            picks.model.as_deref().unwrap_or("default"),
            picks.effort.as_deref().unwrap_or("default"),
            clip(prompt)
        ));
        state.turns.push(Turn {
            turn_id: turn_id.clone(),
            workbook: workbook.to_string(),
            harness: harness.clone(),
            picks,
            prompt: prompt.to_string(),
            state: TurnState::Queued,
            status: "waiting for agent...".into(),
            cancelled: false,
            kill: None,
        });
        Ok((json!({ "turnId": turn_id, "harness": harness }), turn_id))
    }

    /// Stop a turn of a workbook, or all turns of the workbook without a turn id
    fn cancel_turns(self: &Arc<Self>, workbook: &str, turn_id: Option<&str>) {
        let mut state = self.lock();
        let state = &mut *state;
        let stops = |turn: &Turn| turn.workbook == workbook && turn_id.is_none_or(|id| turn.turn_id == id);
        let stopped = state.turns.iter().filter(|turn| stops(turn)).count();
        self.log(&format!("Stopping {stopped} turns of workbook {workbook} (turn {})", turn_id.unwrap_or("all")));
        for turn in state.turns.iter_mut().filter(|turn| stops(turn)) {
            self.log(&format!("Turn {}: stopped while {}", turn.turn_id, turn.state.name()));
            turn.cancelled = true;
            match (turn.state, &turn.kill) {
                (TurnState::Queued, _) => notify_failed(&state.clients, turn, "Stopped", true),
                (TurnState::Running, Some(kill)) => kill(),
                // The turn checks whether it was cancelled before it starts the harness
                (TurnState::Running, None) => {}
            }
        }
        state.turns.retain(|turn| !stops(turn) || turn.state == TurnState::Running);
        // The first turn of the workbook may have been dropped before it started
        let next = state.turns.iter().find(|turn| turn.workbook == workbook);
        if let Some(next) = next.filter(|turn| turn.state == TurnState::Queued) {
            tokio::spawn(start_turn(self.clone(), next.turn_id.clone()));
        }
    }

    /// The folder of the dashql executable, first on the PATH of harness runs so the agent calls this binary.
    /// Only a binary named dashql: the folder of another one would not give the agent a `dashql` command.
    fn cli_folder(&self) -> Option<PathBuf> {
        let cli = std::fs::canonicalize(self.options.cli.as_ref()?).ok()?;
        if cli.file_stem()? != "dashql" {
            return None;
        }
        cli.parent().map(Path::to_path_buf)
    }

    /// Prepare the working folder and start the harness, the outcome once the harness exited
    async fn run_harness(self: &Arc<Self>, turn_id: &str) -> Result<HarnessOutcome, String> {
        let (workbook, config, prompt, picks) = {
            let state = self.lock();
            let Some(turn) = state.turns.iter().find(|turn| turn.turn_id == turn_id) else {
                return Ok(HarnessOutcome::failed("Stopped"));
            };
            let config =
                state.config.harness(&turn.harness).cloned().ok_or(format!("unknown harness: {}", turn.harness))?;
            (turn.workbook.clone(), config, turn.prompt.clone(), turn.picks.clone())
        };
        let cwd = self.workbook_dir(&workbook);
        create_private_dir(&cwd)?;
        self.mark_workbook_used(&workbook);
        // The guide describes the features of the page that holds the workbook
        let features = {
            let state = self.lock();
            Self::resolve(&state, Some(&workbook))
                .and_then(|(client, _)| state.clients.get(&client).and_then(|c| c.features.clone()))
                .unwrap_or_default()
        };
        let page = Page::Features(&features);
        for (name, text) in [
            ("AGENTS.md", workbook_instructions(page)),
            ("CLAUDE.md", claude_instructions(page)),
            ("opencode.json", OPENCODE_CONFIG.to_string()),
        ] {
            let path = cwd.join(name);
            write_if_changed(&path, &text).map_err(|e| format!("{}: {e}", path.display()))?;
        }
        // The files of an earlier turn may hold older script texts
        let input = cwd.join(INPUT_FOLDER);
        match std::fs::remove_dir_all(&input) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("{}: {e}", input.display())),
            _ => create_private_dir(&input)?,
        }
        let path = self.resolved_path().await;
        let mut env: BTreeMap<OsString, OsString> = std::env::vars_os().collect();
        let paths = self.cli_folder().into_iter().chain(path.iter().flat_map(|p| std::env::split_paths(p)));
        env.insert("PATH".into(), std::env::join_paths(paths).map_err(|e| e.to_string())?);
        env.insert("DASHQL_WORKBOOK".into(), workbook.clone().into());
        env.insert("DASHQL_AGENT_HOME".into(), self.options.home.clone().into());
        env.insert("DASHQL_AGENT_PORT".into(), self.port.to_string().into());
        // `dashql agent serve` refuses to start inside a run
        env.insert(AGENT_RUN_ENV.into(), "1".into());

        let harness_name = {
            let state = self.lock();
            match state.turns.iter().find(|turn| turn.turn_id == turn_id) {
                Some(turn) if !turn.cancelled => turn.harness.clone(),
                _ => return Ok(HarnessOutcome::failed("Stopped")),
            }
        };
        let harness_session =
            self.read_workbook_state(&workbook).harness_sessions.get(&harness_name).and_then(Value::as_str).map(str::to_string);
        let argv = build_harness_args(&config, &prompt, harness_session.as_deref(), &picks);
        self.log(&format!(
            "Turn {turn_id}: starting {harness_name} for workbook {workbook} in {}, {}, command: {}",
            cwd.display(),
            harness_session
                .as_ref()
                .map_or_else(|| "new harness session".into(), |id| format!("resuming harness session {id}")),
            clip(&serde_json::to_string(&argv).unwrap_or_default())
        ));
        self.log(&format!("Turn {turn_id}: PATH={}", env[&OsString::from("PATH")].to_string_lossy()));
        let (events, mut received) = mpsc::unbounded_channel();
        let process =
            (self.options.spawn_harness)(HarnessSpawnArgs { config, prompt, harness_session, picks, cwd, env, events });
        {
            let mut state = self.lock();
            state.harnesses += 1;
            match state.turns.iter_mut().find(|turn| turn.turn_id == turn_id) {
                Some(turn) => {
                    // A cancel that came while the harness started
                    if turn.cancelled {
                        (process.kill)();
                    }
                    turn.kill = Some(process.kill.clone());
                }
                // The server stopped while the harness started
                None => (process.kill)(),
            }
        }
        let mut outcome = process.outcome;
        loop {
            tokio::select! {
                Some(event) = received.recv() => self.handle_event(turn_id, &workbook, &harness_name, event),
                outcome = &mut outcome => {
                    self.lock().harnesses -= 1;
                    while let Ok(event) = received.try_recv() {
                        self.handle_event(turn_id, &workbook, &harness_name, event);
                    }
                    return Ok(outcome);
                }
            }
        }
    }

    fn handle_event(&self, turn_id: &str, workbook: &str, harness: &str, event: HarnessEvent) {
        match event {
            HarnessEvent::Stdout(line) => self.log(&format!("Turn {turn_id}: {harness} stdout: {}", clip(&line))),
            HarnessEvent::Stderr(line) => self.log(&format!("Turn {turn_id}: {harness} stderr: {}", clip(&line))),
            HarnessEvent::Process(text) => self.log(&format!("Turn {turn_id}: {harness}: {text}")),
            HarnessEvent::Status(text) => {
                let mut state = self.lock();
                let state = &mut *state;
                let Some(turn) = state.turns.iter_mut().find(|turn| turn.turn_id == turn_id) else { return };
                if text.is_empty() || turn.cancelled {
                    return;
                }
                turn.status = text;
                notify_status(&state.clients, turn);
            }
            HarnessEvent::Session(id) => {
                if self.lock().forgotten.contains(workbook) {
                    return;
                }
                let mut state = self.read_workbook_state(workbook);
                if state.harness_sessions.get(harness).and_then(Value::as_str) == Some(&id) {
                    return;
                }
                self.log(&format!("Turn {turn_id}: {harness} runs in harness session {id}"));
                state.harness_sessions.insert(harness.to_string(), id.into());
                if let Err(e) = self.write_workbook_state(workbook, &state) {
                    self.log(&format!("Cannot store the harness session: {e}"));
                }
            }
        }
    }

    fn finish_turn(self: &Arc<Self>, turn_id: &str, outcome: HarnessOutcome) {
        let mut state = self.lock();
        let Some(index) = state.turns.iter().position(|turn| turn.turn_id == turn_id) else { return };
        let turn = state.turns.remove(index);
        if turn.cancelled {
            self.log(&format!("Turn {turn_id}: stopped"));
            notify_failed(&state.clients, &turn, "Stopped", true);
        } else if let Some(error) = &outcome.error {
            self.log(&format!("Turn {turn_id}: {} failed for workbook {}: {error}", turn.harness, turn.workbook));
            notify_failed(&state.clients, &turn, error, false);
        } else {
            self.log(&format!(
                "Turn {turn_id}: {} answered for workbook {}: {}",
                turn.harness,
                turn.workbook,
                clip(&outcome.message)
            ));
            let params = json!({ "workbook": turn.workbook, "turnId": turn.turn_id, "message": outcome.message });
            notify_workbook(&state.clients, &turn.workbook, "agent/done", params);
        }
        let next = state.turns.iter().find(|next| next.workbook == turn.workbook);
        if let Some(next) = next.filter(|next| next.state == TurnState::Queued) {
            tokio::spawn(start_turn(self.clone(), next.turn_id.clone()));
        } else if next.is_none() && state.forgotten.remove(&turn.workbook) {
            self.log(&format!("Forgetting workbook {}", turn.workbook));
            if let Err(e) = self.remove_workbook_dir(&turn.workbook) {
                self.log(&format!("Cannot remove the folder of workbook {}: {e}", turn.workbook));
            }
        }
    }
}

/// Start a new turn if it is the first of its session, otherwise report that it waits
async fn start_or_queue(shared: Arc<Shared>, turn_id: String) {
    {
        let state = shared.lock();
        let Some(turn) = state.turns.iter().find(|turn| turn.turn_id == turn_id) else { return };
        if turn.cancelled {
            return;
        }
        if state.turns.iter().find(|first| first.workbook == turn.workbook).map(|first| &first.turn_id) != Some(&turn_id) {
            shared.log(&format!("Turn {turn_id}: waits for an earlier turn of workbook {}", turn.workbook));
            notify_status(&state.clients, turn);
            return;
        }
    }
    start_turn(shared, turn_id).await;
}

async fn start_turn(shared: Arc<Shared>, turn_id: String) {
    {
        let mut state = shared.lock();
        let state = &mut *state;
        let Some(turn) = state.turns.iter_mut().find(|turn| turn.turn_id == turn_id) else { return };
        if turn.state != TurnState::Queued || turn.cancelled {
            return;
        }
        turn.state = TurnState::Running;
        turn.status = "starting the agent...".into();
        shared.log(&format!("Turn {turn_id}: running"));
        notify_status(&state.clients, turn);
    }
    let outcome = shared.run_harness(&turn_id).await.unwrap_or_else(|e| {
        shared.log(&format!("Turn {turn_id}: cannot start the harness: {e}"));
        HarnessOutcome::failed(e)
    });
    shared.finish_turn(&turn_id, outcome);
}

fn write_if_changed(path: &Path, text: &str) -> std::io::Result<()> {
    if std::fs::read_to_string(path).is_ok_and(|current| current == text) {
        return Ok(());
    }
    std::fs::write(path, text)
}

// ------------------------------------------------------------------------------------------------
// Connections

async fn handle_connection(shared: Arc<Shared>, mut stream: TcpStream) {
    let Ok(Some(request)) = http::read_request(&mut stream).await else { return };
    if request.header("upgrade").is_some() {
        handle_upgrade(shared, stream, request).await;
    } else {
        handle_http(shared, stream, request).await;
    }
}

async fn respond(stream: &mut TcpStream, status: u16, reason: &str, body: &Value) {
    let response = http::response(status, reason, Some("application/json"), body.to_string().as_bytes());
    let _ = stream.write_all(&response).await;
    let _ = stream.shutdown().await;
}

async fn handle_http(shared: Arc<Shared>, mut stream: TcpStream, request: Request) {
    let failure = |code, message: &str| RpcError::new(code, message).to_call_response();
    let target = format!("{} {}", request.method, request.path());
    // Browsers send an Origin, the command line tool doesn't. Pages never reach the HTTP endpoints.
    if !shared.host_allowed(request.header("host")) || request.header("origin").is_some() {
        shared.log(&format!(
            "HTTP {target}: refused, host {:?}, origin {:?}",
            request.header("host"),
            request.header("origin")
        ));
        return respond(&mut stream, 403, "Forbidden", &failure(ErrorCode::Usage, "forbidden")).await;
    }
    if !shared.token_valid(&request) {
        shared.log(&format!("HTTP {target}: refused, invalid token"));
        return respond(&mut stream, 401, "Unauthorized", &failure(ErrorCode::Usage, "invalid token")).await;
    }
    match (request.method.as_str(), request.path()) {
        ("GET", "/v1/status") => {
            let status = shared.status(&shared.lock());
            respond(&mut stream, 200, "OK", &json!({ "ok": true, "status": status })).await;
        }
        ("POST", "/v1/call") => {
            let body = http::read_body(&mut stream, &request, MAX_HTTP_BODY_BYTES).await;
            if let Ok(body) = &body {
                shared.log(&format!("HTTP {target} <- {}", clip(&String::from_utf8_lossy(body))));
            }
            let call = body.and_then(|body| serde_json::from_slice::<Value>(&body).map_err(|e| e.to_string()));
            match call {
                Ok(call) => {
                    let result = shared.call(&call).await;
                    shared.log(&format!("HTTP {target} -> 200 {}", clip(&result.to_string())));
                    respond(&mut stream, 200, "OK", &result).await;
                }
                Err(e) => {
                    let body = failure(ErrorCode::Usage, &format!("invalid request: {e}"));
                    shared.log(&format!("HTTP {target} -> 400 {body}"));
                    respond(&mut stream, 400, "Bad Request", &body).await;
                }
            }
        }
        _ => {
            shared.log(&format!("HTTP {target} -> 404"));
            respond(&mut stream, 404, "Not Found", &failure(ErrorCode::Usage, "not found")).await
        }
    }
}

async fn reject_upgrade(mut stream: TcpStream, status: u16, reason: &str) {
    let _ = stream.write_all(&http::response(status, reason, None, b"")).await;
    let _ = stream.shutdown().await;
}

async fn handle_upgrade(shared: Arc<Shared>, mut stream: TcpStream, request: Request) {
    if request.path() != WEBSOCKET_PATH {
        shared.log(&format!("Refused a WebSocket upgrade for {}: not found", request.path()));
        return reject_upgrade(stream, 404, "Not Found").await;
    }
    // Other websites cannot fake the Origin, the Host check blocks DNS rebinding
    let origin = request.header("origin").unwrap_or_default().to_string();
    if !shared.host_allowed(request.header("host")) || !shared.origins.contains(&origin) {
        shared.log(&format!("Refused a client from {origin:?} for host {:?}", request.header("host")));
        return reject_upgrade(stream, 403, "Forbidden").await;
    }
    let key = request.header("sec-websocket-key");
    let upgrade = request.header("upgrade").unwrap_or_default();
    let (Some(key), "GET", true, Some("13")) = (
        key,
        request.method.as_str(),
        upgrade.eq_ignore_ascii_case("websocket"),
        request.header("sec-websocket-version"),
    ) else {
        shared.log(&format!("Refused a WebSocket upgrade from {origin:?}: invalid handshake"));
        return reject_upgrade(stream, 400, "Bad Request").await;
    };
    let accept = derive_accept_key(key.as_bytes());
    let handshake =
        format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n");
    if let Err(e) = stream.write_all(handshake.as_bytes()).await {
        shared.log(&format!("Cannot complete the WebSocket handshake with {origin:?}: {e}"));
        return;
    }
    let config = WebSocketConfig::default()
        .max_message_size(Some(shared.options.max_message_bytes))
        .max_frame_size(Some(shared.options.max_message_bytes));
    let socket = WebSocketStream::from_partially_read(stream, request.rest, Role::Server, Some(config)).await;
    serve_client(shared, socket, origin).await;
}

async fn serve_client(shared: Arc<Shared>, socket: WebSocketStream<TcpStream>, origin: String) {
    let (tx, mut outgoing) = mpsc::unbounded_channel();
    let key = {
        let mut state = shared.lock();
        let key = state.next_client;
        state.next_client += 1;
        let client = Client {
            id: random_uuid(),
            origin: origin.clone(),
            kind: "unknown".into(),
            workbooks: Vec::new(),
            focused: None,
            features: None,
            focused_at: 0,
            announced_at: 0,
            tx,
            pending: HashMap::new(),
        };
        state.clients.insert(key, client);
        key
    };
    shared.log(&format!("Client {key} connected from {origin}"));
    let (mut sink, mut incoming) = socket.split();
    let interval = shared.options.ping_interval;
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
    let mut awaiting_pong = false;
    let reason = loop {
        tokio::select! {
            message = outgoing.recv() => match message {
                Some(Outgoing::Text(text)) => {
                    shared.log(&format!("Client {key} -> {}", clip(&text)));
                    if let Err(e) = sink.send(Message::text(text)).await {
                        break format!("cannot send: {e}");
                    }
                }
                Some(Outgoing::Close(code, reason)) => {
                    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.clone().into() };
                    let _ = sink.send(Message::Close(Some(frame))).await;
                    let _ = sink.close().await;
                    break format!("closed by the server with {code}: {reason}");
                }
                None => break "the server dropped the client".into(),
            },
            message = incoming.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    shared.log(&format!("Client {key} <- {}", clip(text.as_str())));
                    shared.handle_message(key, text.as_str());
                }
                Some(Ok(Message::Pong(_))) => awaiting_pong = false,
                Some(Ok(Message::Binary(data))) => {
                    let frame = CloseFrame { code: CloseCode::Unsupported, reason: "binary messages are not supported".into() };
                    let _ = sink.send(Message::Close(Some(frame))).await;
                    break format!("sent a binary message of {} bytes", data.len());
                }
                Some(Ok(Message::Close(frame))) => {
                    // The socket acknowledges the close itself and ends the stream next
                    let frame = frame
                        .map_or_else(|| "no close frame".into(), |f| format!("{}: {}", u16::from(f.code), f.reason));
                    shared.log(&format!("Client {key} closes the connection with {frame}"));
                }
                // Pings are answered by the socket itself
                Some(Ok(_)) => {}
                Some(Err(e)) => break format!("socket error: {e}"),
                None => break "the connection ended".into(),
            },
            _ = ping.tick() => {
                if awaiting_pong {
                    break format!("no pong within {}s", interval.as_secs());
                }
                if let Err(e) = sink.send(Message::Ping(Default::default())).await {
                    break format!("cannot send a ping: {e}");
                }
                awaiting_pong = true;
            }
        }
    };
    // Dropping the client fails its pending calls
    let pending = shared.lock().clients.remove(&key).map_or(0, |client| client.pending.len());
    shared.log(&format!("Client {key} from {origin} disconnected ({reason}), failing {pending} pending calls"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::instructions::PAGE_FEATURES;
    use crate::agent::config::{load_config, temp_dir};
    use crate::agent::schema::BridgeSchema;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::io::AsyncReadExt;

    const TOKEN: &str = "test-token";

    /// A harness run of the fake harness
    struct FakeRun {
        args: HarnessSpawnArgs,
        finish: Arc<Mutex<Option<oneshot::Sender<HarnessOutcome>>>>,
        killed: Arc<AtomicBool>,
    }

    impl FakeRun {
        fn finish(&self, message: &str, error: Option<&str>) {
            if let Some(finish) = self.finish.lock().unwrap().take() {
                let _ = finish.send(HarnessOutcome { message: message.into(), error: error.map(str::to_string) });
            }
        }
    }

    struct Fixture {
        home: PathBuf,
        server: AgentServer,
        runs: Arc<Mutex<Vec<FakeRun>>>,
    }

    impl Fixture {
        async fn start(config: Value) -> Fixture {
            Fixture::start_with(config, false).await
        }

        /// A server whose harness runs start real processes
        async fn start_with_real_harness(config: Value) -> Fixture {
            Fixture::start_with(config, true).await
        }

        async fn start_with(config: Value, real_harness: bool) -> Fixture {
            let home = temp_dir("dashql-agent");
            let mut stored = json!({ "token": TOKEN, "defaultHarness": "codex", "callWaitMs": 300 });
            stored.as_object_mut().unwrap().extend(config.as_object().unwrap().clone());
            std::fs::write(home.join("config.json"), stored.to_string()).unwrap();
            let mut config = load_config(&home, &|_| None).unwrap();
            std::fs::remove_file(home.join("config.json")).unwrap();
            // Any free port
            config.port = 0;
            let runs: Arc<Mutex<Vec<FakeRun>>> = Arc::default();
            let mut options = AgentServerOptions::new(config, home.clone());
            options.resolve_path = Arc::new(|| {
                Box::pin(async { Some(OsString::from("/usr/bin")) }) as Pin<Box<dyn Future<Output = _> + Send>>
            });
            options.spawn_harness = Arc::new({
                let runs = runs.clone();
                move |args| {
                    let (finish, outcome) = oneshot::channel();
                    let finish = Arc::new(Mutex::new(Some(finish)));
                    let killed = Arc::new(AtomicBool::new(false));
                    let kill: Kill = Arc::new({
                        let (finish, killed) = (finish.clone(), killed.clone());
                        move || {
                            killed.store(true, Ordering::SeqCst);
                            if let Some(finish) = finish.lock().unwrap().take() {
                                let _ = finish.send(HarnessOutcome::failed("killed"));
                            }
                        }
                    });
                    runs.lock().unwrap().push(FakeRun { args, finish, killed });
                    HarnessProcess {
                        outcome: Box::pin(async move {
                            outcome.await.unwrap_or_else(|_| HarnessOutcome::failed("dropped"))
                        }),
                        kill,
                    }
                }
            });
            if real_harness {
                options.spawn_harness = Arc::new(spawn_harness);
            }
            let server = AgentServer::listen(options).await.unwrap();
            Fixture { home, server, runs }
        }

        fn port(&self) -> u16 {
            self.server.port()
        }

        async fn connect(&self, origin: &str) -> TestClient {
            TestClient::connect(self.port(), Some(origin), &format!("127.0.0.1:{}", self.port())).await.unwrap()
        }

        fn call(&self, body: Value) -> tokio::task::JoinHandle<(u16, Value)> {
            tokio::spawn(call(self.port(), body, vec![]))
        }

        /// Wait until the fake harness was started n times
        async fn wait_for_runs(&self, n: usize) {
            for _ in 0..200 {
                if self.runs.lock().unwrap().len() >= n {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("the harness did not start");
        }

        fn run<T>(&self, index: usize, f: impl FnOnce(&FakeRun) -> T) -> T {
            f(&self.runs.lock().unwrap()[index])
        }
    }

    /// A WebSocket client that can send any Origin and Host
    struct TestClient {
        socket: WebSocketStream<TcpStream>,
        messages: Vec<Value>,
        /// The methods of the sent requests by id, to check the responses
        requests: BTreeMap<String, String>,
    }

    impl TestClient {
        /// Connect, the HTTP status of a refused handshake
        async fn connect(port: u16, origin: Option<&str>, host: &str) -> Result<TestClient, u16> {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let origin = origin.map(|o| format!("Origin: {o}\r\n")).unwrap_or_default();
            let request = format!(
                "GET /v1/ws HTTP/1.1\r\nHost: {host}\r\n{origin}Connection: Upgrade\r\nUpgrade: websocket\r\n\
                 Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
            );
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut buffer = Vec::new();
            let mut chunk = [0; 1024];
            let length = loop {
                let n = stream.read(&mut chunk).await.unwrap();
                assert!(n > 0, "the server closed the connection");
                buffer.extend_from_slice(&chunk[..n]);
                if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let (status, _) = http::parse_response(&buffer[..length]).unwrap();
            if status != 101 {
                return Err(status);
            }
            let socket =
                WebSocketStream::from_partially_read(stream, buffer[length..].to_vec(), Role::Client, None).await;
            Ok(TestClient { socket, messages: Vec::new(), requests: BTreeMap::new() })
        }

        async fn send(&mut self, message: Value) {
            if let (Some(method), false) = (message["method"].as_str(), message["id"].is_null()) {
                self.requests.insert(message["id"].to_string(), method.to_string());
            }
            self.socket.send(Message::text(message.to_string())).await.unwrap();
        }

        /// Wait for the next message that matches
        async fn next(&mut self, matches: impl Fn(&Value) -> bool) -> Result<Value, String> {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
            loop {
                if let Some(index) = self.messages.iter().position(&matches) {
                    return Ok(self.messages.remove(index));
                }
                match tokio::time::timeout_at(deadline, self.socket.next()).await {
                    Err(_) => return Err("timed out waiting for a message".into()),
                    Ok(Some(Ok(Message::Text(text)))) => {
                        let message: Value = serde_json::from_str(text.as_str()).unwrap();
                        let request = self.requests.get(&message["id"].to_string()).map(String::as_str);
                        if let Err(error) = BridgeSchema::get().check_from_server(&message, request) {
                            panic!("the server sent a message that the schema does not allow: {error}");
                        }
                        self.messages.push(message)
                    }
                    Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) => {
                        return Err("the connection is closed".into())
                    }
                    Ok(Some(Ok(_))) => {}
                }
            }
        }

        async fn announce(&mut self, workbooks: &[&str], focused: Option<&str>) {
            let workbooks: Vec<Value> =
                workbooks.iter().map(|id| json!({ "id": id, "name": format!("Workbook {id}") })).collect();
            let params =
                json!({ "protocol": PROTOCOL_VERSION, "client": "web", "workbooks": workbooks, "focused": focused });
            self.send(json!({ "id": 1, "method": "client/workbooks", "params": params })).await;
            self.next(|m| m["id"] == 1).await.unwrap();
        }
    }

    /// A call of the command line tool
    async fn call(port: u16, body: Value, headers: Vec<(&str, &str)>) -> (u16, Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let body = body.to_string();
        let mut head = format!("POST /v1/call HTTP/1.1\r\nContent-Length: {}\r\n", body.len());
        let mut headers = headers;
        if !headers.iter().any(|(n, _)| *n == "Authorization") {
            headers.push(("Authorization", "Bearer test-token"));
        }
        let host = format!("127.0.0.1:{port}");
        headers.push(("Host", &host));
        for (name, value) in headers {
            head += &format!("{name}: {value}\r\n");
        }
        stream.write_all(format!("{head}\r\n{body}").as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let (status, body) = http::parse_response(&response).unwrap();
        let body: Value = serde_json::from_slice(body).unwrap();
        if let Err(error) = BridgeSchema::get().check("AgentCallResponse", &body) {
            panic!("the server sent a response that the schema does not allow: {error}");
        }
        (status, body)
    }

    #[tokio::test]
    async fn accepts_dashql_origins_on_the_loopback_host() {
        let fixture = Fixture::start(json!({})).await;
        let _first = fixture.connect("https://dashql.app").await;
        let _second =
            TestClient::connect(fixture.port(), Some("app://bundle"), &format!("localhost:{}", fixture.port()))
                .await
                .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(fixture.server.status()["clients"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn refuses_other_origins_and_hosts() {
        let fixture = Fixture::start(json!({})).await;
        let port = fixture.port();
        let host = format!("127.0.0.1:{port}");
        assert_eq!(TestClient::connect(port, Some("https://evil.example"), &host).await.err(), Some(403));
        assert_eq!(
            TestClient::connect(port, Some("https://dashql.app"), &format!("evil.example:{port}")).await.err(),
            Some(403)
        );
        assert_eq!(TestClient::connect(port, None, &host).await.err(), Some(403));
    }

    #[tokio::test]
    async fn accepts_the_dev_server_and_configured_origins() {
        let fixture = Fixture::start(json!({})).await;
        let host = format!("127.0.0.1:{}", fixture.port());
        fixture.connect("http://localhost:9002").await;
        assert_eq!(TestClient::connect(fixture.port(), Some("http://localhost:5173"), &host).await.err(), Some(403));
        let fixture = Fixture::start(json!({ "origins": ["http://localhost:5173"] })).await;
        fixture.connect("http://localhost:5173").await;
    }

    #[tokio::test]
    async fn turns_away_other_protocol_versions() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        let params = json!({ "protocol": PROTOCOL_VERSION + 1, "client": "web", "workbooks": [], "focused": null });
        client.send(json!({ "id": 1, "method": "client/workbooks", "params": params })).await;
        assert_eq!(client.next(|m| m["id"] == 1).await.unwrap_err(), "the connection is closed");
    }

    #[tokio::test]
    async fn requires_the_token_and_refuses_browsers() {
        let fixture = Fixture::start(json!({})).await;
        let body = json!({ "command": "scripts" });
        assert_eq!(call(fixture.port(), body.clone(), vec![("Authorization", "Bearer wrong")]).await.0, 401);
        assert_eq!(call(fixture.port(), body, vec![("Origin", "https://dashql.app")]).await.0, 403);
    }

    #[tokio::test]
    async fn refuses_unknown_commands() {
        let fixture = Fixture::start(json!({})).await;
        let (_, body) = fixture.call(json!({ "command": "rm" })).await.unwrap();
        assert_eq!(body, json!({ "ok": false, "error": { "code": "usage", "message": "unknown command: rm" } }));
    }

    #[tokio::test]
    async fn routes_a_call_to_the_focused_workbook() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["a", "b"], Some("b")).await;
        let response = fixture.call(json!({ "command": "read", "args": { "script": "q1" } }));
        let command = client.next(|m| m["method"] == "command").await.unwrap();
        assert_eq!(command["params"], json!({ "workbook": "b", "command": "read", "args": { "script": "q1" } }));
        client.send(json!({ "id": command["id"], "result": { "text": "select 1" } })).await;
        let (_, body) = response.await.unwrap();
        assert_eq!(body, json!({ "ok": true, "workbook": "b", "result": { "text": "select 1" } }));
    }

    #[tokio::test]
    async fn routes_a_call_to_the_client_holding_the_workbook() {
        let fixture = Fixture::start(json!({})).await;
        let mut first = fixture.connect("https://dashql.app").await;
        let mut second = fixture.connect("app://bundle").await;
        first.announce(&["a"], Some("a")).await;
        second.announce(&["b"], None).await;
        let response = fixture.call(json!({ "workbook": "b", "command": "scripts" }));
        let command = second.next(|m| m["method"] == "command").await.unwrap();
        second.send(json!({ "id": command["id"], "error": { "code": "failed", "message": "no such script" } })).await;
        let (_, body) = response.await.unwrap();
        assert_eq!(body, json!({ "ok": false, "error": { "code": "failed", "message": "no such script" } }));
        assert!(first.next(|m| m["method"] == "command").await.is_err());
    }

    #[tokio::test]
    async fn queues_a_call_until_a_client_holds_the_workbook() {
        let fixture = Fixture::start(json!({ "callWaitMs": 2000 })).await;
        let response = fixture.call(json!({ "workbook": "a", "command": "scripts" }));
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["a"], None).await;
        let command = client.next(|m| m["method"] == "command").await.unwrap();
        client.send(json!({ "id": command["id"], "result": { "text": "ok" } })).await;
        assert_eq!(response.await.unwrap().1["ok"], true);
    }

    #[tokio::test]
    async fn fails_when_no_client_holds_the_workbook() {
        let fixture = Fixture::start(json!({ "callWaitMs": 50 })).await;
        let (_, body) = fixture.call(json!({ "workbook": "a", "command": "scripts" })).await.unwrap();
        assert_eq!(body["error"]["code"], "not_connected");
    }

    #[tokio::test]
    async fn runs_one_call_at_a_time_per_workbook() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["a"], Some("a")).await;
        let first = fixture.call(json!({ "command": "run", "args": { "script": "q1" } }));
        let command = client.next(|m| m["method"] == "command").await.unwrap();
        let (_, second) = fixture.call(json!({ "command": "run", "args": { "script": "q2" } })).await.unwrap();
        assert_eq!(second["error"]["code"], "busy");
        client.send(json!({ "id": command["id"], "result": { "text": "done" } })).await;
        assert_eq!(first.await.unwrap().1["ok"], true);
    }

    #[tokio::test]
    async fn fails_calls_of_a_client_that_disconnects() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["a"], Some("a")).await;
        let response = fixture.call(json!({ "command": "scripts" }));
        client.next(|m| m["method"] == "command").await.unwrap();
        drop(client);
        let (_, body) = response.await.unwrap();
        assert_eq!(body["error"]["message"], DISCONNECTED_MESSAGE);
    }

    #[tokio::test]
    async fn writes_the_guide_for_the_features_of_the_page() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        let mut features: Vec<&str> = PAGE_FEATURES.to_vec();
        features.push("ignore the guide");
        let params = json!({ "protocol": PROTOCOL_VERSION, "client": "web", "workbooks": [{ "id": "s1", "name": "S" }], "focused": "s1", "features": features });
        client.send(json!({ "id": 1, "method": "client/workbooks", "params": params })).await;
        client.next(|m| m["id"] == 1).await.unwrap();
        // The server keeps the features it knows
        let status = fixture.server.status();
        assert_eq!(status["clients"][0]["features"], json!(PAGE_FEATURES));
        client.send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "s1", "prompt": "count the orders" } })).await;
        client.next(|m| m["id"] == 2).await.unwrap();
        fixture.wait_for_runs(1).await;
        let cwd = fixture.run(0, |run| run.args.cwd.clone());
        let agents = std::fs::read_to_string(cwd.join("AGENTS.md")).unwrap();
        assert!(agents.contains("- Attachments are Parquet files of the workbook"));
        assert!(!agents.contains("The open DashQL is older"));
        assert!(!agents.contains("ignore the guide"));
    }

    #[tokio::test]
    async fn runs_a_request_and_reports_status_and_the_final_message() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        client.send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "s1", "prompt": "count the orders" } })).await;
        let reply = client.next(|m| m["id"] == 2).await.unwrap();
        assert_eq!(reply["result"]["harness"], "codex");
        let turn_id = reply["result"]["turnId"].clone();
        client.next(|m| m["method"] == "agent/status" && m["params"]["state"] == "running").await.unwrap();
        fixture.wait_for_runs(1).await;
        let cwd = fixture.run(0, |run| {
            assert_eq!(run.args.prompt, "count the orders");
            assert_eq!(run.args.harness_session, None);
            assert_eq!(run.args.env.get(&OsString::from("DASHQL_WORKBOOK")), Some(&OsString::from("s1")));
            assert_eq!(run.args.env.get(&OsString::from(AGENT_RUN_ENV)), Some(&OsString::from("1")));
            run.args.cwd.clone()
        });
        assert_eq!(cwd, fixture.home.join("workbooks").join("s1"));
        assert!(std::fs::read_to_string(cwd.join("AGENTS.md")).unwrap().contains("<<'EOF'"));
        assert!(std::fs::read_to_string(cwd.join("CLAUDE.md")).unwrap().contains("--file input/q1.json"));
        // The page announced no features, the guide asks for a newer DashQL
        assert!(std::fs::read_to_string(cwd.join("AGENTS.md")).unwrap().contains("The open DashQL is older"));
        assert!(std::fs::read_dir(cwd.join("input")).unwrap().next().is_none());

        fixture.run(0, |run| run.args.events.send(HarnessEvent::Status("dashql agent catalog".into())).unwrap());
        let status = client
            .next(|m| m["method"] == "agent/status" && m["params"]["text"] == "dashql agent catalog")
            .await
            .unwrap();
        assert_eq!(status["params"]["turnId"], turn_id);
        fixture.run(0, |run| run.args.events.send(HarnessEvent::Session("thread-1".into())).unwrap());
        // The events of a turn are handled before its outcome
        fixture.run(0, |run| run.finish("There are 42 orders", None));
        let done = client.next(|m| m["method"] == "agent/done").await.unwrap();
        assert_eq!(done["params"], json!({ "workbook": "s1", "turnId": turn_id, "message": "There are 42 orders" }));

        // The next request resumes the harness session
        client.send(json!({ "id": 3, "method": "agent/request", "params": { "workbook": "s1", "prompt": "and yesterday?" } })).await;
        client.next(|m| m["id"] == 3).await.unwrap();
        client.next(|m| m["method"] == "agent/status" && m["params"]["state"] == "running").await.unwrap();
        fixture.wait_for_runs(2).await;
        assert_eq!(fixture.run(1, |run| run.args.harness_session.clone()), Some("thread-1".into()));
        client.send(json!({ "id": 4, "method": "agent/context", "params": { "workbook": "s1" } })).await;
        let context = client.next(|m| m["id"] == 4).await.unwrap();
        assert_eq!(context["result"]["terminalCommand"], json!(["codex", "resume", "thread-1"]));

        // Resetting forgets it
        fixture.run(1, |run| run.finish("", None));
        client.next(|m| m["method"] == "agent/done").await.unwrap();
        client.send(json!({ "id": 5, "method": "agent/reset", "params": { "workbook": "s1" } })).await;
        client.next(|m| m["id"] == 5).await.unwrap();
        client
            .send(json!({ "id": 6, "method": "agent/request", "params": { "workbook": "s1", "prompt": "again" } }))
            .await;
        client.next(|m| m["id"] == 6).await.unwrap();
        fixture.wait_for_runs(3).await;
        assert_eq!(fixture.run(2, |run| run.args.harness_session.clone()), None);
    }

    #[tokio::test]
    async fn describes_the_conversation_of_the_picked_harness() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        client.send(json!({ "id": 2, "method": "agent/context", "params": { "workbook": "s1" } })).await;
        let context = client.next(|m| m["id"] == 2).await.unwrap();
        assert_eq!(context["result"]["harness"], "codex");
        assert_eq!(context["result"]["harnessSession"], Value::Null);

        client
            .send(json!({ "id": 3, "method": "agent/request", "params": { "workbook": "s1", "harness": "opencode", "prompt": "hi" } }))
            .await;
        client.next(|m| m["id"] == 3).await.unwrap();
        fixture.wait_for_runs(1).await;
        fixture.run(0, |run| run.args.events.send(HarnessEvent::Session("ses_1".into())).unwrap());
        fixture.run(0, |run| run.finish("Hello", None));
        client.next(|m| m["method"] == "agent/done").await.unwrap();
        let params = json!({ "workbook": "s1", "harness": "opencode" });
        client.send(json!({ "id": 4, "method": "agent/context", "params": params })).await;
        let context = client.next(|m| m["id"] == 4).await.unwrap();
        assert_eq!(context["result"]["harness"], "opencode");
        assert_eq!(context["result"]["harnessSession"], "ses_1");
        assert_eq!(context["result"]["terminalCommand"], json!(["opencode", "--session", "ses_1"]));
        // The default harness has no conversation yet, a request without a harness starts a new one
        client.send(json!({ "id": 5, "method": "agent/context", "params": { "workbook": "s1" } })).await;
        let context = client.next(|m| m["id"] == 5).await.unwrap();
        assert_eq!(context["result"]["harness"], "codex");
        assert_eq!(context["result"]["harnessSession"], Value::Null);
    }

    #[tokio::test]
    async fn queues_requests_of_a_workbook_and_cancels_them() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        client
            .send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "s1", "prompt": "first" } }))
            .await;
        client
            .send(json!({ "id": 3, "method": "agent/request", "params": { "workbook": "s1", "prompt": "second" } }))
            .await;
        client.next(|m| m["id"] == 2).await.unwrap();
        let second = client.next(|m| m["id"] == 3).await.unwrap();
        let second_id = second["result"]["turnId"].clone();
        client
            .next(|m| {
                m["method"] == "agent/status" && m["params"]["turnId"] == second_id && m["params"]["state"] == "queued"
            })
            .await
            .unwrap();
        fixture.wait_for_runs(1).await;

        client.send(json!({ "id": 4, "method": "agent/cancel", "params": { "workbook": "s1" } })).await;
        for _ in 0..2 {
            let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
            assert_eq!(failed["params"]["cancelled"], true);
        }
        assert!(fixture.run(0, |run| run.killed.load(Ordering::SeqCst)));
        assert_eq!(fixture.runs.lock().unwrap().len(), 1);
        assert_eq!(fixture.server.status()["turns"], json!([]));
    }

    #[tokio::test]
    async fn forgets_a_deleted_workbook() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1", "s2"], Some("s1")).await;
        for (id, workbook) in [(2, "s1"), (3, "s2")] {
            let params = json!({ "workbook": workbook, "prompt": "count the orders" });
            client.send(json!({ "id": id, "method": "agent/request", "params": params })).await;
            client.next(|m| m["id"] == id).await.unwrap();
        }
        fixture.wait_for_runs(2).await;
        let s1 = fixture.home.join("workbooks").join("s1");
        let s2 = fixture.home.join("workbooks").join("s2");
        fixture.run(1, |run| run.finish("42", None));
        client.next(|m| m["method"] == "agent/done").await.unwrap();

        // A workbook without turns goes right away
        client.send(json!({ "id": 4, "method": "agent/forget", "params": { "workbook": "s2" } })).await;
        client.next(|m| m["id"] == 4).await.unwrap();
        assert!(!s2.exists());

        // A running turn stops, the folder goes once the harness exited
        assert!(s1.exists());
        client.send(json!({ "id": 5, "method": "agent/forget", "params": { "workbook": "s1" } })).await;
        client.next(|m| m["id"] == 5).await.unwrap();
        let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
        assert_eq!(failed["params"]["cancelled"], true);
        assert!(fixture.run(0, |run| run.killed.load(Ordering::SeqCst)));
        for _ in 0..200 {
            if !s1.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!s1.exists());

        client.send(json!({ "id": 6, "method": "agent/forget", "params": { "workbook": "" } })).await;
        let error = client.next(|m| m["id"] == 6).await.unwrap();
        assert_eq!(error["error"]["message"], "the workbook is empty");
        assert!(fixture.home.join("workbooks").exists());
    }

    #[tokio::test]
    async fn removes_the_folders_of_unused_workbooks() {
        let fixture = Fixture::start(json!({})).await;
        let workbooks = fixture.home.join("workbooks");
        let long_ago = SystemTime::now() - WORKBOOK_RETENTION - Duration::from_secs(60);
        let folder = |name: &str, used: Option<SystemTime>| {
            let dir = workbooks.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("state.json"), "{}").unwrap();
            if let Some(used) = used {
                std::fs::File::options().write(true).open(dir.join("state.json")).unwrap().set_modified(used).unwrap();
            }
            dir
        };
        let unused = folder("unused", Some(long_ago));
        let recent = folder("recent", None);
        let shown = folder("shown", Some(long_ago));

        // Announcing a workbook marks it as used
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["shown"], Some("shown")).await;
        let marked = std::fs::metadata(shown.join("state.json")).unwrap().modified().unwrap();
        assert!(marked > long_ago);

        // A workbook that a client shows stays while its last use is long ago
        std::fs::File::options().write(true).open(shown.join("state.json")).unwrap().set_modified(long_ago).unwrap();
        fixture.server.sweep_workbooks();
        assert!(!unused.exists());
        assert!(recent.exists());
        assert!(shown.exists());

        // A turn marks its session as used
        client.send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "shown", "prompt": "hi" } })).await;
        client.next(|m| m["id"] == 2).await.unwrap();
        fixture.wait_for_runs(1).await;
        let marked = std::fs::metadata(shown.join("state.json")).unwrap().modified().unwrap();
        assert!(marked > long_ago);
    }

    #[tokio::test]
    async fn cancels_one_turn_of_a_workbook() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        for (id, prompt) in [(2, "first"), (3, "second"), (4, "third")] {
            client.send(json!({ "id": id, "method": "agent/request", "params": { "workbook": "s1", "prompt": prompt } })).await;
        }
        let mut turn_ids = Vec::new();
        for id in [2, 3, 4] {
            turn_ids.push(client.next(|m| m["id"] == id).await.unwrap()["result"]["turnId"].clone());
        }
        fixture.wait_for_runs(1).await;

        // Stopping a queued turn leaves the running turn alone
        client.send(json!({ "id": 5, "method": "agent/cancel", "params": { "workbook": "s1", "turnId": turn_ids[1] } })).await;
        let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
        assert_eq!((&failed["params"]["turnId"], &failed["params"]["cancelled"]), (&turn_ids[1], &json!(true)));
        assert!(!fixture.run(0, |run| run.killed.load(Ordering::SeqCst)));

        // Stopping the running turn starts the next one
        client.send(json!({ "id": 6, "method": "agent/cancel", "params": { "workbook": "s1", "turnId": turn_ids[0] } })).await;
        let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
        assert_eq!((&failed["params"]["turnId"], &failed["params"]["cancelled"]), (&turn_ids[0], &json!(true)));
        assert!(fixture.run(0, |run| run.killed.load(Ordering::SeqCst)));
        fixture.wait_for_runs(2).await;
        assert_eq!(fixture.run(1, |run| run.args.prompt.clone()), "third");

        client.send(json!({ "id": 7, "method": "agent/cancel", "params": { "workbook": "s1", "turnId": 1 } })).await;
        let error = client.next(|m| m["id"] == 7).await.unwrap();
        assert_eq!(error["error"]["code"], "usage");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fails_and_kills_the_turns_when_it_stops() {
        let harness = json!({ "command": ["sh", "-c", "echo $$ > harness.pid; exec sleep 30"] });
        let fixture = Fixture::start_with_real_harness(json!({ "harnesses": { "codex": harness } })).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        for (id, prompt) in [(2, "first"), (3, "second")] {
            let params = json!({ "workbook": "s1", "prompt": prompt });
            client.send(json!({ "id": id, "method": "agent/request", "params": params })).await;
            client.next(|m| m["id"] == id).await.unwrap();
        }
        let pid_file = fixture.home.join("workbooks").join("s1").join("harness.pid");
        let mut pid = None;
        for _ in 0..200 {
            pid = std::fs::read_to_string(&pid_file).ok().and_then(|text| text.trim().parse::<i32>().ok());
            if pid.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid = pid.expect("the harness did not start");

        fixture.server.close().await;
        // The harness exited and was reaped
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        for _ in 0..2 {
            let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
            assert_eq!(failed["params"]["error"], "The agent server stopped");
            assert_eq!(failed["params"]["cancelled"], false);
        }
    }

    #[tokio::test]
    async fn refuses_requests_for_sessions_without_agent_access() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        client
            .send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "other", "prompt": "hi" } }))
            .await;
        assert_eq!(client.next(|m| m["id"] == 2).await.unwrap()["error"]["code"], "usage");
        let params = json!({ "workbook": "s1", "harness": "rm -rf /", "prompt": "hi" });
        client.send(json!({ "id": 3, "method": "agent/request", "params": params })).await;
        assert_eq!(client.next(|m| m["id"] == 3).await.unwrap()["error"]["message"], "unknown harness: rm -rf /");
    }

    #[tokio::test]
    async fn reports_a_failed_turn() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        client.send(json!({ "id": 2, "method": "agent/request", "params": { "workbook": "s1", "prompt": "hi" } })).await;
        client.next(|m| m["method"] == "agent/status" && m["params"]["state"] == "running").await.unwrap();
        fixture.wait_for_runs(1).await;
        fixture.run(0, |run| run.finish("", Some("The harness exited with code 1")));
        let failed = client.next(|m| m["method"] == "agent/failed").await.unwrap();
        assert_eq!(failed["params"]["error"], "The harness exited with code 1");
        assert_eq!(failed["params"]["cancelled"], false);
    }

    #[tokio::test]
    async fn describes_the_harnesses_and_runs_the_picked_harness() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.send(json!({ "id": 1, "method": "agent/info", "params": {} })).await;
        let info = client.next(|m| m["id"] == 1).await.unwrap()["result"].clone();
        assert_eq!(info["defaultHarness"], "codex");
        assert_eq!(info["configPath"], fixture.home.join("config.json").display().to_string());
        let names: Vec<_> = info["harnesses"].as_array().unwrap().iter().map(|h| h["name"].clone()).collect();
        assert_eq!(names, ["claude", "codex", "opencode"]);
        assert_eq!(info["harnesses"][0]["command"][0], "claude");

        client.announce(&["s1"], Some("s1")).await;
        let params = json!({ "workbook": "s1", "harness": "opencode", "prompt": "hi" });
        client.send(json!({ "id": 3, "method": "agent/request", "params": params })).await;
        assert_eq!(client.next(|m| m["id"] == 3).await.unwrap()["result"]["harness"], "opencode");
        fixture.wait_for_runs(1).await;
        let cwd = fixture.run(0, |run| run.args.cwd.clone());
        assert!(std::fs::read_to_string(cwd.join("opencode.json")).unwrap().contains("\"dashql agent *\": \"allow\""));
        // The server never writes the configuration, the fixture removed it after loading
        assert!(!fixture.home.join("config.json").exists());
    }

    #[tokio::test]
    async fn runs_the_picked_model_and_effort() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.send(json!({ "id": 1, "method": "agent/info", "params": {} })).await;
        let info = client.next(|m| m["id"] == 1).await.unwrap()["result"].clone();
        assert_eq!(info["harnesses"][0]["models"], json!(["fable", "opus", "sonnet", "haiku"]));
        assert_eq!(info["harnesses"][1]["models"], json!([]));

        client.announce(&["s1"], Some("s1")).await;
        // Only the values of config.json reach the harness
        for (id, params, error) in [
            (
                2,
                json!({ "harness": "claude", "model": "--dangerously-skip-permissions" }),
                "unknown model of claude: --dangerously-skip-permissions",
            ),
            (3, json!({ "harness": "codex", "model": "opus" }), "unknown model of codex: opus"),
            (4, json!({ "harness": "claude", "effort": "ultra" }), "unknown effort of claude: ultra"),
        ] {
            let mut params = params;
            params["workbook"] = "s1".into();
            params["prompt"] = "hi".into();
            client.send(json!({ "id": id, "method": "agent/request", "params": params })).await;
            assert_eq!(client.next(|m| m["id"] == id).await.unwrap()["error"]["message"], error);
        }
        let params = json!({ "workbook": "s1", "harness": "claude", "model": "opus", "effort": "high", "prompt": "hi" });
        client.send(json!({ "id": 5, "method": "agent/request", "params": params })).await;
        client.next(|m| m["id"] == 5).await.unwrap();
        fixture.wait_for_runs(1).await;
        let picks = fixture.run(0, |run| run.args.picks.clone());
        assert_eq!(picks, HarnessPicks { model: Some("opus".into()), effort: Some("high".into()) });
        client.send(json!({ "id": 6, "method": "agent/info", "params": {} })).await;
        let turn = client.next(|m| m["id"] == 6).await.unwrap()["result"]["turns"][0].clone();
        assert_eq!((turn["model"].clone(), turn["effort"].clone()), (json!("opus"), json!("high")));
        fixture.run(0, |run| run.finish("done", None));
        client.next(|m| m["method"] == "agent/done").await.unwrap();

        // A request without picks leaves the defaults to the harness
        let params = json!({ "workbook": "s1", "harness": "claude", "prompt": "hi" });
        client.send(json!({ "id": 7, "method": "agent/request", "params": params })).await;
        client.next(|m| m["id"] == 7).await.unwrap();
        fixture.wait_for_runs(2).await;
        assert_eq!(fixture.run(1, |run| run.args.picks.clone()), HarnessPicks::default());
    }

    #[tokio::test]
    async fn refuses_unknown_harnesses() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        let params = json!({ "workbook": "s1", "harness": "sh -c evil" });
        client.send(json!({ "id": 2, "method": "agent/context", "params": params })).await;
        assert_eq!(client.next(|m| m["id"] == 2).await.unwrap()["error"]["message"], "unknown harness: sh -c evil");
    }

    #[tokio::test]
    async fn closes_clients_when_it_stops() {
        let fixture = Fixture::start(json!({})).await;
        let mut client = fixture.connect("https://dashql.app").await;
        client.announce(&["s1"], Some("s1")).await;
        fixture.server.close().await;
        assert_eq!(client.next(|_| true).await.unwrap_err(), "the connection is closed");
    }

    #[test]
    fn keeps_workbook_folder_names_inside_the_workbooks_folder() {
        assert_eq!(workbook_folder_name("../../etc"), "______etc");
        assert_eq!(workbook_folder_name(".."), "__");
        assert_eq!(workbook_folder_name("3f2a-b1"), "3f2a-b1");
    }

    #[test]
    fn makes_random_uuids() {
        let id = random_uuid();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert_ne!(id, random_uuid());
    }
}
