//! The setup of a Trino connection: an optional OAuth flow and the channel.
//!
//! Ported from `packages/dashql/src/runtime/connections/trino/trino_connection_state.ts`.

use super::details::{
    replace_channel, ChannelId, ConnectionDetails, ConnectorDetails, DetailedError, OAuthPkceChallenge, SetupTimings,
    TemporaryToken, Timestamp, TrinoOAuthState,
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
    /// The PKCE challenge was generated
    GeneratedPkceChallenge(OAuthPkceChallenge),
    /// The browser opened the login
    OAuthBrowserOpened,
    /// The code of the login arrived
    ReceivedOAuthCode(TemporaryToken),
    /// The access token was requested
    RequestingAccessToken,
    /// The access token arrived, opaque JSON
    ReceivedAccessToken(String),
    /// The channel setup started with the params of the connector
    ChannelSetupStarted { params: JsonObject },
    /// The channel setup was cancelled. The error is not kept.
    ChannelSetupCancelled(DetailedError),
    /// The channel setup failed
    ChannelSetupFailed(DetailedError),
    /// The channel is ready, the connection waits for the health check. The connection owns the channel of Trino
    /// from now on, the host keeps only a handle for it.
    ChannelReady { channel: ChannelId, trino: SharedTrinoChannel },
    /// The channel refreshed its access token, opaque JSON. A refresh of a channel that the connection no longer uses
    /// changes nothing.
    AccessTokenRefreshed { channel: SharedTrinoChannel, token: String },
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
            TrinoAction::GeneratedPkceChallenge(_) => (ConnectionStatus::PkceGenerated, Connecting),
            TrinoAction::OAuthBrowserOpened => (ConnectionStatus::WaitingForOAuthCodeViaLink, Connecting),
            TrinoAction::ReceivedOAuthCode(_) => (ConnectionStatus::OAuthCodeReceived, Connecting),
            TrinoAction::RequestingAccessToken => (ConnectionStatus::AccessTokenRequested, Connecting),
            TrinoAction::ReceivedAccessToken(_) => (ConnectionStatus::AccessTokenReceived, Connecting),
            TrinoAction::ChannelSetupStarted { .. } => (ConnectionStatus::ChannelSetupStarted, Connecting),
            TrinoAction::ChannelSetupCancelled(_) => (ConnectionStatus::ChannelSetupCancelled, Cancelled),
            TrinoAction::ChannelSetupFailed(_) => (ConnectionStatus::ChannelSetupFailed, Failed),
            TrinoAction::ChannelReady { .. } => (ConnectionStatus::ChannelReady, Connecting),
            // Not a step of the setup, the connection applies it without `reduce`
            TrinoAction::AccessTokenRefreshed { .. } => (ConnectionStatus::ChannelReady, Connecting),
        }
    }
}

/// The connection lets go of its channel, the queries no longer share it
fn release(channel: &mut Option<ChannelId>, shared: &mut Option<SharedTrinoChannel>, effects: &mut Vec<ConnectionEffect>) {
    replace_channel(channel, None, effects);
    *shared = None;
}

/// Apply an action of the setup to a Trino connection. The caller checked that the connection is one of Trino.
pub(super) fn reduce(state: &mut ConnectionState, action: TrinoAction, now: Timestamp, effects: &mut Vec<ConnectionEffect>) {
    let ConnectionDetails { setup_timings: timings, setup_params, channel_error, health_check_error, channel, connector } =
        &mut state.details;
    let ConnectorDetails::Trino(trino) = connector else {
        return;
    };
    if matches!(action, TrinoAction::AccessTokenRefreshed { .. }) {
        return;
    }
    (state.status, state.health) = action.status();
    match action {
        TrinoAction::OAuthStarted { params } => {
            // The timings start over, the schema resolution error stays
            *timings = SetupTimings { oauth_started_at: Some(now), ..Default::default() };
            *setup_params = Some(params);
            *channel_error = None;
            *health_check_error = None;
            trino.oauth_state = Some(TrinoOAuthState::default());
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::OAuthCancelled(_) => {
            timings.oauth_cancelled_at = Some(now);
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::OAuthFailed(error) => {
            timings.oauth_failed_at = Some(now);
            *channel_error = Some(error);
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::GeneratingPkceChallenge => timings.pkce_gen_started_at = Some(now),
        TrinoAction::GeneratedPkceChallenge(pkce) => {
            timings.pkce_gen_finished_at = Some(now);
            trino.oauth_state.get_or_insert_with(Default::default).oauth_pkce = Some(pkce);
        }
        TrinoAction::OAuthBrowserOpened => timings.oauth_browser_opened_at = Some(now),
        TrinoAction::ReceivedOAuthCode(code) => {
            timings.oauth_code_received_at = Some(now);
            trino.oauth_state.get_or_insert_with(Default::default).auth_code = Some(code);
        }
        TrinoAction::RequestingAccessToken => timings.access_token_requested_at = Some(now),
        TrinoAction::ReceivedAccessToken(token) => {
            timings.access_token_received_at = Some(now);
            trino.oauth_state.get_or_insert_with(Default::default).access_token = Some(token);
        }
        TrinoAction::ChannelSetupStarted { params } => {
            timings.channel_setup_started_at = Some(now);
            *setup_params = Some(params);
            *channel_error = None;
            *health_check_error = None;
            trino.schema_resolution_error = None;
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::ChannelSetupCancelled(_) => {
            timings.channel_setup_cancelled_at = Some(now);
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::ChannelSetupFailed(error) => {
            timings.channel_setup_failed_at = Some(now);
            *channel_error = Some(error);
            release(channel, &mut trino.channel, effects);
        }
        TrinoAction::ChannelReady { channel: ready, trino: shared } => {
            timings.channel_ready_at = Some(now);
            replace_channel(channel, Some(ready), effects);
            trino.channel = Some(shared);
        }
        TrinoAction::AccessTokenRefreshed { .. } => {}
    }
}
