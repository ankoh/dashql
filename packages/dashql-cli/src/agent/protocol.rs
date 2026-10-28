//! The messages between the agent server and its clients, dashql.app tabs and desktop windows.
//! The JSON Schema in proto/json/dashql/agent_bridge.json defines the messages: AgentServerMethods names the params
//! and results of the requests of clients, AgentClientMethods the requests and notifications of the server.
//! The page generates its types from the schema, the tests of the server check its messages against it.
//!
//! Messages are JSON-RPC-style: a request {id, method, params} is answered by {id, result} or {id, error}.
//! A message with a method but without an id is a notification.
//!
//! The command line tool calls the server over HTTP: `GET /v1/status` returns `AgentStatusResponse`,
//! `POST /v1/call` takes `AgentCallRequest` and returns `AgentCallResponse`.

use serde_json::{json, Value};

/// The version of the protocol, a client with another version is turned away
pub const PROTOCOL_VERSION: u64 = 2;

/// The path of the WebSocket endpoint
pub const WEBSOCKET_PATH: &str = "/v1/ws";

/// The commands that clients run for the command line tool
pub const CLIENT_COMMANDS: [&str; 10] =
    ["scripts", "read", "edit", "catalog", "lint", "run", "result", "vis.get", "vis.edit", "vis.image"];

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::schema::BridgeSchema;

    #[test]
    fn names_the_protocol_version_of_the_schema() {
        let params = BridgeSchema::get().definition("ClientSessionsParams").unwrap();
        assert_eq!(params["properties"]["protocol"]["const"], json!(PROTOCOL_VERSION));
    }
}
