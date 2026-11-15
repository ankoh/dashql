//! The setups of the connectors and the health checks as async services on a host.
//!
//! A setup is an async function that drives the state machine of its connector: `trino::setup::TrinoSetup`,
//! `salesforce::setup::SalesforceSetup`, and the steps of a Hyper channel in `hyper`. It applies every action of the
//! connection through the host (`SetupHost::dispatch`), awaits the host for what it can't do itself and returns the id of
//! the channel that the host keeps. The health check runs its probe query through the query executor of the host.
//!
//! - `oauth`: what an OAuth flow asks of the platform, the PKCE challenge, a random state and the authorization page with
//!   its callback (`OAuthHost`).
//! - `trino`, `salesforce`, `hyper`: the setups of the connectors.
//! - `health_check`: the probe query of a new channel.
//!
//! The host is one setup: it applies the actions to one connection and keeps the channels of that setup. The channels
//! stay objects of the host, the query executor reads them as it did before: a Trino channel names its endpoint, auth
//! and token, a Hyper channel over HTTP describes itself, the gRPC channel of the desktop app and the embedded Hyper run
//! their queries in the host.
//!
//! A cancelled setup ends at the next step: the token stops the host call that runs, the state machine reports the
//! cancellation as an action of the connection. A failed host call keeps what the host failed with, the caller gets it
//! back unchanged.

pub mod health_check;
pub mod hyper;
pub mod oauth;
pub mod salesforce;
pub mod trino;

use std::collections::BTreeMap;
use std::future::Future;

use serde_json::{json, Value};

use crate::connections::{
    ChannelId, ConnectionAction, ConnectorType, DetailedError, HyperAction, JsonObject, OAuthPkceChallenge, SalesforceAction,
    TemporaryToken, TrinoAction,
};
use crate::executor::HostValue;
use crate::host::HostError;
use crate::http::CancellationToken;
use crate::query::QueryMetadata;
use crate::salesforce::setup::SalesforceChannelSetup;
use crate::trino::TrinoChannel;

pub use health_check::check_health;
pub use hyper::{setup_hyper, HyperChannelKind, HyperChannelRequest};
pub use oauth::{OAuthEvents, OAuthHost};
pub use salesforce::{authenticate_salesforce, setup_salesforce, SalesforceAuthentication};
pub use trino::setup_trino;

/// The target of the log messages of the setups
pub const LOG_TARGET: &str = "connection_setup";
/// The message of a cancelled setup
pub const CANCELLED_MESSAGE: &str = "The connection setup was cancelled";

/// How a setup or a health check ended without success
#[derive(Clone)]
pub struct SetupFailure {
    /// Was it cancelled?
    pub cancelled: bool,
    /// The message
    pub message: String,
    /// The details, e.g. the status of a rejected request
    pub data: BTreeMap<String, String>,
    /// What the host failed with, it goes back to the host unchanged
    pub value: Option<HostValue>,
}

impl std::fmt::Debug for SetupFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SetupFailure")
            .field("cancelled", &self.cancelled)
            .field("message", &self.message)
            .field("data", &self.data)
            .field("value", &self.value.is_some())
            .finish()
    }
}

impl SetupFailure {
    /// A failure with a message
    pub fn failed(message: impl Into<String>) -> Self {
        Self { cancelled: false, message: message.into(), data: BTreeMap::new(), value: None }
    }

    /// A cancellation
    pub fn cancelled() -> Self {
        Self { cancelled: true, ..Self::failed(CANCELLED_MESSAGE) }
    }

    /// A failure that keeps what the host failed with
    pub fn with_value(mut self, value: Option<HostValue>) -> Self {
        self.value = value;
        self
    }
}

/// How the probe query of a health check ended
#[derive(Debug, Clone, PartialEq)]
pub enum ProbeResult {
    /// The query returned a table, or none
    Finished { has_table: bool },
    /// The query failed with an error, e.g. the status of a rejected login
    Failed(DetailedError),
}

/// What a setup asks of the host besides the OAuth flow
pub trait SetupHost: OAuthHost {
    /// Apply an action of the setup to its connection
    fn dispatch(&self, action: &ConnectionAction);
    /// Keep a Trino channel, returns its id. The executor speaks it with the endpoint, the auth and the token.
    fn connect_trino_channel(&self, channel: &TrinoChannel) -> impl Future<Output = Result<ChannelId, HostError>> + 'static;
    /// Connect the Hyper channel of a Salesforce connection over HTTP with its tokens, returns its id
    fn connect_salesforce_channel(
        &self,
        channel: &SalesforceChannelSetup,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static;
    /// Connect a Hyper channel of the kind of the request, returns its id
    fn connect_hyper_channel(
        &self,
        channel: &HyperChannelRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static;
    /// The token of the link to a Hyper that the connection was opened with, none if the page doesn't hold it
    fn hyper_link_token(&self) -> Option<String>;
    /// Close a channel that the setup doesn't hand out, e.g. one that was ready after the setup was cancelled
    fn close_channel(&self, id: ChannelId);
    /// Run the probe query of a health check on a channel through the query executor, as a query of the connection
    fn run_probe(
        &self,
        channel: ChannelId,
        query: &str,
        metadata: &QueryMetadata,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static;
}

/// A detailed error as JSON, as the connection state of the host keeps it
fn error_json(error: &DetailedError) -> Value {
    if error.data.is_empty() {
        json!({ "message": error.message })
    } else {
        json!({ "message": error.message, "data": error.data })
    }
}

/// Opaque token JSON as a value, a string that doesn't parse stays a string
fn token_json(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

fn params_json(params: &JsonObject) -> Value {
    Value::Object(params.clone())
}

/// An action of a setup as the host applies it: `{connector, type, value}`. The type is the name of the action of the
/// connector, a channel is its id and a token its JSON. None for an action that no setup dispatches.
pub fn setup_action_json(action: &ConnectionAction) -> Option<Value> {
    let (connector, kind, value) = match action {
        ConnectionAction::HealthCheckStarted => ("connection", "HEALTH_CHECK_STARTED", Value::Null),
        ConnectionAction::HealthCheckCancelled => ("connection", "HEALTH_CHECK_CANCELLED", Value::Null),
        ConnectionAction::HealthCheckSucceeded => ("connection", "HEALTH_CHECK_SUCCEEDED", Value::Null),
        ConnectionAction::HealthCheckFailed(error) => ("connection", "HEALTH_CHECK_FAILED", error_json(error)),
        ConnectionAction::Trino(action) => {
            let (kind, value) = match action {
                TrinoAction::OAuthStarted { params } => ("OAUTH_STARTED", params_json(params)),
                TrinoAction::OAuthCancelled(error) => ("OAUTH_CANCELLED", error_json(error)),
                TrinoAction::OAuthFailed(error) => ("OAUTH_FAILED", error_json(error)),
                TrinoAction::GeneratingPkceChallenge => ("GENERATING_PKCE_CHALLENGE", Value::Null),
                TrinoAction::GeneratedPkceChallenge(pkce) => {
                    ("GENERATED_PKCE_CHALLENGE", json!({ "value": pkce.value, "verifier": pkce.verifier }))
                }
                TrinoAction::OAuthBrowserOpened => ("OAUTH_BROWSER_OPENED", Value::Null),
                TrinoAction::ReceivedOAuthCode(code) => {
                    ("RECEIVED_OAUTH_CODE", json!({ "token": code.token, "createdAt": code.created_at }))
                }
                TrinoAction::RequestingAccessToken => ("REQUESTING_ACCESS_TOKEN", Value::Null),
                TrinoAction::ReceivedAccessToken(token) => ("RECEIVED_ACCESS_TOKEN", token_json(token)),
                TrinoAction::ChannelSetupStarted { params } => ("TRINO_CHANNEL_SETUP_STARTED", params_json(params)),
                TrinoAction::ChannelSetupCancelled(error) => ("TRINO_CHANNEL_SETUP_CANCELLED", error_json(error)),
                TrinoAction::ChannelSetupFailed(error) => ("TRINO_CHANNEL_SETUP_FAILED", error_json(error)),
                TrinoAction::ChannelReady(channel) => ("TRINO_CHANNEL_READY", json!(channel)),
            };
            ("trino", kind, value)
        }
        ConnectionAction::Salesforce(action) => {
            let (kind, value) = match action {
                SalesforceAction::SetupStarted { params } => ("SETUP_STARTED", params_json(params)),
                SalesforceAction::SetupCancelled(error) => ("SETUP_CANCELLED", error_json(error)),
                SalesforceAction::SetupFailed(error) => ("SETUP_FAILED", error_json(error)),
                SalesforceAction::GeneratingPkceChallenge => ("GENERATING_PKCE_CHALLENGE", Value::Null),
                SalesforceAction::GeneratedPkceChallenge(pkce) => {
                    ("GENERATED_PKCE_CHALLENGE", json!({ "value": pkce.value, "verifier": pkce.verifier }))
                }
                SalesforceAction::OAuthNativeLinkOpened => ("OAUTH_NATIVE_LINK_OPENED", Value::Null),
                SalesforceAction::OAuthWebWindowOpened => ("OAUTH_WEB_WINDOW_OPENED", Value::Null),
                SalesforceAction::OAuthWebWindowClosed => ("OAUTH_WEB_WINDOW_CLOSED", Value::Null),
                SalesforceAction::ReceivedCoreAuthCode(code) => {
                    ("RECEIVED_CORE_AUTH_CODE", json!({ "token": code.token, "createdAt": code.created_at }))
                }
                SalesforceAction::RequestingCoreAuthToken => ("REQUESTING_CORE_AUTH_TOKEN", Value::Null),
                SalesforceAction::ReceivedCoreAuthToken(token) => ("RECEIVED_CORE_AUTH_TOKEN", token_json(token)),
                SalesforceAction::ReceivedCoreUserInfo { preferred_username, email } => {
                    let mut info = JsonObject::new();
                    if let Some(name) = preferred_username {
                        info.insert("preferredUsername".to_string(), json!(name));
                    }
                    if let Some(email) = email {
                        info.insert("email".to_string(), json!(email));
                    }
                    ("RECEIVED_CORE_USER_INFO", Value::Object(info))
                }
                SalesforceAction::RequestingDataCloudAccessToken => ("REQUESTING_DATA_CLOUD_ACCESS_TOKEN", Value::Null),
                SalesforceAction::ReceivedDataCloudAccessToken(token) => {
                    ("RECEIVED_DATA_CLOUD_ACCESS_TOKEN", token_json(token))
                }
                SalesforceAction::ChannelSetupStarted => ("SF_CHANNEL_SETUP_STARTED", Value::Null),
                SalesforceAction::ChannelSetupCancelled(error) => ("SF_CHANNEL_SETUP_CANCELLED", error_json(error)),
                SalesforceAction::ChannelSetupFailed(error) => ("SF_CHANNEL_SETUP_FAILED", error_json(error)),
                SalesforceAction::ChannelReady(channel) => ("SF_CHANNEL_READY", json!(channel)),
            };
            ("salesforce", kind, value)
        }
        ConnectionAction::Hyper(action) => {
            let (kind, value) = match action {
                HyperAction::ChannelSetupStarted { params } => ("HYPER_CHANNEL_SETUP_STARTED", params_json(params)),
                HyperAction::ChannelSetupCancelled(error) => ("HYPER_CHANNEL_SETUP_CANCELLED", error_json(error)),
                HyperAction::ChannelSetupFailed(error) => ("HYPER_CHANNEL_SETUP_FAILED", error_json(error)),
                HyperAction::ChannelReady { channel, params } => {
                    ("HYPER_CHANNEL_READY", json!({ "channel": channel, "params": params }))
                }
            };
            ("hyper", kind, value)
        }
        _ => return None,
    };
    Some(json!({ "connector": connector, "type": kind, "value": value }))
}

/// An action of a setup from the name of its type and its value, as `setup_action_json` writes them, for a connection
/// of a connector: the name of an action is unique per connector. A channel is the id that the host gave the channel of
/// a ready action, a token the JSON of the token.
pub fn setup_action_from_json(connector: ConnectorType, kind: &str, value: &Value, channel: Option<ChannelId>) -> Result<ConnectionAction, String> {
    let error = || -> DetailedError {
        let message = value.get("message").and_then(Value::as_str).unwrap_or_default().to_string();
        let data = value
            .get("data")
            .and_then(Value::as_object)
            .map(|data| data.iter().filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        DetailedError { message, data }
    };
    let params = || -> JsonObject { value.as_object().cloned().unwrap_or_default() };
    let text = |key: &str| value.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    let pkce = || OAuthPkceChallenge { value: text("value"), verifier: text("verifier") };
    let code = || TemporaryToken { token: text("token"), created_at: text("createdAt") };
    // A token is opaque JSON, a string stays the string
    let token = || match value {
        Value::String(token) => token.clone(),
        token => token.to_string(),
    };
    let channel = || channel.ok_or_else(|| format!("the action {kind} has no channel"));
    let action = match (kind, connector) {
        ("HEALTH_CHECK_STARTED", _) => ConnectionAction::HealthCheckStarted,
        ("HEALTH_CHECK_CANCELLED", _) => ConnectionAction::HealthCheckCancelled,
        ("HEALTH_CHECK_SUCCEEDED", _) => ConnectionAction::HealthCheckSucceeded,
        ("HEALTH_CHECK_FAILED", _) => ConnectionAction::HealthCheckFailed(error()),
        ("HYPER_CHANNEL_SETUP_STARTED", _) => ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params() }),
        ("HYPER_CHANNEL_SETUP_CANCELLED", _) => ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error())),
        ("HYPER_CHANNEL_SETUP_FAILED", _) => ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error())),
        ("HYPER_CHANNEL_READY", _) => ConnectionAction::Hyper(HyperAction::ChannelReady { channel: channel()?, params: params() }),
        ("TRINO_CHANNEL_SETUP_STARTED", _) => ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params: params() }),
        ("TRINO_CHANNEL_SETUP_CANCELLED", _) => ConnectionAction::Trino(TrinoAction::ChannelSetupCancelled(error())),
        ("TRINO_CHANNEL_SETUP_FAILED", _) => ConnectionAction::Trino(TrinoAction::ChannelSetupFailed(error())),
        ("TRINO_CHANNEL_READY", _) => ConnectionAction::Trino(TrinoAction::ChannelReady(channel()?)),
        ("SF_CHANNEL_SETUP_STARTED", _) => ConnectionAction::Salesforce(SalesforceAction::ChannelSetupStarted),
        ("SF_CHANNEL_SETUP_CANCELLED", _) => ConnectionAction::Salesforce(SalesforceAction::ChannelSetupCancelled(error())),
        ("SF_CHANNEL_SETUP_FAILED", _) => ConnectionAction::Salesforce(SalesforceAction::ChannelSetupFailed(error())),
        ("SF_CHANNEL_READY", _) => ConnectionAction::Salesforce(SalesforceAction::ChannelReady(channel()?)),
        (kind, ConnectorType::Trino) => ConnectionAction::Trino(match kind {
            "OAUTH_STARTED" => TrinoAction::OAuthStarted { params: params() },
            "OAUTH_CANCELLED" => TrinoAction::OAuthCancelled(error()),
            "OAUTH_FAILED" => TrinoAction::OAuthFailed(error()),
            "GENERATING_PKCE_CHALLENGE" => TrinoAction::GeneratingPkceChallenge,
            "GENERATED_PKCE_CHALLENGE" => TrinoAction::GeneratedPkceChallenge(pkce()),
            "OAUTH_BROWSER_OPENED" => TrinoAction::OAuthBrowserOpened,
            "RECEIVED_OAUTH_CODE" => TrinoAction::ReceivedOAuthCode(code()),
            "REQUESTING_ACCESS_TOKEN" => TrinoAction::RequestingAccessToken,
            "RECEIVED_ACCESS_TOKEN" => TrinoAction::ReceivedAccessToken(token()),
            _ => return Err(format!("unknown action {kind} of a Trino connection")),
        }),
        (kind, ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom) => ConnectionAction::Salesforce(match kind {
            "SETUP_STARTED" => SalesforceAction::SetupStarted { params: params() },
            "SETUP_CANCELLED" => SalesforceAction::SetupCancelled(error()),
            "SETUP_FAILED" => SalesforceAction::SetupFailed(error()),
            "GENERATING_PKCE_CHALLENGE" => SalesforceAction::GeneratingPkceChallenge,
            "GENERATED_PKCE_CHALLENGE" => SalesforceAction::GeneratedPkceChallenge(pkce()),
            "OAUTH_NATIVE_LINK_OPENED" => SalesforceAction::OAuthNativeLinkOpened,
            "OAUTH_WEB_WINDOW_OPENED" => SalesforceAction::OAuthWebWindowOpened,
            "OAUTH_WEB_WINDOW_CLOSED" => SalesforceAction::OAuthWebWindowClosed,
            "RECEIVED_CORE_AUTH_CODE" => SalesforceAction::ReceivedCoreAuthCode(code()),
            "REQUESTING_CORE_AUTH_TOKEN" => SalesforceAction::RequestingCoreAuthToken,
            "RECEIVED_CORE_AUTH_TOKEN" => SalesforceAction::ReceivedCoreAuthToken(token()),
            "RECEIVED_CORE_USER_INFO" => SalesforceAction::ReceivedCoreUserInfo {
                preferred_username: value.get("preferredUsername").and_then(Value::as_str).map(str::to_string),
                email: value.get("email").and_then(Value::as_str).map(str::to_string),
            },
            "REQUESTING_DATA_CLOUD_ACCESS_TOKEN" => SalesforceAction::RequestingDataCloudAccessToken,
            "RECEIVED_DATA_CLOUD_ACCESS_TOKEN" => SalesforceAction::ReceivedDataCloudAccessToken(token()),
            _ => return Err(format!("unknown action {kind} of a Salesforce connection")),
        }),
        (kind, connector) => return Err(format!("unknown action {kind} of a connection of {}", connector.display_name())),
    };
    Ok(action)
}

/// The outcome of a host call that the token may stop: none if it was cancelled
pub(crate) async fn cancellable<T>(
    cancellation: &CancellationToken,
    call: impl Future<Output = Result<T, HostError>>,
) -> Option<Result<T, HostError>> {
    if cancellation.is_cancelled() {
        return None;
    }
    cancellation.run(call).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_actions_that_it_writes() {
        let error = DetailedError { message: "nope".into(), data: BTreeMap::from([("status".to_string(), "401".to_string())]) };
        let params: JsonObject = serde_json::from_value(json!({ "endpoint": "https://trino.example" })).unwrap();
        let actions = [
            (ConnectorType::Hyper, ConnectionAction::HealthCheckFailed(error.clone())),
            (ConnectorType::Hyper, ConnectionAction::Hyper(HyperAction::ChannelReady { channel: 3, params: params.clone() })),
            (ConnectorType::Trino, ConnectionAction::Trino(TrinoAction::OAuthStarted { params: params.clone() })),
            (ConnectorType::Trino, ConnectionAction::Trino(TrinoAction::ReceivedAccessToken(r#"{"accessToken":"t"}"#.into()))),
            (ConnectorType::Trino, ConnectionAction::Trino(TrinoAction::ChannelReady(4))),
            (
                ConnectorType::Dbcom,
                ConnectionAction::Salesforce(SalesforceAction::GeneratedPkceChallenge(OAuthPkceChallenge {
                    value: "v".into(),
                    verifier: "w".into(),
                })),
            ),
            (
                ConnectorType::SalesforceDataCloud,
                ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreUserInfo { preferred_username: Some("me".into()), email: None }),
            ),
            (ConnectorType::SalesforceDataCloud, ConnectionAction::Salesforce(SalesforceAction::ChannelSetupFailed(error))),
        ];
        for (connector, action) in actions {
            let json = setup_action_json(&action).unwrap();
            let kind = json["type"].as_str().unwrap();
            let channel = match &action {
                ConnectionAction::Hyper(HyperAction::ChannelReady { channel, .. }) => Some(*channel),
                ConnectionAction::Trino(TrinoAction::ChannelReady(channel)) => Some(*channel),
                _ => None,
            };
            // The channel of a ready action of Hyper comes next to its params
            let value = if kind == "HYPER_CHANNEL_READY" { json["value"]["params"].clone() } else { json["value"].clone() };
            assert_eq!(setup_action_from_json(connector, kind, &value, channel), Ok(action));
        }
        assert!(setup_action_from_json(ConnectorType::Hyper, "OAUTH_STARTED", &Value::Null, None).is_err());
        assert!(setup_action_from_json(ConnectorType::Trino, "TRINO_CHANNEL_READY", &Value::Null, None).is_err());
    }
}
