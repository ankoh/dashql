//! The setup of a Hyper connection: the channel to the embedded Hyper or to a Hyper server.

use super::details::{replace_channel, ConnectionChannel, ConnectionDetails, ConnectorDetails, DetailedError, SetupTimings, Timestamp};
use super::params::{string_field, JsonObject};
use super::{ConnectionEffect, ConnectionHealth, ConnectionState, ConnectionStatus};

/// An action of the setup of a Hyper connection
#[derive(Debug, Clone, PartialEq)]
pub enum HyperAction {
    /// The channel setup started with the params of the connector
    ChannelSetupStarted { params: JsonObject },
    /// The channel setup was cancelled
    ChannelSetupCancelled(DetailedError),
    /// The channel setup failed
    ChannelSetupFailed(DetailedError),
    /// The channel is ready: one of the host, or the HTTP API of a Hyper that the connection speaks itself. The
    /// embedded Hyper (`WASM`) is online with it, a server waits for the health check.
    ChannelReady { channel: ConnectionChannel, params: JsonObject },
}

/// Apply an action of the setup to a Hyper connection
pub(super) fn reduce(state: &mut ConnectionState, action: HyperAction, now: Timestamp, effects: &mut Vec<ConnectionEffect>) {
    let details = &mut state.details;
    match action {
        HyperAction::ChannelSetupStarted { params } => {
            state.status = ConnectionStatus::ChannelSetupStarted;
            state.health = ConnectionHealth::Connecting;
            // A new setup starts with fresh details, the channel of the last setup is closed
            replace_channel(&mut details.channel, None, effects);
            *details = ConnectionDetails {
                setup_timings: SetupTimings { channel_setup_started_at: Some(now), ..Default::default() },
                setup_params: Some(params),
                channel_error: None,
                health_check_error: None,
                channel: None,
                connector: ConnectorDetails::Hyper,
            };
        }
        HyperAction::ChannelSetupCancelled(error) => {
            state.status = ConnectionStatus::ChannelSetupCancelled;
            state.health = ConnectionHealth::Cancelled;
            details.setup_timings.channel_setup_cancelled_at = Some(now);
            details.channel_error = Some(error);
            details.health_check_error = None;
            replace_channel(&mut details.channel, None, effects);
        }
        HyperAction::ChannelSetupFailed(error) => {
            state.status = ConnectionStatus::ChannelSetupFailed;
            state.health = ConnectionHealth::Failed;
            details.setup_timings.channel_setup_failed_at = Some(now);
            details.channel_error = Some(error);
            replace_channel(&mut details.channel, None, effects);
        }
        HyperAction::ChannelReady { channel, params } => {
            state.status = ConnectionStatus::ChannelReady;
            state.health = if string_field(&params, "protocol") == Some("WASM") {
                ConnectionHealth::Online
            } else {
                ConnectionHealth::Connecting
            };
            details.setup_timings.channel_ready_at = Some(now);
            details.setup_params = Some(params);
            replace_channel(&mut details.channel, Some(channel), effects);
        }
    }
}
