//! The setup of a Trino connection: an optional OAuth flow and the channel.

use super::details::{
    replace_channel, ConnectionChannel, ConnectionDetails, ConnectorDetails, DetailedError, SetupTimings, Timestamp,
    TrinoOAuthState,
};
use super::params::JsonObject;
use super::{ConnectionEffect, ConnectionHealth, ConnectionState, ConnectionStatus};
use crate::trino::SharedTrinoChannel;

/// An action of the setup of a Trino connection
#[derive(Debug, Clone, PartialEq)]
pub enum TrinoAction {
    /// The OAuth flow started with the params of the connector, it starts a new OAuth state
    OAuthStarted { params: JsonObject },
    /// The OAuth flow was cancelled. The error is not kept.
    OAuthCancelled(DetailedError),
    /// The OAuth flow failed
    OAuthFailed(DetailedError),
    /// The PKCE challenge is being generated
    GeneratingPkceChallenge,
    /// The PKCE challenge was generated, the setup keeps it
    GeneratedPkceChallenge,
    /// The browser opened the login
    OAuthBrowserOpened,
    /// The code of the login arrived at a time, the setup exchanges it
    ReceivedOAuthCode { created_at: String },
    /// The access token was requested
    RequestingAccessToken,
    /// The access token arrived, the channel gets it
    ReceivedAccessToken,
    /// The channel setup started with the params of the connector
    ChannelSetupStarted { params: JsonObject },
    /// The channel setup was cancelled. The error is not kept.
    ChannelSetupCancelled(DetailedError),
    /// The channel setup failed
    ChannelSetupFailed(DetailedError),
    /// The channel is ready, the connection waits for the health check. The connection owns the channel with its
    /// access token from now on.
    ChannelReady(SharedTrinoChannel),
}

impl TrinoAction {
    /// The status and health of a connection after the action
    fn status(&self) -> (ConnectionStatus, ConnectionHealth) {
        use ConnectionHealth::*;
        match self {
            TrinoAction::OAuthStarted { .. } => (ConnectionStatus::AuthStarted, Connecting),
            TrinoAction::OAuthCancelled(_) => (ConnectionStatus::AuthCancelled, Cancelled),
            TrinoAction::OAuthFailed(_) => (ConnectionStatus::AuthFailed, Failed),
            TrinoAction::GeneratingPkceChallenge => (ConnectionStatus::PkceGenerationStarted, Connecting),
            TrinoAction::GeneratedPkceChallenge => (ConnectionStatus::PkceGenerated, Connecting),
            TrinoAction::OAuthBrowserOpened => (ConnectionStatus::WaitingForOAuthCodeViaLink, Connecting),
            TrinoAction::ReceivedOAuthCode { .. } => (ConnectionStatus::OAuthCodeReceived, Connecting),
            TrinoAction::RequestingAccessToken => (ConnectionStatus::AccessTokenRequested, Connecting),
            TrinoAction::ReceivedAccessToken => (ConnectionStatus::AccessTokenReceived, Connecting),
            TrinoAction::ChannelSetupStarted { .. } => (ConnectionStatus::ChannelSetupStarted, Connecting),
            TrinoAction::ChannelSetupCancelled(_) => (ConnectionStatus::ChannelSetupCancelled, Cancelled),
            TrinoAction::ChannelSetupFailed(_) => (ConnectionStatus::ChannelSetupFailed, Failed),
            TrinoAction::ChannelReady(_) => (ConnectionStatus::ChannelReady, Connecting),
        }
    }
}

/// Apply an action of the setup to a Trino connection. The caller checked that the connection is one of Trino.
pub(super) fn reduce(state: &mut ConnectionState, action: TrinoAction, now: Timestamp, effects: &mut Vec<ConnectionEffect>) {
    let ConnectionDetails { setup_timings: timings, setup_params, channel_error, health_check_error, channel, connector } =
        &mut state.details;
    let ConnectorDetails::Trino(trino) = connector else {
        return;
    };
    (state.status, state.health) = action.status();
    match action {
        TrinoAction::OAuthStarted { params } => {
            // The timings start over, the schema resolution error stays
            *timings = SetupTimings { oauth_started_at: Some(now), ..Default::default() };
            *setup_params = Some(params);
            *channel_error = None;
            *health_check_error = None;
            trino.oauth_state = Some(TrinoOAuthState::default());
            replace_channel(channel, None, effects);
        }
        TrinoAction::OAuthCancelled(_) => {
            timings.oauth_cancelled_at = Some(now);
            replace_channel(channel, None, effects);
        }
        TrinoAction::OAuthFailed(error) => {
            timings.oauth_failed_at = Some(now);
            *channel_error = Some(error);
            replace_channel(channel, None, effects);
        }
        TrinoAction::GeneratingPkceChallenge => timings.pkce_gen_started_at = Some(now),
        TrinoAction::GeneratedPkceChallenge => {
            timings.pkce_gen_finished_at = Some(now);
            trino.oauth_state.get_or_insert_with(Default::default).pkce_generated = true;
        }
        TrinoAction::OAuthBrowserOpened => timings.oauth_browser_opened_at = Some(now),
        TrinoAction::ReceivedOAuthCode { created_at } => {
            timings.oauth_code_received_at = Some(now);
            trino.oauth_state.get_or_insert_with(Default::default).auth_code_received_at = Some(created_at);
        }
        TrinoAction::RequestingAccessToken => timings.access_token_requested_at = Some(now),
        TrinoAction::ReceivedAccessToken => timings.access_token_received_at = Some(now),
        TrinoAction::ChannelSetupStarted { params } => {
            timings.channel_setup_started_at = Some(now);
            *setup_params = Some(params);
            *channel_error = None;
            *health_check_error = None;
            trino.schema_resolution_error = None;
            replace_channel(channel, None, effects);
        }
        TrinoAction::ChannelSetupCancelled(_) => {
            timings.channel_setup_cancelled_at = Some(now);
            replace_channel(channel, None, effects);
        }
        TrinoAction::ChannelSetupFailed(error) => {
            timings.channel_setup_failed_at = Some(now);
            *channel_error = Some(error);
            replace_channel(channel, None, effects);
        }
        TrinoAction::ChannelReady(shared) => {
            timings.channel_ready_at = Some(now);
            replace_channel(channel, Some(ConnectionChannel::Trino(shared)), effects);
        }
    }
}
