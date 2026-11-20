//! The details of a connection: how far its setup got, its errors and its channel.
//!
//! Every connector keeps the setup timings, the params of the setup, the errors of the channel and the health check
//! and the channel. Trino and Salesforce add their OAuth state.

use std::collections::BTreeMap;
use std::fmt;

use super::params::{ConnectionParams, ConnectorType, JsonObject};
use super::ConnectionEffect;
use crate::http::Headers;
use crate::hyper::HyperHttpChannel;
use crate::salesforce::SharedSalesforceChannel;
use crate::trino::SharedTrinoChannel;

/// Milliseconds since the Unix epoch. The host passes the time with an action, the reducer reads no clock.
pub type Timestamp = f64;

/// A channel of the host. The channel of a connection is a handle of the host (`crate::handles`), a setup names the
/// channels of its run by ids of the run.
pub type ChannelId = crate::handles::Handle;

/// An error with a message and optional details, e.g. a failed channel setup
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetailedError {
    /// The error message
    pub message: String,
    /// The details, empty without any
    pub data: BTreeMap<String, String>,
}

impl DetailedError {
    /// An error with a message
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), data: BTreeMap::new() }
    }
}

/// When the steps of the setup of a connection happened. A connector sets only the timings of its steps.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SetupTimings {
    pub channel_setup_started_at: Option<Timestamp>,
    pub channel_setup_cancelled_at: Option<Timestamp>,
    pub channel_setup_failed_at: Option<Timestamp>,
    pub channel_ready_at: Option<Timestamp>,
    pub health_check_started_at: Option<Timestamp>,
    pub health_check_cancelled_at: Option<Timestamp>,
    pub health_check_failed_at: Option<Timestamp>,
    pub health_check_succeeded_at: Option<Timestamp>,
    /// Salesforce
    pub auth_started_at: Option<Timestamp>,
    pub auth_cancelled_at: Option<Timestamp>,
    pub auth_failed_at: Option<Timestamp>,
    pub opened_native_auth_link_at: Option<Timestamp>,
    pub opened_web_auth_window_at: Option<Timestamp>,
    pub closed_web_auth_window_at: Option<Timestamp>,
    pub core_access_token_requested_at: Option<Timestamp>,
    pub core_access_token_received_at: Option<Timestamp>,
    pub data_cloud_access_token_requested_at: Option<Timestamp>,
    pub data_cloud_access_token_received_at: Option<Timestamp>,
    /// Trino
    pub oauth_started_at: Option<Timestamp>,
    pub oauth_cancelled_at: Option<Timestamp>,
    pub oauth_failed_at: Option<Timestamp>,
    pub oauth_browser_opened_at: Option<Timestamp>,
    pub access_token_requested_at: Option<Timestamp>,
    pub access_token_received_at: Option<Timestamp>,
    /// Trino and Salesforce
    pub pkce_gen_started_at: Option<Timestamp>,
    pub pkce_gen_finished_at: Option<Timestamp>,
    pub oauth_code_received_at: Option<Timestamp>,
}

/// The PKCE challenge of an OAuth flow. The setup that generated it keeps it, the connection only learns that it was
/// generated.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OAuthPkceChallenge {
    /// The challenge
    pub value: String,
    /// The verifier
    pub verifier: String,
}

/// A short-lived token, e.g. the code of an OAuth flow
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TemporaryToken {
    /// The token
    pub token: String,
    /// When the token was created, as the host wrote it
    pub created_at: String,
}

/// The OAuth flow of a Trino connection. The PKCE verifier and the code stay with the setup that exchanges them, the
/// access token with the channel.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrinoOAuthState {
    /// Was the PKCE challenge generated?
    pub pkce_generated: bool,
    /// When the code of the authorization server arrived
    pub auth_code_received_at: Option<String>,
}

/// The parameters of the OAuth flow of a Salesforce connection
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SalesforceOAuthParams {
    /// The instance
    pub instance_url: String,
    /// The connected app
    pub app_consumer_key: String,
    /// When the flow was requested
    pub requested_at: Timestamp,
    /// When the flow expires, two hours after the request
    pub expires_at: Timestamp,
}

/// The OAuth flow of a Salesforce connection. The PKCE verifier and the code stay with the setup that exchanges them,
/// the tokens with the channel.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SalesforceOAuthState {
    /// The parameters of the flow
    pub oauth_params: Option<SalesforceOAuthParams>,
    /// Was the PKCE challenge generated?
    pub pkce_generated: bool,
    /// When the code of the core login arrived
    pub core_auth_code_received_at: Option<String>,
}

/// The details of a Trino connection
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrinoDetails {
    /// The error of resolving the schemas
    pub schema_resolution_error: Option<DetailedError>,
    /// The OAuth flow
    pub oauth_state: Option<TrinoOAuthState>,
}

/// The details of a Salesforce or Database.com connection
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SalesforceDetails {
    /// The error of the login
    pub setup_error: Option<DetailedError>,
    /// The OAuth flow
    pub oauth_state: Option<SalesforceOAuthState>,
    /// The account of the login as the user info of Salesforce named it, none while the login didn't resolve it. The
    /// login of the params may be a hint that the user typed.
    pub principal: Option<String>,
}

/// The channel of a connection once it is ready. The connection owns it: a channel that the connection replaces or lets
/// go of is closed.
#[derive(Clone, PartialEq)]
pub enum ConnectionChannel {
    /// A channel of the host by its handle: the embedded Hyper, or Hyper over gRPC through the native proxy
    Host(ChannelId),
    /// A Trino server, with the auth and the access token
    Trino(SharedTrinoChannel),
    /// The HTTP API of a Hyper with the headers of every request, e.g. the token of a link
    HyperHttp { channel: HyperHttpChannel, auth: Headers },
    /// The Hyper of Data Cloud with the tokens of the Salesforce login
    Salesforce(SharedSalesforceChannel),
}

impl ConnectionChannel {
    /// Refresh the credentials of the channel that are about to expire: the Data Cloud token of a Salesforce channel.
    /// The other channels hold no credentials that expire, or refresh them as their queries need it (Trino).
    pub async fn fresh<H: crate::http::HttpHost>(&self, host: &std::rc::Rc<H>) -> Result<(), String> {
        match self {
            ConnectionChannel::Salesforce(channel) => channel.fresh(host).await,
            ConnectionChannel::Host(_) | ConnectionChannel::Trino(_) | ConnectionChannel::HyperHttp { .. } => Ok(()),
        }
    }

    /// The handle of a channel of the host, none for the channels that the connection speaks itself
    pub fn host_handle(&self) -> Option<ChannelId> {
        match self {
            ConnectionChannel::Host(handle) => Some(*handle),
            _ => None,
        }
    }

    /// The Trino channel, none for other channels
    pub fn trino(&self) -> Option<&SharedTrinoChannel> {
        match self {
            ConnectionChannel::Trino(channel) => Some(channel),
            _ => None,
        }
    }

    /// The Salesforce channel, none for other channels
    pub fn salesforce(&self) -> Option<&SharedSalesforceChannel> {
        match self {
            ConnectionChannel::Salesforce(channel) => Some(channel),
            _ => None,
        }
    }
}

/// Names the kind only, never the credentials
impl fmt::Debug for ConnectionChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConnectionChannel::Host(handle) => f.debug_tuple("Host").field(handle).finish(),
            ConnectionChannel::Trino(channel) => f.debug_tuple("Trino").field(channel).finish(),
            ConnectionChannel::HyperHttp { channel, .. } => {
                f.debug_struct("HyperHttp").field("endpoint", &channel.client().endpoint().to_string()).finish()
            }
            ConnectionChannel::Salesforce(channel) => f.debug_tuple("Salesforce").field(channel).finish(),
        }
    }
}

/// The details that only one connector keeps
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectorDetails {
    Hyper,
    SalesforceDataCloud(SalesforceDetails),
    Trino(TrinoDetails),
    Dbcom(SalesforceDetails),
}

/// The catalog and schema of the relations that unqualified statements create or drop
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogNameDefaults {
    /// The database, empty if there is none
    pub database_name: String,
    /// The schema, empty if there is none
    pub schema_name: String,
}

/// The details of a connection
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionDetails {
    /// When the steps of the setup happened
    pub setup_timings: SetupTimings,
    /// The params of the connector that the setup uses, the params of the connector without the field around them
    pub setup_params: Option<JsonObject>,
    /// The error of the channel setup
    pub channel_error: Option<DetailedError>,
    /// The error of the health check
    pub health_check_error: Option<DetailedError>,
    /// The channel, once it is ready
    pub channel: Option<ConnectionChannel>,
    /// The details of the connector
    pub connector: ConnectorDetails,
}

impl ConnectionDetails {
    /// The details of a connection with params
    pub fn new(params: &ConnectionParams) -> Self {
        let connector = match params.connector {
            ConnectorType::Hyper => ConnectorDetails::Hyper,
            ConnectorType::SalesforceDataCloud => ConnectorDetails::SalesforceDataCloud(SalesforceDetails::default()),
            ConnectorType::Trino => ConnectorDetails::Trino(TrinoDetails::default()),
            ConnectorType::Dbcom => ConnectorDetails::Dbcom(SalesforceDetails::default()),
        };
        Self {
            setup_timings: SetupTimings::default(),
            setup_params: Some(params.params.clone()),
            channel_error: None,
            health_check_error: None,
            channel: None,
            connector,
        }
    }

    /// The details of a new connection of a connector
    pub fn default_for(connector: ConnectorType) -> Self {
        Self::new(&ConnectionParams::default_for(connector))
    }

    /// The connector
    pub fn connector_type(&self) -> ConnectorType {
        match self.connector {
            ConnectorDetails::Hyper => ConnectorType::Hyper,
            ConnectorDetails::SalesforceDataCloud(_) => ConnectorType::SalesforceDataCloud,
            ConnectorDetails::Trino(_) => ConnectorType::Trino,
            ConnectorDetails::Dbcom(_) => ConnectorType::Dbcom,
        }
    }

    /// The setup params as connection params
    pub fn connection_params(&self) -> Option<ConnectionParams> {
        self.setup_params.as_ref().map(|params| ConnectionParams::new(self.connector_type(), params.clone()))
    }

    /// The details of Trino, none for other connectors
    pub fn trino(&self) -> Option<&TrinoDetails> {
        match &self.connector {
            ConnectorDetails::Trino(details) => Some(details),
            _ => None,
        }
    }

    /// The details of Salesforce or Database.com, none for other connectors
    pub fn salesforce(&self) -> Option<&SalesforceDetails> {
        match &self.connector {
            ConnectorDetails::SalesforceDataCloud(details) | ConnectorDetails::Dbcom(details) => Some(details),
            _ => None,
        }
    }

    pub(crate) fn trino_mut(&mut self) -> Option<&mut TrinoDetails> {
        match &mut self.connector {
            ConnectorDetails::Trino(details) => Some(details),
            _ => None,
        }
    }

    pub(crate) fn salesforce_mut(&mut self) -> Option<&mut SalesforceDetails> {
        match &mut self.connector {
            ConnectorDetails::SalesforceDataCloud(details) | ConnectorDetails::Dbcom(details) => Some(details),
            _ => None,
        }
    }

    /// The database and schema of the relations that unqualified statements create or drop. They match the names that
    /// the catalog loader gives the relations of the connection.
    pub fn catalog_name_defaults(&self) -> CatalogNameDefaults {
        self.connector_type().connector().catalog_name_defaults(self.setup_params.as_ref())
    }

    /// Clear the errors of the setup, false if there were none
    pub(crate) fn clear_errors(&mut self) -> bool {
        let mut cleared = self.channel_error.take().is_some() | self.health_check_error.take().is_some();
        if let Some(trino) = self.trino_mut() {
            cleared |= trino.schema_resolution_error.take().is_some();
        }
        if let Some(salesforce) = self.salesforce_mut() {
            cleared |= salesforce.setup_error.take().is_some();
        }
        cleared
    }

    /// Reset the setup of a connection that is reset or deleted: close the channel, forget the timings, the errors,
    /// the OAuth flows and the account of a login. The setup params stay.
    pub(crate) fn reset(&mut self, effects: &mut Vec<ConnectionEffect>) {
        replace_channel(&mut self.channel, None, effects);
        self.setup_timings = SetupTimings::default();
        self.channel_error = None;
        self.health_check_error = None;
        match &mut self.connector {
            ConnectorDetails::Hyper => {}
            ConnectorDetails::Trino(trino) => trino.oauth_state = None,
            ConnectorDetails::SalesforceDataCloud(salesforce) | ConnectorDetails::Dbcom(salesforce) => {
                salesforce.setup_error = None;
                salesforce.oauth_state = None;
                salesforce.principal = None;
            }
        }
    }
}

/// Replace the channel of a connection. The connection owns its channels: a channel of the host that it replaces is
/// closed, one that it speaks itself goes with it.
pub(crate) fn replace_channel(
    slot: &mut Option<ConnectionChannel>,
    channel: Option<ConnectionChannel>,
    effects: &mut Vec<ConnectionEffect>,
) {
    let previous = std::mem::replace(slot, channel);
    let kept = slot.as_ref().and_then(ConnectionChannel::host_handle);
    if let Some(handle) =
        previous.as_ref().and_then(ConnectionChannel::host_handle).filter(|handle| Some(*handle) != kept)
    {
        effects.push(ConnectionEffect::Close { handle });
    }
}
