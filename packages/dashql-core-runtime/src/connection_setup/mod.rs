//! The setups of the connectors and the health checks as async services on a host.
//!
//! A setup is an async function per connector (`setup_trino`, `setup_salesforce`, `setup_hyper`). It applies every
//! action of the connection through the host (`SetupHost::dispatch`), awaits the host for what it can't do itself and
//! hands the channel to the connection with the ready step. The health check runs its probe query through the query executor of
//! the host.
//!
//! - `oauth`: what an OAuth flow asks of the platform, the PKCE challenge, a random state and the authorization page with
//!   its callback (`OAuthHost`).
//! - `trino`, `salesforce`, `hyper`: the setups of the connectors.
//! - `health_check`: the probe query of a new channel.
//!
//! The host is one setup: it applies the actions to one connection. The connection owns its channel
//! (`ConnectionChannel`): Trino, Hyper over HTTP and the Hyper of Salesforce are channels that the module speaks
//! itself, only the gRPC channel of the desktop app and the embedded Hyper are objects of the host that it connects and
//! keeps under a handle. A login of Salesforce has no connection, its listener hears the names of its steps
//! (`salesforce::login_step_name`), the tokens are in its outcome.
//!
//! A cancelled setup ends at the next step: the token stops the host call that runs, the setup reports the cancellation
//! as an action of the connection. A failed host call keeps what the host failed with, the caller gets it
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

use serde_json::Value;

use crate::connections::{ChannelId, ConnectionAction, DetailedError};
use crate::executor::HostValue;
use crate::host::signal::oneshot;
use crate::host::HostError;
use crate::http::CancellationToken;
use crate::query::QueryMetadata;

pub use health_check::check_health;
pub use hyper::{setup_hyper, HyperChannelKind, HyperChannelRequest};
pub use oauth::{OAuthCallback, OAuthEvents, OAuthHost};
pub use salesforce::{authenticate_salesforce, login_step_name, setup_salesforce, SalesforceAuthentication};
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
    /// Connect a Hyper channel of the host of the kind of the request, the embedded Hyper or gRPC, returns its handle
    fn connect_hyper_channel(
        &self,
        channel: &HyperChannelRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ChannelId, HostError>> + 'static;
    /// The token of the link to a Hyper that the connection was opened with, none if the page doesn't hold it
    fn hyper_link_token(&self) -> Option<String>;
    /// The client context that Hyper logs with the queries of the connection, none without one
    fn client_context(&self) -> Option<Value> {
        None
    }
    /// Close a channel that the setup doesn't hand out, e.g. one that was ready after the setup was cancelled
    fn close_channel(&self, id: ChannelId);
    /// The details of what the host failed with, e.g. the key values of an error of Hyper, for the error of the
    /// connection
    fn error_details(&self, _error: &HostError) -> BTreeMap<String, String> {
        BTreeMap::new()
    }
    /// Run the probe query of a health check on the channel of the connection through the query executor, as a query of
    /// the connection
    fn run_probe(
        &self,
        query: &str,
        metadata: &QueryMetadata,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<ProbeResult, HostError>> + 'static;
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
