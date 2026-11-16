//! The setup of a Salesforce Data Cloud or Database.com connection: the OAuth flow of the core login, the Data Cloud
//! token and the channel.

use serde_json::Value;

use super::details::{
    replace_channel, ConnectionChannel, ConnectionDetails, ConnectorDetails, DetailedError, SalesforceOAuthParams,
    Timestamp,
};
use crate::salesforce::SharedSalesforceChannel;
use super::params::{string_field, JsonObject};
use super::{ConnectionEffect, ConnectionHealth, ConnectionState, ConnectionStatus};

/// How long an OAuth flow of Salesforce is valid
const OAUTH_FLOW_LIFETIME_MS: Timestamp = 2.0 * 60.0 * 60.0 * 1000.0;

/// An action of the setup of a Salesforce connection
#[derive(Debug, Clone, PartialEq)]
pub enum SalesforceAction {
    /// The setup started with the params of the connector. The steps of an earlier OAuth flow stay.
    SetupStarted { params: JsonObject },
    /// The setup was cancelled
    SetupCancelled(DetailedError),
    /// The setup failed
    SetupFailed(DetailedError),
    /// The PKCE challenge is being generated
    GeneratingPkceChallenge,
    /// The PKCE challenge was generated, the setup keeps it
    GeneratedPkceChallenge,
    /// The native app opened the login link
    OAuthNativeLinkOpened,
    /// The web app opened the login window
    OAuthWebWindowOpened,
    /// The login window was closed
    OAuthWebWindowClosed,
    /// The code of the core login arrived at a time, the setup exchanges it
    ReceivedCoreAuthCode { created_at: String },
    /// The core access token was requested
    RequestingCoreAuthToken,
    /// The core access token arrived, the setup keeps it until the channel takes it
    ReceivedCoreAuthToken,
    /// The user info of the core login arrived, the username or the email becomes the login of the setup params
    ReceivedCoreUserInfo { preferred_username: Option<String>, email: Option<String> },
    /// The Data Cloud access token was requested
    RequestingDataCloudAccessToken,
    /// The Data Cloud access token arrived, the setup keeps it until the channel takes it
    ReceivedDataCloudAccessToken,
    /// The channel setup started
    ChannelSetupStarted,
    /// The channel setup was cancelled
    ChannelSetupCancelled(DetailedError),
    /// The channel setup failed
    ChannelSetupFailed(DetailedError),
    /// The channel is ready with the tokens of the login, the connection waits for the health check. The connection owns
    /// the channel with the tokens from now on.
    ChannelReady(SharedSalesforceChannel),
}

impl SalesforceAction {
    /// The status and health of a connection after the action, none if the action keeps them
    fn status(&self) -> Option<(ConnectionStatus, ConnectionHealth)> {
        use ConnectionHealth::*;
        Some(match self {
            SalesforceAction::SetupStarted { .. } => (ConnectionStatus::AuthStarted, Connecting),
            SalesforceAction::SetupCancelled(_) => (ConnectionStatus::AuthCancelled, Cancelled),
            SalesforceAction::SetupFailed(_) => (ConnectionStatus::AuthFailed, Failed),
            SalesforceAction::GeneratingPkceChallenge => (ConnectionStatus::PkceGenerationStarted, Connecting),
            SalesforceAction::GeneratedPkceChallenge => (ConnectionStatus::PkceGenerated, Connecting),
            SalesforceAction::OAuthNativeLinkOpened => (ConnectionStatus::WaitingForOAuthCodeViaLink, Connecting),
            SalesforceAction::OAuthWebWindowOpened => (ConnectionStatus::WaitingForOAuthCodeViaWindow, Connecting),
            SalesforceAction::ReceivedCoreAuthCode { .. } => (ConnectionStatus::OAuthCodeReceived, Connecting),
            SalesforceAction::RequestingCoreAuthToken => (ConnectionStatus::AccessTokenRequested, Connecting),
            SalesforceAction::ReceivedCoreAuthToken => (ConnectionStatus::CoreAccessTokenReceived, Connecting),
            SalesforceAction::RequestingDataCloudAccessToken => (ConnectionStatus::DataCloudTokenRequested, Connecting),
            SalesforceAction::ReceivedDataCloudAccessToken => (ConnectionStatus::DataCloudTokenReceived, Connecting),
            SalesforceAction::ChannelSetupStarted => (ConnectionStatus::ChannelSetupStarted, Connecting),
            SalesforceAction::ChannelSetupCancelled(_) => (ConnectionStatus::ChannelSetupCancelled, Cancelled),
            SalesforceAction::ChannelSetupFailed(_) => (ConnectionStatus::ChannelSetupFailed, Failed),
            SalesforceAction::ChannelReady(_) => (ConnectionStatus::ChannelReady, Connecting),
            SalesforceAction::OAuthWebWindowClosed | SalesforceAction::ReceivedCoreUserInfo { .. } => return None,
        })
    }
}

/// Apply an action of the setup to a Salesforce connection. The caller checked that the connection is one of
/// Salesforce or Database.com.
pub(super) fn reduce(
    state: &mut ConnectionState,
    action: SalesforceAction,
    now: Timestamp,
    effects: &mut Vec<ConnectionEffect>,
) {
    let ConnectionDetails { setup_timings: timings, setup_params, channel_error, health_check_error, channel, connector } =
        &mut state.details;
    let (ConnectorDetails::SalesforceDataCloud(salesforce) | ConnectorDetails::Dbcom(salesforce)) = connector else {
        return;
    };
    if let Some((status, health)) = action.status() {
        state.status = status;
        state.health = health;
    }
    match action {
        SalesforceAction::SetupStarted { params } => {
            timings.auth_started_at = Some(now);
            let oauth_params = SalesforceOAuthParams {
                instance_url: string_field(&params, "instanceUrl").unwrap_or("").to_string(),
                app_consumer_key: string_field(&params, "appConsumerKey").unwrap_or("").to_string(),
                requested_at: now,
                expires_at: now + OAUTH_FLOW_LIFETIME_MS,
            };
            *setup_params = Some(params);
            salesforce.setup_error = None;
            salesforce.principal = None;
            *channel_error = None;
            *health_check_error = None;
            salesforce.oauth_state.get_or_insert_with(Default::default).oauth_params = Some(oauth_params);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::SetupCancelled(error) => {
            timings.auth_cancelled_at = Some(now);
            salesforce.setup_error = Some(error);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::SetupFailed(error) => {
            timings.auth_failed_at = Some(now);
            salesforce.setup_error = Some(error);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::GeneratingPkceChallenge => {
            timings.pkce_gen_started_at = Some(now);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::GeneratedPkceChallenge => {
            timings.pkce_gen_finished_at = Some(now);
            salesforce.oauth_state.get_or_insert_with(Default::default).pkce_generated = true;
        }
        SalesforceAction::OAuthNativeLinkOpened => timings.opened_native_auth_link_at = Some(now),
        SalesforceAction::OAuthWebWindowOpened => timings.opened_web_auth_window_at = Some(now),
        SalesforceAction::OAuthWebWindowClosed => timings.closed_web_auth_window_at = Some(now),
        SalesforceAction::ReceivedCoreAuthCode { created_at } => {
            timings.oauth_code_received_at = Some(now);
            salesforce.oauth_state.get_or_insert_with(Default::default).core_auth_code_received_at = Some(created_at);
        }
        SalesforceAction::RequestingCoreAuthToken => timings.core_access_token_requested_at = Some(now),
        SalesforceAction::ReceivedCoreAuthToken => timings.core_access_token_received_at = Some(now),
        SalesforceAction::ReceivedCoreUserInfo { preferred_username, email } => {
            // The account becomes the login hint of the next connects and of shared links and files, and the principal
            // of the cached results of the connection
            let account = preferred_username.or(email).filter(|account| !account.is_empty());
            salesforce.principal = account.clone();
            if let Some(params) = setup_params {
                let login = account.or_else(|| string_field(params, "login").map(str::to_string)).unwrap_or_default();
                params.insert("login".to_string(), Value::String(login));
            }
        }
        SalesforceAction::RequestingDataCloudAccessToken => timings.data_cloud_access_token_requested_at = Some(now),
        SalesforceAction::ReceivedDataCloudAccessToken => timings.data_cloud_access_token_received_at = Some(now),
        SalesforceAction::ChannelSetupStarted => {
            timings.channel_setup_started_at = Some(now);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::ChannelSetupCancelled(error) => {
            timings.channel_setup_cancelled_at = Some(now);
            *channel_error = Some(error);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::ChannelSetupFailed(error) => {
            timings.channel_setup_failed_at = Some(now);
            *channel_error = Some(error);
            replace_channel(channel, None, effects);
        }
        SalesforceAction::ChannelReady(ready) => {
            timings.channel_ready_at = Some(now);
            replace_channel(channel, Some(ConnectionChannel::Salesforce(ready)), effects);
        }
    }
}
