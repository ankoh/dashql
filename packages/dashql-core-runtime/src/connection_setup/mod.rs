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
//! of Hyper stay objects of the host: a Hyper channel over HTTP describes itself, the gRPC channel of the desktop app and
//! the embedded Hyper run their queries in the host. A Trino channel is owned by its connection, the host keeps a handle.
//!
//! A cancelled setup ends at the next step: the token stops the host call that runs, the state machine reports the
//! cancellation as an action of the connection. A failed host call keeps what the host failed with, the caller gets it
//! back unchanged.

pub mod health_check;
pub mod hyper;
pub mod oauth;
pub mod salesforce;
pub mod trino;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::future::Future;
use std::rc::Rc;

use serde_json::{json, Value};

use crate::connections::{
    ChannelId, ConnectionAction, DetailedError, HyperAction, JsonObject, SalesforceAction, TrinoAction,
};
use crate::executor::HostValue;
use crate::host::signal::oneshot;
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
    /// A handle for a Trino channel, returns its id. The connection owns the channel itself (`TrinoAction::ChannelReady`),
    /// the host keeps only a handle that the connection releases with the channel.
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
    /// The details of what the host failed with, e.g. the key values of an error of Hyper, for the error of the
    /// connection
    fn error_details(&self, _error: &HostError) -> BTreeMap<String, String> {
        BTreeMap::new()
    }
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
        // Not a step of a setup
        ConnectionAction::Trino(TrinoAction::AccessTokenRefreshed { .. }) => return None,
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
                TrinoAction::ChannelReady { channel, .. } => ("TRINO_CHANNEL_READY", json!(channel)),
                TrinoAction::AccessTokenRefreshed { .. } => return None,
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

/// Connect a channel through the host, the token stops the wait: none if it was cancelled first. The connect runs on in
/// a task of its own, a channel that it connects after the setup stopped waiting is closed.
pub(crate) async fn connect_channel<H: SetupHost>(
    host: &Rc<H>,
    connect: impl Future<Output = Result<ChannelId, HostError>> + 'static,
    cancellation: &CancellationToken,
) -> Option<Result<ChannelId, HostError>> {
    struct Slot {
        result: Option<Result<ChannelId, HostError>>,
        abandoned: bool,
    }
    let slot = Rc::new(RefCell::new(Slot { result: None, abandoned: false }));
    let (sender, connected) = oneshot::<()>();
    {
        let slot = slot.clone();
        let host = host.clone();
        host.clone().spawn(Box::pin(async move {
            let result = connect.await;
            let close = {
                let Ok(mut slot) = slot.try_borrow_mut() else { return };
                if slot.abandoned {
                    result.ok()
                } else {
                    slot.result = Some(result);
                    None
                }
            };
            match close {
                Some(channel) => host.close_channel(channel),
                None => sender.send(()),
            }
        }));
    }
    let _ = cancellation.run(connected).await;
    let mut slot = slot.borrow_mut();
    // A channel that is connected already goes to the setup, which closes it if it was cancelled
    if let Some(result) = slot.result.take() {
        return Some(result);
    }
    slot.abandoned = true;
    if cancellation.is_cancelled() {
        None
    } else {
        Some(Err(HostError::new("The connect of the channel ended without a channel")))
    }
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
