//! The messages between the agent server and its clients, dashql.app tabs and desktop windows.
//! The page keeps the types of these messages in packages/dashql-app/src/platform/agent/agent_protocol.ts.
//!
//! Messages are JSON-RPC-style: a request {id, method, params} is answered by {id, result} or {id, error}.
//! A message with a method but without an id is a notification.
//!
//! | Method | Direction | Params | Result |
//! |---|---|---|---|
//! | `client/sessions` | client → server | `{protocol, client, sessions: [{id, name}], focused}` | `{}` |
//! | `command` | server → client | `{session, command, args}` | `{text, data?}` |
//! | `agent/request` | client → server | `{session, harness?, prompt}` | `{runId, harness}` |
//! | `agent/cancel`, `agent/reset` | client → server | `{session}` | `{}` |
//! | `agent/context` | client → server | `{session}` | `{folder, harness, harnessSession, terminalCommand}` |
//! | `agent/info` | client → server | `{}` | the status with `home, configPath, dev, defaultHarness, harnesses` |
//! | `agent/configure` | client → server | `{defaultHarness?}` | `{}` |
//! | `agent/status` | server → client | `{session, runId, state: "queued" \| "running", text}` | notification |
//! | `agent/done` | server → client | `{session, runId, message}` | notification |
//! | `agent/failed` | server → client | `{session, runId, error, cancelled}` | notification |
//!
//! The command line tool calls the server over HTTP: `GET /v1/status` returns `{ok, status}`, `POST /v1/call`
//! takes `{session?, command, args?}` and returns `{ok: true, session, result: {text, data?}}` or
//! `{ok: false, error: {code, message}}`.

use serde_json::{json, Value};

/// The version of the protocol, a client with another version is turned away
pub const PROTOCOL_VERSION: u64 = 1;

/// The path of the WebSocket endpoint
pub const WEBSOCKET_PATH: &str = "/v1/ws";

/// The commands that clients run for the command line tool
pub const CLIENT_COMMANDS: [&str; 7] = ["scripts", "read", "edit", "catalog", "lint", "run", "result"];

/// The error codes of failed calls
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorCode {
    /// The command failed
    Failed,
    /// No client holds the target session
    NotConnected,
    /// Another call of the session is running
    Busy,
    /// The call is malformed
    Usage,
}

impl ErrorCode {
    pub fn name(self) -> &'static str {
        match self {
            ErrorCode::Failed => "failed",
            ErrorCode::NotConnected => "not_connected",
            ErrorCode::Busy => "busy",
            ErrorCode::Usage => "usage",
        }
    }

    /// Unknown codes are failures
    pub fn parse(name: &str) -> Self {
        match name {
            "not_connected" => ErrorCode::NotConnected,
            "busy" => ErrorCode::Busy,
            "usage" => ErrorCode::Usage,
            _ => ErrorCode::Failed,
        }
    }
}

/// The error of a failed call
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
}

impl RpcError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        RpcError { code, message: message.into() }
    }

    pub fn to_json(&self) -> Value {
        json!({ "code": self.code.name(), "message": self.message })
    }

    /// The error of a response, defaults for missing fields
    pub fn from_json(error: &Value) -> Self {
        RpcError {
            code: ErrorCode::parse(error["code"].as_str().unwrap_or_default()),
            message: match &error["message"] {
                Value::String(s) => s.clone(),
                Value::Null => "the command failed".into(),
                other => other.to_string(),
            },
        }
    }

    /// The response of a failed call
    pub fn to_call_response(&self) -> Value {
        json!({ "ok": false, "error": self.to_json() })
    }
}
