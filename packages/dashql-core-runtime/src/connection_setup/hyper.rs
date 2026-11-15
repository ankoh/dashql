//! The setup of a Hyper connection: which channel the params ask for and the actions of the connection.
//!
//! The embedded Hyper (`WASM`) and the gRPC channel of the desktop app (`V3_GRPC`, through its native proxy) are
//! channels of the host. A Hyper over HTTP (`V3_HTTP`) and the Hyper of a link (`V3_HTTP_LINK`, its HTTP API with the
//! token of the link) are HTTP channels: the setup resolves their params, the host keeps the channel that describes
//! itself to the query executor. The token of a link is never stored, the page that opened the link holds it.
//!
//! Ported from `packages/dashql-app/src/connections/hyper/hyper_connection_setup.tsx`.

use std::rc::Rc;

use serde_json::Value;

use super::{SetupFailure, SetupHost, LOG_TARGET};
use crate::connections::{ChannelId, ConnectionAction, DetailedError, HyperAction, JsonObject};
use crate::host::LogLevel;
use crate::http::CancellationToken;
use crate::hyper::link::hyper_link_channel_params;

/// The message of a link whose token the page doesn't hold
pub const MISSING_LINK_TOKEN_MESSAGE: &str = "Open the link of this Hyper again, e.g. the one that `hyperd run --ui` prints";

/// What kind of channel a Hyper connection uses
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HyperChannelKind {
    /// The embedded Hyper of the platform
    Embedded,
    /// The gRPC API, through the native proxy of the desktop app
    Grpc,
    /// The HTTP API
    Http,
}

impl HyperChannelKind {
    pub fn name(self) -> &'static str {
        match self {
            HyperChannelKind::Embedded => "embedded",
            HyperChannelKind::Grpc => "grpc",
            HyperChannelKind::Http => "http",
        }
    }
}

/// The channel that a setup asks the host to connect
#[derive(Debug, Clone, PartialEq)]
pub struct HyperChannelRequest {
    pub kind: HyperChannelKind,
    /// The params of the channel: the params of the connection, those of a link with its token
    pub params: JsonObject,
}

/// The channel of the params of a connection, the token of a link if the page holds one
pub fn hyper_channel_request(params: &JsonObject, link_token: Option<&str>) -> Result<HyperChannelRequest, String> {
    let protocol = params.get("protocol").and_then(Value::as_str).unwrap_or("");
    match protocol {
        "WASM" => Ok(HyperChannelRequest { kind: HyperChannelKind::Embedded, params: params.clone() }),
        "V3_HTTP_LINK" => {
            let token = link_token.filter(|token| !token.is_empty()).ok_or_else(|| MISSING_LINK_TOKEN_MESSAGE.to_string())?;
            Ok(HyperChannelRequest { kind: HyperChannelKind::Http, params: hyper_link_channel_params(params, token) })
        }
        "V3_HTTP" => Ok(HyperChannelRequest { kind: HyperChannelKind::Http, params: params.clone() }),
        _ => Ok(HyperChannelRequest { kind: HyperChannelKind::Grpc, params: params.clone() }),
    }
}

/// Set up a Hyper connection with its params, returns the id of the channel that the host keeps
pub async fn setup_hyper<H: SetupHost>(host: Rc<H>, params: JsonObject, cancellation: CancellationToken) -> Result<ChannelId, SetupFailure> {
    let mut params = params;
    params.remove("draftRows");
    host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() }));
    let cancel = |host: &H| {
        host.log(LogLevel::Warn, "Cancelled setup", &[("target", LOG_TARGET)]);
        host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(DetailedError::new(super::CANCELLED_MESSAGE))));
        Err(SetupFailure::cancelled())
    };
    let fail = |host: &H, failure: SetupFailure| {
        host.log(LogLevel::Warn, "Setup failed", &[("target", LOG_TARGET), ("error", &failure.message)]);
        host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(DetailedError::new(failure.message.clone()))));
        Err(failure)
    };
    if cancellation.is_cancelled() {
        return cancel(&host);
    }
    let token = host.hyper_link_token();
    let request = match hyper_channel_request(&params, token.as_deref()) {
        Ok(request) => request,
        Err(message) => return fail(&host, SetupFailure::failed(message)),
    };
    // A connect runs to its end, a channel that is ready after a cancellation is closed
    let channel = match host.connect_hyper_channel(&request, &cancellation).await {
        Err(_) if cancellation.is_cancelled() => return cancel(&host),
        Err(error) => return fail(&host, SetupFailure::failed(error.message()).with_value(error.value().cloned())),
        Ok(channel) => channel,
    };
    if cancellation.is_cancelled() {
        host.close_channel(channel);
        return cancel(&host);
    }
    host.dispatch(&ConnectionAction::Hyper(HyperAction::ChannelReady { channel, params }));
    Ok(channel)
}
